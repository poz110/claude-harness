---
name: jira-mcp-setup
description: "统一的 Jira 问题处理中心。提供：ensureConnected() 确保 MCP 可用、 getIssue() 获取并处理 Jira ticket、writeBack() 回写结果到 Jira。 被 autopilot/hotfix 调用，所有 Jira 相关逻辑集中在此。"
---

# Jira 统一处理中心

## 核心原则

**Jira 处理逻辑只在一处。** autopilot/hotfix 不再各自编写 Jira 处理代码，统一调用本 skill。

**双通道保障：MCP 优先，curl 兜底。** 当 MCP server 未启动（session 加载失败、subagent 无 MCP 继承等），自动从 `~/.claude/mcp.json` 读取凭证，切换到 curl REST API 模式，确保配置了就能用。

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

确保 Jira 可用。三层检测：MCP → curl（从 mcp.json 读凭证）→ 引导配置。

```
// === 第 1 层：尝试 MCP 工具 ===
try {
  mcp__atlassian__jira_get_issue(issueKey: "__TEST__")
  // MCP 可用（即使返回 404 也说明连接正常）
  return { ok: true, method: "mcp" }
} catch (e) {
  // MCP 工具不存在或 server 未启动，继续第 2 层
}

// === 第 2 层：从 ~/.claude/mcp.json 读取凭证，用 curl 测试 ===
try {
  configRaw = Read("~/.claude/mcp.json")
  config = JSON.parse(configRaw)
  atlassian = config.mcpServers.atlassian

  if (atlassian && atlassian.env) {
    jiraUrl   = atlassian.env.JIRA_URL        // e.g. "https://xxx.atlassian.net"
    username  = atlassian.env.JIRA_USERNAME    // e.g. "user@company.com"
    token     = atlassian.env.JIRA_API_TOKEN

    if (jiraUrl && username && token) {
      // 用 curl 测试连通性（/rest/api/3/myself 最轻量）
      testResult = Bash: curl -sf -u "${username}:${token}" "${jiraUrl}/rest/api/3/myself" -o /dev/null -w "%{http_code}"

      if (testResult == "200") {
        return {
          ok: true,
          method: "curl",
          config: { jiraUrl, username, token,
                    confluenceUrl: atlassian.env.CONFLUENCE_URL || "",
                    confluenceUsername: atlassian.env.CONFLUENCE_USERNAME || username,
                    confluenceToken: atlassian.env.CONFLUENCE_API_TOKEN || token }
        }
      }
      // curl 测试失败（token 过期、网络不通等）
      // 告知用户具体 HTTP 状态码，继续第 3 层
    }
  }
} catch (e) {
  // mcp.json 不存在或解析失败，继续第 3 层
}

// === 第 3 层：引导用户配置 ===
// 询问用户是否要配置 Jira MCP
// 若用户同意，引导配置步骤（写 ~/.claude/mcp.json）
// 验证是否成功
return { ok: false, configured: false }
```

---

## 函数 2：getIssue(url, mode)

获取 Jira ticket 并处理，返回 `requirement` 和 `context`。

**参数：**
- `url`: Jira Issue URL
- `mode`: `autopilot` 或 `hotfix`

**处理流程：**

