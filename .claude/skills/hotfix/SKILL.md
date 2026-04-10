---
name: hotfix
description: "快速修復模式：徹底分析問題後直接寫修復代碼。不走 pipeline，不生成文檔。適用於緊急 bug 修復或小範圍改動。"
---

# Hotfix — 快速修復

## 用法

```bash
/hotfix <描述或 Jira URL>    # 分析問題 → 修復代碼 → 回寫 Jira
/hotfix                      # 手動描述問題
```

**示例**：
```
/hotfix 修復登錄頁面的 CSS 兼容問題
/hotfix https://troneco.atlassian.net/browse/TRNSCN-2982
```

## 觸發條件

用戶說：
- "/hotfix <描述或 Jira URL>"
- "緊急修復"、"hotfix"、"quick fix"、"快速修復"

**路由區分**：
- `/hotfix` → 本 skill（快速修復，無 pipeline）
- `/autopilot hotfix` → autopilot skill（完整 pipeline + 審查，見 autopilot SKILL.md）

---

## 核心原則

1. **不走 pipeline** — 不調用 workflow.js，不依賴 state/workflow-state.json
2. **不生成文檔** — 不產出 docs/ 下的任何文件
3. **必須分析清楚再動手** — Phase 1 分析不可跳過
4. **Jira 邏輯統一委派** — 所有 Jira 操作通過 `Skill: jira-mcp-setup` 完成，本 skill 不編寫任何 Jira API 調用

---

## Phase 1: 問題分析（必須完整執行，禁止跳過）

```
1. 解析輸入
   input = 用戶輸入去除 "/hotfix" 後的部分
   isJira = input matches /atlassian\.net\/browse\/([A-Z]+-\d+)/

2. IF isJira → 調用統一 Jira 處理中心
   result = Skill: jira-mcp-setup (
     action: "get_issue",
     url: input,
     mode: "hotfix"
   )
   problemDescription = result.requirement
   // jira-context.json 已由 jira-mcp-setup 寫入
   // result.requirement 包含：標題 + 描述 + Issue 上下文 + 圖片分析

3. ELSE (純文字描述):
   problemDescription = input

4. 結構化分析（必須回答以下全部問題）：

   a. 問題是什麼？ — 症狀描述
   b. 影響範圍？   — 哪些頁面/功能/用戶受影響
   c. 根因假設？   — 基於描述和圖片推斷根因
   d. 涉及文件？   — 用 Grep 定位相關代碼文件
   e. 修復方案？   — 具體改什麼、怎麼改

5. 輸出分析摘要（直接在對話中輸出，不生成文件）

   格式：
   ---
   **分析完成**
   - 問題：{symptom}
   - 影響：{scope}
   - 根因：{root cause}
   - 涉及文件：{file list}
   - 修復方案：{plan}
   ---

6. 複雜度門檻檢測

   if (涉及文件 > 5 個 OR 根因不明確 OR 需要架構級改動) {
     告知用戶：
     "此問題可能超出 hotfix 範圍（涉及 N 個文件 / 根因不明確 / 需要架構改動）。
      建議：
      A. 繼續 hotfix（我會盡力，但風險較高）
      B. 改用 /autopilot hotfix（完整 pipeline + 審查）
      C. 先用 /systematic-debugging 定位根因"
     等待用戶選擇
   }
```

---

## Phase 2: 代碼修復 + 輕量驗證

```
1. 定位目標代碼
   使用 Phase 1 分析結果中的文件列表
   Read 每個相關文件（遵守代碼搜索安全規則）

2. 實施修復
   直接 Edit 目標文件
   每個改動附帶一句話解釋

3. 輕量級驗證（不生成文檔，僅確認不破壞現有功能）

   依次嘗試（有就跑，沒有就跳過）：

   a. TypeScript：npx tsc --noEmit 2>&1 | head -30
      // tsconfig.json 不存在 → 跳過

   b. 構建：npm run build 2>&1 | tail -20
      // package.json 無 build script → 跳過

   c. 測試：npm test 2>&1 | tail -30
      // package.json 無 test script → 跳過

   // 全部跳過也 OK — hotfix 不強制要求項目有構建/測試配置

4. IF 驗證失敗：
   分析錯誤，修復，重新驗證（最多 2 輪）
   if (2 輪後仍失敗) {
     告知用戶具體錯誤，請求指導
   }

5. 輸出修復摘要

   格式：
   ---
   **修復完成**
   - 改動文件：{files with change description}
   - 驗證結果：{build/test result or "項目無構建/測試配置，已跳過"}
   ---
```

