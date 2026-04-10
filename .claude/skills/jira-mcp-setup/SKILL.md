---
name: jira-mcp-setup
description: "统一的 Jira 问题处理中心。提供：ensureConnected() 确保连接可用（MCP/curl 双通道 + 多源凭证 + 缓存）、getIssue() 获取完整 ticket 上下文（含图片分析）、writeBack() 回写结果到 Jira。被 autopilot/hotfix/feature 调用，所有 Jira 相关逻辑集中在此。"
---

# Jira 统一处理中心

## 核心原则

**Jira 处理逻辑只在一处。** autopilot/hotfix/feature 不编写任何 Jira 处理代码，统一调用本 skill。

**双通道保障：MCP 优先，curl 兜底。** 当 MCP server 不可用时，自动检测多种凭证来源切换到 curl REST API 模式。

**连接缓存：同一 session 内只检测一次。** 首次检测结果存入 `state/jira-context.json`，5 分钟内复用。

### Iron Law：四层检测不可跳过

**禁止在第 1 层 MCP 失败后直接降级为"未配置"。** 必须严格按顺序执行全部四层：

1. **缓存** → 5 分钟内有效结果直接复用
2. **MCP 工具** → 用 `jira_get_all_projects` 轻量探测
3. **多源凭证 curl** → 环境变量 → `~/.claude/mcp.json` → 项目 `.env`
4. 全部失败 → 才可降级

**违反此规则（跳过第 3 层直接写 mcpConfigured: false）是 BUG。**

---

## 入口参数

调用时必须传入：

| 参数 | 说明 | 示例 |
|------|------|------|
| `action` | 操作类型 | `get_issue` / `write_back` |
| `url` | Jira Issue URL（get_issue 时） | `https://xxx.atlassian.net/browse/PROJ-123` |
| `mode` | 来源模式（autopilot/hotfix） | `autopilot` |
| `context` | 回写上下文（write_back 时） | 见 writeBack 说明 |

---

## 函数 1：ensureConnected()

确保 Jira 可用。**严格按四层顺序执行，禁止跳过任何一层。**

**执行步骤（必须完整执行，不可省略）：**

**Step 0 — 检查缓存：**
```
Read state/jira-context.json
if (文件存在 AND 有 "connectionCache" 字段) {
  cache = jiraContext.connectionCache
  elapsed = (Date.now() - Date.parse(cache.timestamp)) / 1000
  if (elapsed < 300) {
    // 5 分钟内缓存有效，直接复用
    return cache.result  // { ok, method, config }
  }
}
```

**Step 1 — 尝试 MCP 工具（轻量探测）：**
```
try {
  // 用 jira_get_all_projects 做轻量连通性测试
  // 这是一个合法的只读 API，不会在 Jira 产生错误日志
  mcp__atlassian__jira_get_all_projects(include_archived: false)
  result = { ok: true, method: "mcp" }
  // 写入缓存
  cacheConnection(result)
  return result
} catch (e) {
  // MCP 不可用 → 不要降级，不要写 mcpConfigured:false，继续 Step 2
}
```