```
1. 解析 URL 提取 issueKey
   url matches /atlassian\.net\/browse\/([A-Z]+-\d+)/
   issueKey = 匹配到的 key（如 TRNSCN-2989）

2. 确保连接可用（调用 ensureConnected）
   conn = ensureConnected()
   if (!conn.ok) → 进入异常处理（见底部）

3. 获取 ticket（按 method 分支）

   // ==================== MCP 路径 ====================
   if (conn.method == "mcp") {
     issue = mcp__atlassian__jira_get_issue(issueKey: issueKey)
   }

   // ==================== curl 路径 ====================
   if (conn.method == "curl") {
     issueJson = Bash: curl -sf -u "${conn.config.username}:${conn.config.token}" \
       "${conn.config.jiraUrl}/rest/api/3/issue/${issueKey}" \
       --header "Accept: application/json"
     issue = JSON.parse(issueJson)
   }

4. 提取需求文本
   summary = issue.fields.summary
   // description 在 REST API v3 中是 ADF 格式（Atlassian Document Format）
   // 提取纯文本：递归遍历 description.content 中所有 type=="text" 的节点
   descriptionText = extractTextFromADF(issue.fields.description)
   requirement = summary + "\n" + descriptionText

5. 分析图片附件

   ⚠️ 禁止调用以下 MCP 工具（数据量超限）：
      - jira_get_issue_images      ← 返回所有图片二进制，>20MB
      - confluence_get_page_images ← 同上
      - WebFetch Confluence URL    ← 需认证，会 302 重定向到登录页

   // ==================== MCP 路径 ====================
   if (conn.method == "mcp") {

     5a-mcp. Jira 直接附件
     if (issue.fields.attachment 非空) {
       try {
         result = mcp__atlassian__jira_download_attachments(issue_key: issueKey)
         analysis = 对 result 中每张图片描述：UI 问题位置、错误信息、设计标注
         attachmentAnalysis.push("[Jira Attachments]: " + analysis)
       } catch (e) {
         attachmentAnalysis.push("[Jira Attachments]: 图片无法加载")
       }
     }

     5b-mcp. Confluence Wiki 图片宏
     confluenceImageUrls = 从 description 中提取 /!([^!|]+?\.(?:png|jpg|jpeg|gif|webp))[|!]/i
     if (confluenceImageUrls.length > 0) {
       for each imgUrl in confluenceImageUrls (最多 3 张):
         try {
           pageId   = imgUrl.match(/attachments\/(\d+)\//)[1]
           filename = decodeURIComponent(imgUrl.match(/attachments\/\d+\/([^?|]+)/)[1])
           attList  = mcp__atlassian__confluence_get_attachments(content_id: pageId, filename: filename)
           attId    = attList.attachments[0].id
           mcp__atlassian__confluence_download_attachment(attachment_id: attId)
           analysis = 描述图片内容
           attachmentAnalysis.push("[Confluence Image " + filename + "]: " + analysis)
         } catch (e) {
           attachmentAnalysis.push("[Confluence Image]: 图片无法加载，URL: " + imgUrl)
         }
     }
   }

   // ==================== curl 路径 ====================
   if (conn.method == "curl") {

     5a-curl. Jira 直接附件
     attachments = issue.fields.attachment || []
     imageAttachments = attachments.filter(a => /\.(png|jpg|jpeg|gif|webp)$/i.test(a.filename))

     for each att in imageAttachments (最多 5 张):
       try {
         tmpPath = "/tmp/jira_att_${att.id}_${att.filename}"
         Bash: curl -sf -u "${conn.config.username}:${conn.config.token}" \
           -o "${tmpPath}" "${att.content}"
         // Read 工具支持读取图片（Claude 多模态），直接视觉分析
         Read(tmpPath)
         analysis = 描述图片：UI 问题位置、错误信息、设计标注
         attachmentAnalysis.push("[Jira Attachment " + att.filename + "]: " + analysis)
         // 清理临时文件
         Bash: rm -f "${tmpPath}"
       } catch (e) {
         attachmentAnalysis.push("[Jira Attachment " + att.filename + "]: 下载失败")
       }

     5b-curl. Confluence Wiki 图片宏
     confluenceImageUrls = 从 descriptionText 中提取图片 URL
     if (confluenceImageUrls.length > 0 && conn.config.confluenceUrl) {
       for each imgUrl in confluenceImageUrls (最多 3 张):
         try {
           filename = 从 imgUrl 提取文件名
           tmpPath = "/tmp/jira_conf_${filename}"
           // Confluence 附件 URL 需要加上 wiki base URL
           fullUrl = conn.config.confluenceUrl 拼接相对路径
           Bash: curl -sf -u "${conn.config.confluenceUsername}:${conn.config.confluenceToken}" \
             -o "${tmpPath}" "${fullUrl}"
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

6. 保存上下文（供 DONE 阶段回写）
   Write state/jira-context.json:
   {
     "issueKey": issueKey,
     "issueUrl": url,
     "mode": mode,
     "method": conn.method,       // "mcp" 或 "curl"
     "mcpConfigured": true,
     "curlConfig": conn.method == "curl" ? conn.config : null
   }

7. 返回
   return {
     requirement: requirement,
     context: { issueKey, issueUrl, mode, method: conn.method, mcpConfigured: true }
   }
```

**ADF 文本提取辅助逻辑（extractTextFromADF）：**

```
// Atlassian Document Format → 纯文本
// REST API v3 的 description 是 ADF JSON，不是纯字符串
function extractTextFromADF(adfNode) {
  if (!adfNode) return ""
  if (adfNode.type == "text") return adfNode.text
  if (adfNode.content && Array.isArray(adfNode.content)) {
    return adfNode.content.map(child => extractTextFromADF(child)).join("")
  }
  return ""
}

// 实际执行时用 Bash + jq 更可靠：
Bash: echo '${issueJson}' | jq -r '
  .fields.description
  | .. | select(.type? == "text") | .text
' 2>/dev/null | head -200
```

**异常处理：**

