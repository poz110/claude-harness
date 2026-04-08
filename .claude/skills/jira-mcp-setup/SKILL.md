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
   ⚠️ 禁止调用以下 MCP 工具（会返回完整二进制数据，超过 20MB 限制）：
      - jira_get_issue_images
      - get_page_images
      - get_content_attachments
      - download_confluence_attachment
      - download_attachment（如返回二进制 body 则跳过）

   5a. Jira 直接附件（用 WebFetch，不用 MCP 下载工具）
   attachments = issue.fields.attachment
   imageAttachments = attachments.filter(a => a.mimeType.startsWith('image/'))

   if (imageAttachments.length > 0) {
     for each img in imageAttachments:
       try {
         // img.content 是带认证的 Jira 图片 URL，WebFetch 可直接访问
         analysis = WebFetch(img.content, prompt: "Describe this UI screenshot in detail: layout, components, error messages, annotations.")
         attachmentAnalysis.push("[" + img.filename + "]: " + analysis)
       } catch (e) {
         attachmentAnalysis.push("[" + img.filename + "]: 图片无法加载")
       }
   }

   5b. Confluence Wiki 图片宏（description 中的 !http://...! 格式）
   confluenceImageUrls = 从 issue.description 中提取所有匹配 /!([^!|]+?\.(?:png|jpg|jpeg|gif|webp))[|!]/i 的 URL

   if (confluenceImageUrls.length > 0) {
     for each imgUrl in confluenceImageUrls:
       try {
         // 直接 WebFetch，不调用任何 MCP 二进制下载工具
         analysis = WebFetch(imgUrl, prompt: "Describe this UI screenshot or design image in detail for a developer: layout, components, text, interactions.")
         attachmentAnalysis.push("[Confluence Image]: " + analysis)
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
| `Request too large (max 20MB)` | 禁止调用 `get_page_images` / `get_content_attachments` / `download_confluence_attachment`，改用 WebFetch 直接读 URL |