**Step 2 — 多源凭证检测 + curl 测试（⛔ 不可跳过）：**
```
credentials = null

// ---- Source A：环境变量（MCP server 原生配置方式）----
jiraUrl  = Bash: echo "${JIRA_URL:-}"
username = Bash: echo "${JIRA_USERNAME:-}"
token    = Bash: echo "${JIRA_API_TOKEN:-}"

if (jiraUrl 非空 && username 非空 && token 非空) {
  credentials = {
    jiraUrl: jiraUrl.trim(),
    username: username.trim(),
    token: token.trim(),
    confluenceUrl: Bash: echo "${CONFLUENCE_URL:-}",
    confluenceUsername: Bash: echo "${CONFLUENCE_USERNAME:-}" || username,
    confluenceToken: Bash: echo "${CONFLUENCE_API_TOKEN:-}" || token,
    source: "env"
  }
}

// ---- Source B：~/.claude/mcp.json（现有逻辑）----
if (!credentials) {
  try {
    configRaw = Read("~/.claude/mcp.json")
    config = JSON.parse(configRaw)
    atlassian = config.mcpServers?.atlassian

    if (atlassian?.env?.JIRA_URL && atlassian?.env?.JIRA_USERNAME && atlassian?.env?.JIRA_API_TOKEN) {
      credentials = {
        jiraUrl:   atlassian.env.JIRA_URL,
        username:  atlassian.env.JIRA_USERNAME,
        token:     atlassian.env.JIRA_API_TOKEN,
        confluenceUrl:      atlassian.env.CONFLUENCE_URL || "",
        confluenceUsername:  atlassian.env.CONFLUENCE_USERNAME || atlassian.env.JIRA_USERNAME,
        confluenceToken:    atlassian.env.CONFLUENCE_API_TOKEN || atlassian.env.JIRA_API_TOKEN,
        source: "mcp.json"
      }
    }
  } catch (e) {
    // 文件不存在或解析失败，继续下一个 source
  }
}

// ---- Source C：项目根目录 .env 文件 ----
if (!credentials) {
  try {
    envContent = Read(".env")
    // 解析 JIRA_URL=xxx、JIRA_USERNAME=xxx、JIRA_API_TOKEN=xxx
    jiraUrl  = envContent.match(/^JIRA_URL=(.+)$/m)?.[1]?.trim()
    username = envContent.match(/^JIRA_USERNAME=(.+)$/m)?.[1]?.trim()
    token    = envContent.match(/^JIRA_API_TOKEN=(.+)$/m)?.[1]?.trim()

    if (jiraUrl && username && token) {
      credentials = {
        jiraUrl, username, token,
        confluenceUrl:     envContent.match(/^CONFLUENCE_URL=(.+)$/m)?.[1]?.trim() || "",
        confluenceUsername: envContent.match(/^CONFLUENCE_USERNAME=(.+)$/m)?.[1]?.trim() || username,
        confluenceToken:   envContent.match(/^CONFLUENCE_API_TOKEN=(.+)$/m)?.[1]?.trim() || token,
        source: ".env"
      }
    }
  } catch (e) {
    // .env 不存在，继续
  }
}

// ---- curl 连通性测试 ----
if (credentials) {
  testResult = Bash: curl -sf -u "${credentials.username}:${credentials.token}" \
    "${credentials.jiraUrl}/rest/api/3/myself" -o /dev/null -w "%{http_code}" --max-time 10

  if (testResult == "200") {
    result = { ok: true, method: "curl", config: credentials }
    cacheConnection(result)
    return result
  }
  // curl 返回非 200 → 告知用户 HTTP 状态码和凭证来源
  // 401 = Token 过期或无效
  // 403 = 权限不足
  // 其他 = 网络问题或 URL 错误
  告知用户：「curl 测试失败（HTTP ${testResult}），凭证来源：${credentials.source}」
}
```

**Step 3 — 仅当全部失败时，交互式引导配置：**
```
// ⛔ 不要静默降级！用户给了 Jira URL，期望获取内容。必须明确告知并提供选择。

告知用户（AskUserQuestion）：
"Jira 连接未配置。检测到你提供了 Jira URL，但当前无法访问 Jira API。

配置方式（推荐程度从高到低）：

**A. claude.ai Atlassian 集成（推荐，最简单）**
   在 Claude Code 设置中启用 Atlassian MCP 集成，OAuth 授权后自动可用。
   路径：Claude Code → Settings → Integrations → Atlassian → Connect

**B. 手动配置 API Token**
   1. 访问 https://id.atlassian.com/manage-profile/security/api-tokens 生成 token
   2. 选择以下任一方式存储：
      - 环境变量：export JIRA_URL=https://xxx.atlassian.net JIRA_USERNAME=you@email.com JIRA_API_TOKEN=xxx
      - ~/.claude/mcp.json：在 mcpServers.atlassian.env 下配置
      - 项目 .env 文件：添加 JIRA_URL / JIRA_USERNAME / JIRA_API_TOKEN

**C. 跳过 Jira，手动描述问题**
   使用 URL 作为参考，手动描述问题内容。"

选项：
  A: "我去配置 Atlassian 集成"   → 告知用户配置后重新运行 /hotfix，return { ok: false, action: "setup" }
  B: "我来配置 API Token"        → 告知具体步骤，等待用户配置后重试 ensureConnected()
  C: "跳过，手动描述"            → return { ok: false, configured: false, userSkipped: true }
```

