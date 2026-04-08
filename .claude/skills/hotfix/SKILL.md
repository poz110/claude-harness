---
name: hotfix
description: "緊急修復模式：跳過架構/設計/實現階段，直接進入代碼審查。自動啟用 autopilot，適用於緊急 bug 修復或小範圍單文件改動。"
---

# Hotfix — 緊急修復快速通道

## 用法

```bash
/hotfix <需求描述>    # 啟動 hotfix 模式 + 需求注入
/hotfix              # 啟動 hotfix 模式（手動描述需求）
```

**示例**：
```
/hotfix 修復登錄頁面的 CSRF token 漏洞
/hotfix 用戶反饋密碼重置郵件無法發送
/hotfix 修復首頁在 Safari 下的 CSS 兼容問題
```

## 觸發條件

用戶說：
- "/hotfix <需求描述>"
- "緊急修復"、"hotfix"、"快速修復"
- "跳過設計直接審查代碼"

## 前置檢查

```
1. 確認項目狀態：
   Read state/workflow-state.json
   若 currentState !== 'IDEA'，告知用戶需要先重置到 IDEA
```

## 執行流程

```
1. 執行需求解析：
   requirement = 用戶輸入去除 "/hotfix" 後的部分

1.5. Jira URL 檢測（調用統一的 jira-mcp-setup skill）：

   if (requirement matches /atlassian\.net\/browse\/([A-Z]+-\d+)/) {

     // 調用統一的 Jira 處理中心
     result = Skill: jira-mcp-setup (
       action: "get_issue",
       url: requirement,
       mode: "hotfix"
     )

     requirement = result.requirement
     // jira-context.json 已由 skill 寫入
   }

   // 注意：若 Atlassian MCP 未配置，skill 會降級返回原始 URL

2. 啟動 hotfix 模式：
   Bash: node scripts/workflow.js init-hotfix <requirement>

3. 進入核心推進循環（見下文）
```

---

## 核心推進循環

```
while (currentState !== 'DONE') {
  1. Read state/workflow-state.json → 獲取 currentState
  2. 派發對應 Agent（見派發表）
  3. 等待 Agent 完成（檢查產出物）
  4. 推進狀態 → node scripts/workflow.js advance
  5. 處理異常（見異常處理表）
}
```

---

## 狀態派發表（Hotfix 模式）

| 狀態 | 派發 Agent | 產出物 | 備註 |
|------|-----------|--------|------|
| IDEA | product-manager | `docs/prd.md` | hotfix 模式快速生成精簡 PRD |
| PRD_DRAFT | — 自動推進 | — | autopilot auto-force |
| PRD_REVIEW | software-architect | `docs/arch-decision.md`<br>`docs/security-baseline.md` | hotfix 模式下可選（跳過也行） |
| ~~ARCH_REVIEW~~ | ⏭ 自動跳過 | — | |
| ~~CEO_REVIEW~~ | ⏭ 自動跳過 | — | |
| ~~DESIGN_PHASE~~ | ⏭ 自動跳過 | — | |
| ~~DESIGN_REVIEW~~ | ⏭ 自動跳過 | — | |
| ~~IMPLEMENTATION~~ | ⏭ 自動跳過 | — | hotfix 核心：跳過實現階段 |
| CODE_REVIEW | code-reviewer | `docs/code-review.md` | 核心審查階段 |
| QA_PHASE | qa-engineer | `docs/test-plan.md`<br>`docs/test-report.md` | |
| SECURITY_REVIEW | security-auditor | `docs/security-report.md` | |
| DEPLOY_PREP_SETUP | devops-engineer | `docs/deploy-plan.md`<br>`docs/runbook.md` | |
| DEPLOY_PREP | — 自動推進 | — | autopilot auto-force |
| DONE | — 結束 | — | 🎉 |

---

## Agent 派發模板

### IDEA → PRD_DRAFT

```
Agent: product-manager

// 檢查需求注入
Read state/autopilot-requirement.md

Prompt:
"
你是 Product Manager，負責生成緊急修復的 PRD。

[Hotfix 模式]
- 跳過 office-hours 追問環節
- 使用合理假設填補信息缺口
- PRD 應該非常精簡（1-2 頁），只描述：
  1. 問題描述（症狀 + 影響範圍）
  2. 修復方案（技術方案）
  3. 驗收標準（Gherkin scenario）

目標：生成 docs/prd.md

完成後執行：
node scripts/workflow.js validate-doc prd
node scripts/workflow.js advance
"
```

### CODE_REVIEW → QA_PHASE

```
Agent: code-reviewer

Prompt:
"
你是 Code Reviewer，負責審查 hotfix 代碼變更。

前置：Read docs/prd.md

目標：產出 docs/code-review.md
- 構建驗證：npm run build
- 類型檢查：npx tsc --noEmit
- 驗證修復符合 PRD 中的技術方案

若 FAIL：詳細列出問題，要求修復

完成後執行：
node scripts/workflow.js advance
"
```

### QA_PHASE → SECURITY_REVIEW

```
Agent: qa-engineer

Prompt:
"
你是 QA Engineer，負責測試 hotfix 變更。

前置：Read docs/prd.md, docs/code-review.md

目標：
1. 產出 docs/test-plan.md
2. 執行測試（聚焦修復影響範圍）
3. 產出 docs/test-report.md

完成後執行：
node scripts/workflow.js advance
"
```

### DONE — Jira 回寫

```
// 若本次流程來源於 Jira ticket
if (state/jira-context.json 存在) {
  Read state/jira-context.json → { issueKey, issueUrl }

  fixer   = "Claude Hotfix Agent"
  fixTime = Bash: date "+%Y-%m-%d %H:%M:%S %Z"

  comment = 生成摘要，格式如下：
    **修復人**：{fixer}
    **修復時間**：{fixTime}
    ---
    - 修復點（來自 docs/prd.md）
    - 主要改動文件（如有 docs/code-review.md 則引用）
    - 測試結果（如有 docs/test-report.md）

  mcp__atlassian__jira_add_comment(issueKey, comment)
  mcp__atlassian__jira_transition_issue(issueKey, targetStatus)  // 選最接近「完成/提測」的狀態
}
```

---

## 異常處理

| 異常 | 處理 |
|------|------|
| CODE_REVIEW FAIL | 派發 fullstack-engineer 修復，rollback CODE_REVIEW |
| QA P0/P1 bug | 執行 qa-failure，派發 fullstack-engineer 修復 |
| Security Critical/High | 派發 fullstack-engineer 修復 |

---

## 完成通知

當 `currentState === 'DONE'` 時：

```
🎉 Hotfix 流程完成！

產出物：
- docs/prd.md（緊急修復 PRD）
- docs/code-review.md
- docs/test-plan.md + docs/test-report.md
- docs/security-report.md
- docs/deploy-plan.md + docs/runbook.md

下一步：
- 查看部署計劃：cat docs/deploy-plan.md
- 部署到生產：按 runbook.md 執行
```

---

## 禁止行為

- 不跳過 CODE_REVIEW（hotfix 核心階段）
- 不在 FAIL 狀態下推進
- 不繞過 qa-failure 機制
