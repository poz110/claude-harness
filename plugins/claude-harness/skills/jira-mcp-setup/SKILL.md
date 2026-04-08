---
name: jira-mcp-setup
description: "统一的 Jira 问题处理中心。提供：ensureConnected() 确保 MCP 可用、 getIssue() 获取并处理 Jira ticket、writeBack() 回写结果到 Jira。 被 autopilot/hotfix 调用，所有 Jira 相关逻辑集中在此。"
---

# Jira 统一处理中心

## 核心原则

**Jira 处理逻辑只在一处。** autopilot/hotfix 不再各自编写 Jira 处理代码，统一调用本 skill。

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

确保 Jira MCP 可用。若不可用，引导用户配置。

```
// 1. 尝试调用 Jira MCP
try {
  mcp__atlassian__jira_get_issue(issueKey: "__TEST__")
  return { ok: true }
} catch (e) {
  // 2. MCP 不可用，进入引导流程
  // 3. 询问用户是否要配置
  // 4. 若用户同意，引导配置步骤
  // 5. 验证是否成功
  return { ok: false, configured: false }
}
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

2. 确保 MCP 可用（调用 ensureConnected）

3. 获取 ticket
   issue = mcp__atlassian__jira_get_issue(issueKey: issueKey)

4. 提取需求文本
   requirement = issue.summary + "\n" + issue.description（纯文本部分）

5. 分析图片附件
   ⚠️ 禁止调用以下 MCP 工具（数据量超限）：
      - jira_get_issue_images      ← 返回所有图片二进制，>20MB
      - confluence_get_page_images ← 同上
      - WebFetch Confluence URL    ← 需认证，会 302 重定向到登录页

   ✅ 正确方式（见下方 5a / 5b）：
      - Jira 附件：mcp__atlassian__jira_download_attachments(issue_key)
      - Confluence 附件：两步法（先 get_attachments 拿 att_id，再 download_attachment）
      MCP 下载结果直接返回 base64 EmbeddedResource，Claude 可视觉分析，无需写临时文件。

   5a. Jira 直接附件
   if (issue.fields.attachment 非空) {
     try {
       // 一次下载该 issue 所有图片附件，MCP 自动过滤非图片
       result = mcp__atlassian__jira_download_attachments(issue_key: issueKey)
       // result 包含文字摘要 + 每张图片的 EmbeddedResource，Claude 直接视觉分析
       analysis = 对 result 中每张图片描述：UI 问题位置、错误信息、设计标注
       attachmentAnalysis.push("[Jira Attachments]: " + analysis)
     } catch (e) {
       attachmentAnalysis.push("[Jira Attachments]: 图片无法加载")
     }
   }

   5b. Confluence Wiki 图片宏（description 中的 !http://...! 格式）
   两步法：先获取 att_id，再下载。

   confluenceImageUrls = 从 issue.description 中提取所有匹配 /!([^!|]+?\.(?:png|jpg|jpeg|gif|webp))[|!]/i 的 URL

   if (confluenceImageUrls.length > 0) {
     for each imgUrl in confluenceImageUrls (最多处理前 3 张):
       try {
         // Step 1：从 URL 解析 pageId 和 filename
         // URL 格式：/wiki/download/attachments/{pageId}/{filename}.png
         pageId   = imgUrl.match(/attachments\/(\d+)\//)[1]
         filename = decodeURIComponent(imgUrl.match(/attachments\/\d+\/([^?|]+)/)[1])

         // Step 2：用 filename 过滤查询，避免拉取全部附件（可能 96k+ 字符）
         attList  = mcp__atlassian__confluence_get_attachments(
                      content_id: pageId,
                      filename: filename   // ← 精确匹配，响应体小
                    )
         attId    = attList.attachments[0].id  // 形如 "att1990361251"

         // Step 3：下载，MCP 返回 base64 EmbeddedResource，Claude 直接视觉分析
         mcp__atlassian__confluence_download_attachment(attachment_id: attId)
         analysis = 描述图片：UI 布局、组件、标注文字、需要修改的地方
         attachmentAnalysis.push("[Confluence Image " + filename + "]: " + analysis)
       } catch (e) {
         attachmentAnalysis.push("[Confluence Image]: 图片无法加载，URL: " + imgUrl)
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
     "mcpConfigured": true
   }

7. 返回
   return {
     requirement: requirement,
     context: { issueKey, issueUrl, mode, mcpConfigured: true }
   }
```

**异常处理：**

```
catch (e) {
  if (ensureConnected() 失败) {
    // 用户取消配置
    Write state/jira-context.json:
    {
      "issueKey": issueKey,
      "issueUrl": url,
      "mode": mode,
      "mcpConfigured": false
    }
    return {
      requirement: url,  // 降级为原始 URL
      context: { issueKey, issueUrl, mode, mcpConfigured: false }
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
   mcp__atlassian__jira_add_comment(issueKey: context.issueKey, comment: comment)

5. 推进状态（选最接近「完成/提测」的状态）
   mcp__atlassian__jira_transition_issue(issueKey: context.issueKey, targetStatus)
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
| `mcp__atlassian__jira_get_issue` 不可用 | 执行 ensureConnected 引导配置 |
| API Token 无效 | 重新生成并更新环境变量 |
| 权限不足 | 确认邮箱有访问 Jira 项目权限 |
| 回写失败 | 记录警告，不阻塞流程完成 |
| Confluence 图片下载失败 | 检查 token 是否有 Confluence 访问权限 |
| `confluence_get_attachments` 返回超大响应 | 必须传 `filename` 参数做精确过滤，避免拉取整页附件列表（可能 96k+ 字符） |
| `confluence_download_attachment` 报错 attachment_id 格式 | attachment_id 须为 `att` 前缀形式（如 `att1990361251`），从 `get_attachments` 返回的 `id` 字段取得 |
| Confluence 图片 WebFetch 返回 302 | Confluence URL 需认证，WebFetch 无 token；必须用两步法：`confluence_get_attachments(filename)` → `confluence_download_attachment(att_id)` |
| `jira_download_attachments` 无输出 | 该工具只返回图片类附件；若 issue 只有非图片附件则返回空摘要，属正常 |