**缓存写入辅助函数：**
```
function cacheConnection(result) {
  // 读取现有 jira-context.json（如有），合并缓存字段
  existing = Read("state/jira-context.json") 或 {}
  existing.connectionCache = {
    timestamp: new Date().toISOString(),
    result: result
  }
  Write state/jira-context.json: existing
}
```

---

## 函数 2：getIssue(url, mode)

获取 Jira ticket 完整上下文，返回 `requirement` 和 `context`。

**参数：**
- `url`: Jira Issue URL
- `mode`: `autopilot` 或 `hotfix`

**处理流程：**

```
1. 解析 URL 提取 issueKey
   url matches /atlassian\.net\/browse\/([A-Z]+-\d+)/
   issueKey = 匹配到的 key（如 PROJ-123）

2. 确保连接可用（调用 ensureConnected）
   conn = ensureConnected()
   if (!conn.ok) → 进入异常处理（见底部）

3. 获取 ticket（按 method 分支，增强字段）

   // ==================== MCP 路径 ====================
   if (conn.method == "mcp") {
     issue = mcp__atlassian__jira_get_issue(
       issue_key: issueKey,
       fields: "summary,description,status,priority,labels,components,assignee,reporter,attachment,issuelinks,subtasks",
       comment_limit: 5
     )
   }

   // ==================== curl 路径 ====================
   if (conn.method == "curl") {
     issueJson = Bash: curl -sf -u "${conn.config.username}:${conn.config.token}" \
       "${conn.config.jiraUrl}/rest/api/3/issue/${issueKey}?fields=summary,description,status,priority,labels,components,assignee,reporter,attachment,issuelinks,subtasks,comment" \
       -H "Accept: application/json" --max-time 30
     issue = JSON.parse(issueJson)
   }

4. 提取需求文本
   summary = issue.fields.summary
   descriptionText = extractTextFromADF(issue.fields.description)
   requirement = summary + "\n\n" + descriptionText

5. 提取丰富上下文
   issueContext = {
     status:       issue.fields.status?.name || "Unknown",
     priority:     issue.fields.priority?.name || "Medium",
     labels:       issue.fields.labels || [],
     components:   (issue.fields.components || []).map(c => c.name),
     assignee:     issue.fields.assignee?.displayName || "Unassigned",
     reporter:     issue.fields.reporter?.displayName || "Unknown",
     linkedIssues: (issue.fields.issuelinks || []).map(link => {
       inward  = link.inwardIssue
       outward = link.outwardIssue
       if (inward)  return inward.key + " (" + link.type.inward + ")"
       if (outward) return outward.key + " (" + link.type.outward + ")"
       return null
     }).filter(Boolean),
     subtasks:     (issue.fields.subtasks || []).map(s => s.key + ": " + s.fields?.summary),
     recentComments: []
   }

   // 提取最近 5 条评论
   if (conn.method == "mcp") {
     // MCP get_issue 已通过 comment_limit 返回评论
     comments = issue.fields?.comment?.comments || []
     issueContext.recentComments = comments.slice(-5).map(c =>
       c.author?.displayName + ": " + extractTextFromADF(c.body)
     )
   }
   if (conn.method == "curl") {
     comments = issue.fields?.comment?.comments || []
     issueContext.recentComments = comments.slice(-5).map(c => {
       author = c.author?.displayName || "Unknown"
       body = extractTextFromADF(c.body)
       return author + ": " + body
     })
   }

   // 将上下文附加到 requirement
   contextSummary = ""
   if (issueContext.status)     contextSummary += "\n状态: " + issueContext.status
   if (issueContext.priority)   contextSummary += "\n优先级: " + issueContext.priority
   if (issueContext.labels.length > 0)     contextSummary += "\n标签: " + issueContext.labels.join(", ")
   if (issueContext.components.length > 0) contextSummary += "\n组件: " + issueContext.components.join(", ")
   if (issueContext.assignee)   contextSummary += "\n经办人: " + issueContext.assignee
   if (issueContext.linkedIssues.length > 0) contextSummary += "\n关联: " + issueContext.linkedIssues.join(", ")
   if (issueContext.subtasks.length > 0)     contextSummary += "\n子任务: " + issueContext.subtasks.join("; ")
   if (issueContext.recentComments.length > 0) {
     contextSummary += "\n\n[最近评论]\n" + issueContext.recentComments.join("\n---\n")
   }
   requirement += "\n\n[Issue 上下文]" + contextSummary

6. 获取开发信息（MCP 专属，可选增强）

   if (conn.method == "mcp") {
     try {
       devInfo = mcp__atlassian__jira_get_issue_development_info(issue_key: issueKey)
       if (devInfo.pullRequests?.length > 0 || devInfo.branches?.length > 0) {
         devSummary = ""
         if (devInfo.pullRequests?.length > 0) {
           devSummary += "\nPR: " + devInfo.pullRequests.map(pr =>
             pr.name + " [" + pr.status + "]"
           ).join(", ")
         }
         if (devInfo.branches?.length > 0) {
           devSummary += "\n分支: " + devInfo.branches.map(b => b.name).join(", ")
         }
         requirement += "\n\n[开发信息]" + devSummary
         issueContext.pullRequests = devInfo.pullRequests || []
         issueContext.branches = devInfo.branches || []
       }
     } catch (e) {
       // 开发信息获取失败不阻塞主流程（可能无 DevTools 集成）
     }
   }

7. 分析图片附件

   attachmentAnalysis = []

   // ==================== MCP 路径 ====================
   if (conn.method == "mcp") {

     7a-mcp. 优先使用 jira_get_issue_images（专为图片分析设计）
     try {
       imageResult = mcp__atlassian__jira_get_issue_images(issue_key: issueKey)
       // 该工具只返回图片类附件的 inline ImageContent
       // >50MB 的图片自动跳过
       // Claude 可直接进行多模态视觉分析
       analysis = 对返回的每张图片描述：UI 问题位置、错误信息、设计标注、异常表现
       attachmentAnalysis.push("[Jira Images]: " + analysis)
     } catch (e) {
       // jira_get_issue_images 失败 → 降级到 jira_download_attachments
       try {
         result = mcp__atlassian__jira_download_attachments(issue_key: issueKey)
         analysis = 对 result 中每张图片描述：UI 问题位置、错误信息、设计标注
         attachmentAnalysis.push("[Jira Attachments]: " + analysis)
       } catch (e2) {
         attachmentAnalysis.push("[Jira Images]: 图片无法加载")
       }
     }

     7b-mcp. Confluence Wiki 图片宏（从 ADF description 中提取）
     // 从 ADF 中提取 mediaSingle/mediaInline 节点的引用
     inlineMediaRefs = extractMediaRefsFromADF(issue.fields.description)

     // 从 description 纯文本中提取 Confluence 附件 URL 模式
     confluenceImageUrls = descriptionText.match(
       /\/wiki\/.*?\/attachments\/\d+\/[^?\s|!]+\.(?:png|jpg|jpeg|gif|webp)/gi
     ) || []

     if (confluenceImageUrls.length > 0) {
       for each imgUrl in confluenceImageUrls (最多 3 张):
         try {
           pageId   = imgUrl.match(/attachments\/(\d+)\//)?.[1]
           filename = decodeURIComponent(imgUrl.match(/attachments\/\d+\/([^?\s|]+)/)?.[1] || "")
           if (pageId && filename) {
             attList = mcp__atlassian__confluence_get_attachments(content_id: pageId, filename: filename)
             attId   = attList.attachments?.[0]?.id
             if (attId) {
               mcp__atlassian__confluence_download_attachment(attachment_id: attId)
               analysis = 描述图片内容
               attachmentAnalysis.push("[Confluence Image " + filename + "]: " + analysis)
             }
           }
         } catch (e) {
           attachmentAnalysis.push("[Confluence Image]: 图片无法加载，URL: " + imgUrl)
         }
     }
   }

   // ==================== curl 路径 ====================
   if (conn.method == "curl") {

     7a-curl. Jira 直接附件
     attachments = issue.fields.attachment || []
     imageAttachments = attachments.filter(a =>
       /\.(png|jpg|jpeg|gif|webp)$/i.test(a.filename)
     )

     for each att in imageAttachments (最多 5 张):
       // 文件大小检查（避免下载超大图片）
       if (att.size && att.size > 10 * 1024 * 1024) {
         attachmentAnalysis.push(
           "[" + att.filename + "]: 跳过，文件大小 " +
           (att.size / 1024 / 1024).toFixed(1) + "MB 超过 10MB 限制"
         )
         continue
       }

       try {
         tmpPath = "/tmp/jira_att_${att.id}_${att.filename}"
         Bash: curl -sf -u "${conn.config.username}:${conn.config.token}" \
           -o "${tmpPath}" "${att.content}" --max-time 30
         // Read 工具支持读取图片（Claude 多模态），直接视觉分析
         Read(tmpPath)
         analysis = 描述图片：UI 问题位置、错误信息、设计标注
         attachmentAnalysis.push("[Jira Attachment " + att.filename + "]: " + analysis)
         // 清理临时文件
         Bash: rm -f "${tmpPath}"
       } catch (e) {
         attachmentAnalysis.push("[Jira Attachment " + att.filename + "]: 下载失败")
       }

     7b-curl. Confluence Wiki 图片宏
     confluenceImageUrls = descriptionText.match(
       /\/wiki\/.*?\/attachments\/\d+\/[^?\s|!]+\.(?:png|jpg|jpeg|gif|webp)/gi
     ) || []

     if (confluenceImageUrls.length > 0 && conn.config.confluenceUrl) {
       for each imgUrl in confluenceImageUrls (最多 3 张):
         try {
           filename = imgUrl.match(/attachments\/\d+\/([^?\s|]+)/)?.[1] || "unknown.png"
           filename = decodeURIComponent(filename)
           tmpPath = "/tmp/jira_conf_${filename}"
           // Confluence 附件 URL 需要加上 base URL
           fullUrl = conn.config.confluenceUrl.replace(/\/wiki\/?$/, "") + imgUrl
           Bash: curl -sf -u "${conn.config.confluenceUsername}:${conn.config.confluenceToken}" \
             -o "${tmpPath}" "${fullUrl}" --max-time 30
           Read(tmpPath)
           analysis = 描述图片内容
           attachmentAnalysis.push("[Confluence Image " + filename + "]: " + analysis)
           Bash: rm -f "${tmpPath}"
         } catch (e) {
           attachmentAnalysis.push("[Confluence Image]: 图片无法加载，URL: " + imgUrl)
         }
     }
   }

   if (attachmentAnalysis.length > 0) {
     requirement += "\n\n[Jira 附件图片分析]\n" + attachmentAnalysis.join("\n")
   }

8. 保存上下文（供 DONE 阶段回写）
   Write state/jira-context.json:
   {
     "issueKey": issueKey,
     "issueUrl": url,
     "mode": mode,
     "method": conn.method,       // "mcp" 或 "curl"
     "mcpConfigured": true,
     "curlConfig": conn.method == "curl" ? conn.config : null,
     "connectionCache": {
       "timestamp": new Date().toISOString(),
       "result": { ok: true, method: conn.method, config: conn.config || null }
     },
     "issueContext": issueContext  // 状态、优先级、标签、关联等
   }

9. 返回
   return {
     requirement: requirement,
     context: { issueKey, issueUrl: url, mode, method: conn.method, mcpConfigured: true }
   }
```