---

## Phase 3: Jira 回寫（僅當來源為 Jira ticket 時）

```
1. 檢查 Jira 上下文
   Read state/jira-context.json
   if (文件不存在 OR mcpConfigured == false) {
     // 非 Jira 來源 或 連接不可用，跳過
     直接完成
   }

2. 調用統一 Jira 處理中心回寫
   Skill: jira-mcp-setup (
     action: "write_back",
     context: {
       issueKey: jiraContext.issueKey,
       issueUrl: jiraContext.issueUrl,
       mode: "hotfix",
       changes: [Phase 2 逐條改動描述],
       testResult: Phase 2 構建/測試結果
     }
   )
   // jira-mcp-setup 負責：添加評論 + 轉移狀態（MCP/curl 雙通道）
```

---

## 代碼搜索安全規則（Iron Law 級別）

在 hotfix 過程中搜索和讀取目標項目代碼時，**必須遵守以下規則，否則會觸發 "Request too large (>20MB)" 崩潰**：

```
⛔ 禁止 Read 以下類型的文件（只能用 Grep）：
   - SVG sprite 文件（如 iconfont.svg, icons.svg, sprite.svg）
     → 前端項目的圖標 sprite 文件常超過 20MB
   - 任何 > 2MB 的文件
   - dist/ build/ .next/ out/ 目錄下的任何文件
   - *.min.js *.min.css *.bundle.js *.chunk.js

✅ 搜索圖標引用（如 #icon-xxx）的正確方式：
   // 只在源碼文件中 Grep，排除 SVG 文件本身
   Grep: pattern="#icon-xxx"
         glob="**/*.{vue,tsx,jsx,ts,js,html}"   ← 不包含 .svg
         // 不要 Read SVG 文件，它只是存儲介質

✅ 搜索組件定義的正確方式：
   Grep: pattern="EmptyData|empty-data|暂无数据"
         glob="**/*.{vue,tsx,jsx,ts,js}"
         // 找到文件路徑後，只 Read 那個具體的源碼文件

✅ 查找文件大小（在 Read 之前先確認）：
   Bash: find . -name "*.svg" -size +1M 2>/dev/null | head -5
   // 若命中，改用 Grep，不要 Read
```

**根本原則**：搜索用 Grep，讀取前先確認文件大小，SVG sprite 永遠不 Read。

---

## 異常處理

| 場景 | 處理 |
|------|------|
| Jira 連接失敗 | 由 jira-mcp-setup 處理，降級為 URL 作為描述，Phase 3 跳過 |
| Jira 圖片分析失敗 | 由 jira-mcp-setup 處理，不阻塞主流程 |
| 目標代碼文件 > 2MB | 用 Grep 定位行號，只 Read 目標段落 |
| 構建/測試命令不存在 | 跳過驗證，繼續完成 |
| 構建失敗（修復引入） | 分析錯誤 + 修復，最多 2 輪 |
| 複雜度超出 hotfix 範圍 | Phase 1 門檻檢測，建議用戶切換模式 |
| Jira 回寫失敗 | 由 jira-mcp-setup 處理，記錄警告不阻塞 |

---

## 完成通知

```
Hotfix 完成！

改動文件：
- {file1}: {change description}
- {file2}: {change description}

驗證：{result}
Jira：{issueKey} 已回寫評論 + 狀態已轉移為 {targetStatus}（僅 Jira 來源）

下一步：
- 檢查改動：git diff
- 提交：git add -p && git commit
```

---

## 禁止行為

- **不生成任何 docs/ 文件**（不 PRD、不 code-review.md、不 test-report.md）
- **不調用 workflow.js**（不 init-hotfix、不 advance、不 validate-doc）
- **不讀取或依賴 state/workflow-state.json**
- **不派發任何 Agent**（主 Claude 直接執行全部工作）
- **不跳過 Phase 1 分析**（即使問題看起來很簡單）
- **不編寫內聯 Jira 邏輯**（不直接調用 mcp__atlassian__jira_* 工具，不讀取 ~/.claude/mcp.json）
- **不 Read SVG sprite 文件**（改用 Grep）
- **不 Read > 2MB 的任何文件**
- **不在 dist/ build/ node_modules/ 目錄中搜索**