```
catch (e) {
  if (!conn.ok) {
    // 用户取消配置 或 凭证无效
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
      context: { issueKey, issueUrl, mode, method: "none", mcpConfigured: false }
    }
  }
  // 其他异常（图片下载失败等），不阻塞主流程
  console.warn("图片分析失败，继续：" + e.message)
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

2. 收集修复元数据
   fixer = "Claude Autopilot Agent"
   timestamp = 当前时间

3. 构建回写 comment
   comment = """
   ✅ Claude Autopilot 已完成修复

   **修复摘要**：
   ${context.changes.join('\n')}

   **测试结果**：${context.testResult}

   **时间**：${timestamp}
   **执行人**：${fixer}
   """

4. 回写到 Jira

   // ==================== MCP 路径 ====================
   if (method == "mcp") {
     mcp__atlassian__jira_add_comment(issueKey: context.issueKey, comment: comment)
   }

   // ==================== curl 路径 ====================
   if (method == "curl") {
     curlConfig = jiraContext.curlConfig
     // 构建 ADF 格式的 comment body
     commentBody = {
       "body": {
         "type": "doc",
         "version": 1,
         "content": [{
           "type": "paragraph",
           "content": [{ "type": "text", "text": comment }]
         }]
       }
     }
     Bash: curl -sf -u "${curlConfig.username}:${curlConfig.token}" \
       -X POST "${curlConfig.jiraUrl}/rest/api/3/issue/${context.issueKey}/comment" \
       -H "Content-Type: application/json" \
       -d '${JSON.stringify(commentBody)}'
   }

5. 推进状态（选最接近「完成/提测」的状态）

   // ==================== MCP 路径 ====================
   if (method == "mcp") {
     transitions = mcp__atlassian__jira_get_transitions(issueKey: context.issueKey)
     // 优先匹配：Done / 完成 / Fixed / 提测 / Ready for QA / Resolved
     mcp__atlassian__jira_transition_issue(issueKey: context.issueKey, targetStatus)
   }

   // ==================== curl 路径 ====================
   if (method == "curl") {
     curlConfig = jiraContext.curlConfig
     // 获取可用 transitions
     transitionsJson = Bash: curl -sf -u "${curlConfig.username}:${curlConfig.token}" \
       "${curlConfig.jiraUrl}/rest/api/3/issue/${context.issueKey}/transitions" \
       -H "Accept: application/json"

     transitions = JSON.parse(transitionsJson).transitions
     // 优先匹配顺序（中英文）：
     targetNames = ["Done", "完成", "已完成", "Fixed", "已修复", "提测", "Ready for QA", "In Review", "Resolved", "已解決"]
     target = transitions.find(t => targetNames.includes(t.name))

     if (target) {
       Bash: curl -sf -u "${curlConfig.username}:${curlConfig.token}" \
         -X POST "${curlConfig.jiraUrl}/rest/api/3/issue/${context.issueKey}/transitions" \
         -H "Content-Type: application/json" \
         -d '{"transition":{"id":"${target.id}"}}'
     } else {
       告知用户：「未找到匹配的完成状态，已添加评论，请手动转移。」
     }
   }
```

---

## 调用示例

**autopilot / hotfix 中：**
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

**DONE 阶段：**
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
| MCP 工具不可用 + `~/.claude/mcp.json` 有配置 | 自动切换 curl 模式（本次修复的核心场景） |
| MCP 工具不可用 + 无 mcp.json | 引导用户配置 |
| curl 测试返回 401 | API Token 过期或无效，提示用户重新生成 |
| curl 测试返回非 200 | 显示 HTTP 状态码，提示用户检查 JIRA_URL 和网络 |
| `mcp__atlassian__jira_get_issue` 不可用 | 第 1 层检测失败，自动进入第 2 层 curl 检测 |
| API Token 无效 | 重新生成并更新 `~/.claude/mcp.json` 中的 JIRA_API_TOKEN |
| 权限不足 | 确认邮箱有访问 Jira 项目权限 |
| 回写失败 | 记录警告，不阻塞流程完成 |
| Confluence 图片下载失败 | 检查 token 是否有 Confluence 访问权限 |
| curl 下载附件超时 | 单张图片 curl 加 `--max-time 30`，超时跳过该图 |
| ADF 描述解析失败 | 降级为 `jq` 提取 text 节点，再失败则用 raw JSON |
| `confluence_get_attachments` 返回超大响应 | MCP 路径必须传 `filename` 参数做精确过滤 |
| `confluence_download_attachment` 报错 attachment_id 格式 | attachment_id 须为 `att` 前缀形式 |
| Confluence 图片 WebFetch 返回 302 | 禁止用 WebFetch，用 MCP 两步法或 curl + auth |
| `jira_download_attachments` 无输出 | 该工具只返回图片类附件；若 issue 只有非图片附件则返回空摘要 |