**ADF 文本提取（extractTextFromADF）— 增强版：**

```
// Atlassian Document Format → 结构化纯文本
// REST API v3 的 description 是 ADF JSON，不是纯字符串
function extractTextFromADF(adfNode) {
  if (!adfNode) return ""

  // 终端文本节点
  if (adfNode.type == "text") return adfNode.text || ""

  // 换行和分隔
  if (adfNode.type == "hardBreak") return "\n"
  if (adfNode.type == "rule") return "\n---\n"

  // 提及
  if (adfNode.type == "mention") return "@" + (adfNode.attrs?.text || "")

  // 标题
  if (adfNode.type == "heading") {
    level = adfNode.attrs?.level || 1
    childText = (adfNode.content || []).map(c => extractTextFromADF(c)).join("")
    return "#".repeat(level) + " " + childText + "\n"
  }

  // 列表
  if (adfNode.type == "bulletList" || adfNode.type == "orderedList") {
    return (adfNode.content || []).map((item, i) => {
      prefix = adfNode.type == "orderedList" ? (i + 1) + ". " : "- "
      return prefix + (item.content || []).map(c => extractTextFromADF(c)).join("")
    }).join("\n") + "\n"
  }

  // 代码块
  if (adfNode.type == "codeBlock") {
    lang = adfNode.attrs?.language || ""
    code = (adfNode.content || []).map(c => extractTextFromADF(c)).join("")
    return "```" + lang + "\n" + code + "\n```\n"
  }

  // 表格
  if (adfNode.type == "table") {
    rows = (adfNode.content || []).map(row => {
      cells = (row.content || []).map(cell =>
        (cell.content || []).map(c => extractTextFromADF(c)).join("").trim()
      )
      return "| " + cells.join(" | ") + " |"
    })
    return rows.join("\n") + "\n"
  }

  // 内嵌媒体（图片等）
  if (adfNode.type == "mediaSingle" || adfNode.type == "mediaInline" || adfNode.type == "mediaGroup") {
    media = (adfNode.content || []).find(c => c.type == "media")
    if (media) {
      alt = media.attrs?.alt || media.attrs?.id || "image"
      return "[Media: " + alt + "]\n"
    }
    return ""
  }

  // 段落（加换行分隔）
  if (adfNode.type == "paragraph") {
    text = (adfNode.content || []).map(c => extractTextFromADF(c)).join("")
    return text + "\n"
  }

  // 通用递归
  if (adfNode.content && Array.isArray(adfNode.content)) {
    return adfNode.content.map(child => extractTextFromADF(child)).join("")
  }

  return ""
}
```

**curl 路径的 ADF 提取（用 Bash + jq）：**

```bash
// 增强版 jq 表达式，支持更多 ADF 节点类型
echo '${issueJson}' | jq -r '
  def extract:
    if .type == "text" then (.text // "")
    elif .type == "hardBreak" then "\n"
    elif .type == "mention" then ("@" + (.attrs.text // ""))
    elif .type == "heading" then
      (("#" * (.attrs.level // 1)) + " " + ([.content[]? | extract] | join("")) + "\n")
    elif .type == "codeBlock" then
      ("```" + (.attrs.language // "") + "\n" + ([.content[]? | extract] | join("")) + "\n```\n")
    elif .type == "bulletList" then
      ([.content[]? | "- " + ([.content[]? | extract] | join(""))] | join("\n")) + "\n"
    elif .type == "orderedList" then
      ([.content[]? | [.content[]? | extract] | join("") | "- " + .] | join("\n")) + "\n"
    elif .type == "table" then
      ([.content[]? | "| " + ([.content[]? | [.content[]? | extract] | join("") ] | join(" | ")) + " |"] | join("\n")) + "\n"
    elif .type == "paragraph" then
      ([.content[]? | extract] | join("")) + "\n"
    elif .content then [.content[] | extract] | join("")
    else ""
    end;
  .fields.description | extract
' 2>/dev/null | head -500

// 如果 jq 失败（未安装），降级用简单 jq
echo '${issueJson}' | jq -r '
  [.fields.description | .. | select(.type? == "text") | .text] | join(" ")
' 2>/dev/null | head -200

// 如果 jq 完全不可用，最终降级用 grep
echo '${issueJson}' | grep -oP '"text"\s*:\s*"[^"]*"' | sed 's/"text"\s*:\s*"//;s/"$//' | head -100
```

**从 ADF 提取媒体引用（extractMediaRefsFromADF）：**

```
function extractMediaRefsFromADF(adfNode) {
  refs = []
  if (!adfNode) return refs

  if (adfNode.type == "media") {
    refs.push({
      id: adfNode.attrs?.id,
      type: adfNode.attrs?.type,        // "file" 或 "external"
      collection: adfNode.attrs?.collection,
      width: adfNode.attrs?.width,
      height: adfNode.attrs?.height,
      alt: adfNode.attrs?.alt
    })
  }

  if (adfNode.content && Array.isArray(adfNode.content)) {
    for (child of adfNode.content) {
      refs = refs.concat(extractMediaRefsFromADF(child))
    }
  }

  return refs
}
```

**异常处理：**

```
catch (e) {
  if (!conn.ok) {
    // ensureConnected() 已通过交互式引导让用户选择了处理方式
    // 到这里说明用户选择了"跳过，手动描述"

    // ⛔ 不要静默降级。明确告知用户：
    告知用户：
    "⚠️ 无法获取 Jira ticket 内容（${issueKey}）。
     将使用 URL 作为参考，请手动描述问题：
     - 问题是什么？
     - 在哪个页面/功能？
     - 期望行为 vs 实际行为？"

    Write state/jira-context.json:
    {
      "issueKey": issueKey,
      "issueUrl": url,
      "mode": mode,
      "method": "none",
      "mcpConfigured": false
    }
    return {
      requirement: url,  // 降级为原始 URL
      context: { issueKey, issueUrl: url, mode, method: "none", mcpConfigured: false }
    }
  }
  // 其他异常（图片下载失败等），不阻塞主流程
  console.warn("部分数据获取失败，继续：" + e.message)
}
```

---

## 函数 3：writeBack(context)

DONE 阶段回写结果到 Jira。

**参数：**
```json
{
  "issueKey": "PROJ-123",
  "issueUrl": "https://xxx.atlassian.net/browse/PROJ-123",
  "mode": "autopilot",
  "changes": ["修复了登录按钮样式错位", "新增用户头像上传功能"],
  "testResult": "通过"
}
```

**处理流程：**

```
1. Read state/jira-context.json 验证 context 存在
   if (文件不存在 OR mcpConfigured == false) {
     // 非 Jira 来源 或 连接不可用，跳过
     return
   }
   method = jiraContext.method  // "mcp" 或 "curl"

   // 如果缓存中有连接信息，直接使用，无需重新检测
   if (method == "curl" && !jiraContext.curlConfig) {
     // 缓存丢失，重新检测
     conn = ensureConnected()
     if (!conn.ok) { 告知用户回写失败; return }
     method = conn.method
   }

2. 收集修复元数据
   fixer = "Claude " + (context.mode == "hotfix" ? "Hotfix" : "Autopilot") + " Agent"
   timestamp = Bash: date "+%Y-%m-%d %H:%M:%S %Z"

3. 构建回写 comment
   comment = """
   ✅ ${fixer} 已完成

   **修复摘要**：
   ${context.changes.map(c => "- " + c).join('\n')}

   **测试结果**：${context.testResult}

   **时间**：${timestamp}
   **执行人**：${fixer}
   """

4. 回写到 Jira

   // ==================== MCP 路径 ====================
   if (method == "mcp") {
     try {
       mcp__atlassian__jira_add_comment(issue_key: context.issueKey, body: comment)
     } catch (e) {
       告知用户：「评论添加失败：${e.message}」
     }
   }

   // ==================== curl 路径 ====================
   if (method == "curl") {
     curlConfig = jiraContext.curlConfig
     // 构建 ADF 格式的 comment body
     // 将 markdown comment 转换为 ADF 段落
     adfParagraphs = comment.split('\n').filter(Boolean).map(line => ({
       "type": "paragraph",
       "content": [{ "type": "text", "text": line }]
     }))
     commentBody = {
       "body": {
         "type": "doc",
         "version": 1,
         "content": adfParagraphs
       }
     }
     result = Bash: curl -sf -u "${curlConfig.username}:${curlConfig.token}" \
       -X POST "${curlConfig.jiraUrl}/rest/api/3/issue/${context.issueKey}/comment" \
       -H "Content-Type: application/json" \
       -d '${JSON.stringify(commentBody)}' \
       -w "\n%{http_code}" --max-time 15

     httpCode = result 最后一行
     if (httpCode != "201" && httpCode != "200") {
       告知用户：「评论添加失败（HTTP ${httpCode}）」
     }
   }

5. 推进状态（选最接近「完成/提测」的状态）

   // ==================== MCP 路径 ====================
   if (method == "mcp") {
     try {
       transitions = mcp__atlassian__jira_get_transitions(issue_key: context.issueKey)
       // 优先匹配顺序（中英文）：
       targetNames = ["Done", "完成", "已完成", "Fixed", "已修复", "提测", "Ready for QA", "In Review", "Resolved", "已解決"]
       target = transitions.find(t => targetNames.includes(t.name))
       if (target) {
         mcp__atlassian__jira_transition_issue(issue_key: context.issueKey, transition_id: target.id)
       } else {
         告知用户：「未找到匹配的完成状态，已添加评论，请手动转移。」
       }
     } catch (e) {
       告知用户：「状态转移失败：${e.message}。已添加评论。」
     }
   }

   // ==================== curl 路径 ====================
   if (method == "curl") {
     curlConfig = jiraContext.curlConfig
     // 获取可用 transitions
     transitionsJson = Bash: curl -sf -u "${curlConfig.username}:${curlConfig.token}" \
       "${curlConfig.jiraUrl}/rest/api/3/issue/${context.issueKey}/transitions" \
       -H "Accept: application/json" --max-time 10

     if (transitionsJson 非空) {
       transitions = JSON.parse(transitionsJson).transitions || []
       targetNames = ["Done", "完成", "已完成", "Fixed", "已修复", "提测", "Ready for QA", "In Review", "Resolved", "已解決"]
       target = transitions.find(t => targetNames.some(n => t.name === n))

       if (target) {
         Bash: curl -sf -u "${curlConfig.username}:${curlConfig.token}" \
           -X POST "${curlConfig.jiraUrl}/rest/api/3/issue/${context.issueKey}/transitions" \
           -H "Content-Type: application/json" \
           -d '{"transition":{"id":"${target.id}"}}' --max-time 10
       } else {
         告知用户：「未找到匹配的完成状态（可用: ${transitions.map(t => t.name).join(', ')}），已添加评论，请手动转移。」
       }
     }
   }
```

---

## 调用示例

**autopilot / hotfix / feature 中获取 issue：**
```
if (requirement matches /atlassian\.net\/browse\/([A-Z]+-\d+)/) {
  result = Skill: jira-mcp-setup (
    action: "get_issue",
    url: requirement,
    mode: "autopilot"  // 或 "hotfix"
  )

  requirement = result.requirement
  // jira-context.json 已由 skill 写入
}
```

**DONE 阶段回写：**
```
if (state/jira-context.json 存在) {
  Skill: jira-mcp-setup (
    action: "write_back",
    context: {
      issueKey: "...",
      issueUrl: "...",
      mode: "...",
      changes: [...],
      testResult: "..."
    }
  )
}
```

---

## 故障排除

| 问题 | 解决方案 |
|------|----------|
| MCP 工具不可用 + 环境变量有配置 | 自动切换 curl 模式（Source A） |
| MCP 工具不可用 + `~/.claude/mcp.json` 有配置 | 自动切换 curl 模式（Source B） |
| MCP 工具不可用 + `.env` 有配置 | 自动切换 curl 模式（Source C） |
| MCP 工具不可用 + 无任何凭证 | 引导用户配置（三种方式任选） |
| curl 测试返回 401 | API Token 过期或无效，提示用户更新对应来源的凭证 |
| curl 测试返回 403 | 权限不足，确认账号有访问 Jira 项目权限 |
| curl 测试返回非 200 | 显示 HTTP 状态码和凭证来源，提示检查 URL 和网络 |
| `jira_get_issue_images` 返回空 | issue 无图片附件，或附件为非图片类型（正常情况） |
| `jira_get_issue_images` 失败 | 自动降级到 `jira_download_attachments` |
| curl 下载附件 >10MB | 自动跳过该图片，告知文件大小 |
| curl 下载附件超时 | 单张图片 `--max-time 30`，超时跳过该图 |
| ADF 描述解析失败 | 三级降级：增强 jq → 简单 jq → grep |
| Confluence 图片下载失败 | 检查 Confluence token 是否有访问权限 |
| Jira 状态转移无匹配 | 列出所有可用状态名，只添加评论，提示手动转移 |
| 回写失败 | 显示 HTTP 状态码，记录警告，不阻塞流程完成 |
| `jira_download_attachments` 无输出 | 该工具只返回文件类附件；issue 无附件则返回空摘要 |
| 子 Agent 中环境变量不可用 | 自动尝试 Source B / C 作为兜底 |
| 连接缓存过期 | 超过 5 分钟自动重新检测 |
