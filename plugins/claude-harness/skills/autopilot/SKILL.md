---
name: autopilot
description: "全流程自動模式：從當前狀態一路推進到 DONE，無需人為干預確認。自動推進 MANUAL 節點、派發 Agent、處理失敗回滾，直到項目完成。支持傳入需求描述，自動注入後續流程。"
---

# Autopilot — 全流程自動駕駛

## 用法

```bash
/autopilot <需求描述>                      # 完整流程 + 需求描述
/autopilot greenfield <需求描述>          # 完整流程（默認）
/autopilot feature <需求描述>             # 增量功能
/autopilot hotfix <需求描述>              # 緊急修復
/autopilot                                # 傳統方式（會追問需求）
```

**示例**：
```
/autopilot 構建一個用戶認證系統，支持郵箱註冊、登錄、OAuth登錄、密碼重置
/autopilot feature 添加用戶頭像上傳功能，支持裁剪和壓縮
/autopilot hotfix 修復登錄頁面的 CSRF token 漏洞
```

## 觸發條件

用戶說：
- "/autopilot <需求描述>"
- "/autopilot greenfield <需求描述>"
- "/autopilot feature <需求描述>"
- "/autopilot hotfix <需求描述>"
- "autopilot"（傳統方式）
- "全流程自動"
- "無需確認全程推進"
- "一鍵完成整個流程"

## 參數解析

```
args = 用戶輸入除去 "/autopilot" 後的部分

if (args.length === 0) {
  // 傳統方式，無需求注入
  mode = 'greenfield'
  requirement = null
} else if (args[0] === 'greenfield' || args[0] === 'feature' || args[0] === 'hotfix') {
  // 明確指定模式
  mode = args[0]
  requirement = args.slice(1).join(' ')
} else {
  // 只傳需求描述，默認 greenfield
  mode = 'greenfield'
  requirement = args.join(' ')
}
```

### Jira URL 檢測（在上述解析後執行）

```
// Jira URL 檢測
if (requirement matches /atlassian\.net\/browse\/([A-Z]+-\d+)/) {
  // 調用統一的 Jira 處理中心
  result = Skill: jira-mcp-setup (
    action: "get_issue",
    url: requirement,
    mode: "autopilot"
  )

  requirement = result.requirement

  // 根據 issue type 自動選擇 mode
  if (result.context.issueType in ['故障', 'Bug', 'bug']) {
    mode = 'hotfix'
  } else if (result.context.issueType in ['Story', 'Task', '任務']) {
    mode = 'feature'
  }
  // 否則保持 mode = 'greenfield'
}
```

> **注意**：所有 Jira 處理邏輯已封裝在 `jira-mcp-setup` skill 中，autopilot 只調用統一入口。

## 路徑解析（必須最優先執行）

**每次執行 Autopilot 的第一個 Bash 命令必須是路徑解析：**

```bash
_w=scripts/workflow.js; test -f "$_w" || _w=$(ls $HOME/.claude/plugins/cache/claude-harness/claude-harness/*/scripts/workflow.js 2>/dev/null|tail -1); echo "$_w" > /tmp/.harness_wf; echo "harness: $_w"
```

後續所有 workflow 命令統一使用以下格式（替代裸 `node scripts/workflow.js`）：

```bash
HARNESS_ROOT=$PWD node "$(cat /tmp/.harness_wf)" <subcommand>
```

---

## 前置檢查

```
1. 確認 autopilot 模式已啟用：
   - 已啟用 → 繼續執行
   - 未啟用 → 先執行啟用流程
```

### 啟用流程（若未啟用）

```
Read state/workflow-state.json

if (!state.autopilot) {
  // 如果有需求描述，直接啟用，無需詢問
  if (requirement) {
    Bash: HARNESS_ROOT=$PWD node "$(cat /tmp/.harness_wf)" init-autopilot <mode> "<requirement>"
  } else {
    // 傳統方式，詢問用戶選擇模式
    問用戶：
    "🤖 Autopilot 模式將自動推進所有 MANUAL 節點（PRD_DRAFT、CEO_REVIEW、DESIGN_PHASE、QA_PHASE、DEPLOY_PREP），無需人為確認。

     選擇模式：
     A. greenfield — 全新項目，完整流程
     B. feature    — 增量功能，跳過 Arch/Design 階段

     確認啟用？(A/B)"

    用戶選擇後：
    Bash: HARNESS_ROOT=$PWD node "$(cat /tmp/.harness_wf)" init-autopilot <greenfield|feature>
  }
}
```

---

## 核心循環

```
while (currentState !== 'DONE') {
  1. Read state/workflow-state.json → 獲取 currentState
  2. 檢查前置條件 → HARNESS_ROOT=$PWD node "$(cat /tmp/.harness_wf)" check
  3. 派發對應 Agent（見派發表）
  4. 等待 Agent 完成（檢查產出物）
  5. 推進狀態 → HARNESS_ROOT=$PWD node "$(cat /tmp/.harness_wf)" advance
  6. 處理異常（見異常處理表）
}
```

---

## 狀態派發表

| 狀態 | 派發 Agent | 產出物 | 驗收命令 |
|------|-----------|--------|---------|
| IDEA | product-manager | `docs/prd.md` | `validate-doc prd` |
| PRD_DRAFT | — 自動推進 | — | `advance` (autopilot auto-force) |
| PRD_REVIEW | software-architect | `docs/arch-decision.md`<br>`docs/security-baseline.md`<br>`docs/traceability-matrix.md` | `validate-doc arch`<br>`validate-doc security-baseline` |
| ARCH_REVIEW | ux-designer | `DESIGN.md`<br>`docs/design-spec.md` | `validate-doc design-spec`<br>`check CEO_REVIEW` |
| CEO_REVIEW | plan-ceo-review | `docs/ceo-review.md` | `validate-doc ceo-review` |
| DESIGN_PHASE | — 自動推進 | `docs/interaction-spec.md` | `validate-doc interaction-spec` |
| DESIGN_REVIEW | fullstack-engineer | 代碼<br>`docs/api-spec.md` | `validate-doc api-spec`<br>`integration-check` |
| IMPLEMENTATION | code-reviewer | `docs/code-review.md` | `validate-doc code-review`（如有） |
| CODE_REVIEW | qa-engineer | `docs/test-plan.md`<br>`docs/test-report.md` | `validate-doc test-report` |
| QA_PHASE | — 自動推進 | — | `advance` (autopilot auto-force) |
| SECURITY_REVIEW | security-auditor | `docs/security-report.md` | — |
| DEPLOY_PREP_SETUP | devops-engineer | `docs/deploy-plan.md`<br>`docs/runbook.md` | `validate-doc deploy-plan` |
| DEPLOY_PREP | — 自動推進 | — | `advance` (autopilot auto-force) |
| DONE | — 結束 | — | 🎉 |

---

## Agent 派發模板

### IDEA → PRD_DRAFT

```
Agent: product-manager

// 檢查是否有需求注入
Read state/autopilot-requirement.md

Prompt:
"
你是 Product Manager，負責生成 PRD。

[Autopilot 模式]
- 跳過 office-hours 追問環節
- 使用合理的假設填補信息缺口
- Appetite 默認 Small Batch
- Scope mode 默認 core

[需求注入]
- 如果存在 state/autopilot-requirement.md，直接讀取其中的需求描述作為初始需求
- 基於該需求生成 PRD，無需追問用戶

目標：生成 docs/prd.md

完成後執行：
HARNESS_ROOT=$PWD node "$(cat /tmp/.harness_wf)" validate-doc prd
HARNESS_ROOT=$PWD node "$(cat /tmp/.harness_wf)" advance
"
```

### PRD_REVIEW → ARCH_REVIEW

```
Agent: software-architect

Prompt:
"
你是 Software Architect，負責架構決策。

前置：Read docs/prd.md

目標：
1. 產出 docs/arch-decision.md（含 4 張 ASCII 圖）
2. 產出 docs/security-baseline.md
3. 產出 docs/traceability-matrix.md

完成後執行：
HARNESS_ROOT=$PWD node "$(cat /tmp/.harness_wf)" validate-doc arch
HARNESS_ROOT=$PWD node "$(cat /tmp/.harness_wf)" validate-doc security-baseline
HARNESS_ROOT=$PWD node "$(cat /tmp/.harness_wf)" advance
"
```

### ARCH_REVIEW → CEO_REVIEW

```
Agent: ux-designer

Prompt:
"
你是 UX Designer，負責設計系統和視覺規範。

前置（按順序）：
1. 執行 designer.md 模式 0 Step 0 — 檢測現有設計系統（組件庫 / theme 文件 / CSS 變量）
2. Read docs/prd.md, docs/arch-decision.md
3. 根據模式 0 結論路由：
   - 存量項目（SRC_FILES > 20 或檢測到組件庫）→ 路徑 A：文檔化現有設計系統
   - 全新項目 → 路徑 B：競品研究 + 設計方向提案

目標：
1. 產出 DESIGN.md（存量項目：文檔化現有系統；全新項目：全新設計系統）
2. 產出 docs/design-spec.md（80 項審計 ≥40/80；存量項目組件規範基於已有組件庫）
3. 直接編寫 HTML/CSS 設計稿（不調用 Stitch MCP，由 Designer 自行實現）
   - 為 design-spec.md 中每個頁面生成 design/{page-slug}/desktop.html
   - 生成 design/index.html 作為設計稿入口
   - 存量項目：設計稿視覺風格須與現有組件庫一致

[注意] 不使用任何 MCP 工具生成設計稿，完全由 Designer 自行用 HTML/CSS/內聯樣式編寫，確保真實體現設計系統視覺規範。

完成後執行：
HARNESS_ROOT=$PWD node "$(cat /tmp/.harness_wf)" validate-doc design-spec
HARNESS_ROOT=$PWD node "$(cat /tmp/.harness_wf)" check CEO_REVIEW
HARNESS_ROOT=$PWD node "$(cat /tmp/.harness_wf)" advance
"
```

### CEO_REVIEW → DESIGN_PHASE

```
Agent: plan-ceo-review

Prompt:
"
你是 CEO Reviewer，負責 UX 邏輯審視。

前置：Read docs/prd.md, docs/arch-decision.md, docs/design-spec.md

目標：產出 docs/ceo-review.md
- 對 5 個維度評分（0-10）
- 提供決策建議
- 平均分低於 6 分時建議回滾

[Autopilot 模式]
- 自動接受所有建議
- 不要求用戶確認

完成後執行：
HARNESS_ROOT=$PWD node "$(cat /tmp/.harness_wf)" validate-doc ceo-review
HARNESS_ROOT=$PWD node "$(cat /tmp/.harness_wf)" advance
"
```

### DESIGN_PHASE → DESIGN_REVIEW

```
[Autopilot 模式]
- 跳過交互意圖確認環節
- Designer 直接生成 interaction-spec.md

Agent: ux-designer (Phase B)

Prompt:
"
繼續 DESIGN_PHASE 階段 Phase B。

[Autopilot 模式]
- 用戶已自動確認所有交互意圖
- 直接將默認交互行為寫入 docs/interaction-spec.md

完成後執行：
HARNESS_ROOT=$PWD node "$(cat /tmp/.harness_wf)" validate-doc interaction-spec
HARNESS_ROOT=$PWD node "$(cat /tmp/.harness_wf)" advance
"
```

### DESIGN_REVIEW → IMPLEMENTATION

```
Agent: fullstack-engineer

Prompt:
"
你是 Full-Stack Engineer，負責 API 先行 → BE → FE 全棧實現。

前置（按順序讀取）：
1. docs/arch-decision.md  → 技術棧決策（存量項目在此確認現有框架）
2. docs/traceability-matrix.md
3. docs/design-spec.md（如存在）
4. DESIGN.md（如存在）
5. 項目根目錄 package.json / requirements.txt → 確認現有依賴

目標：
1. 寫 docs/api-spec.md（API 先行）
2. 實現 BE（按 docs/arch-decision.md 技術棧；若無 ADR 或全新項目則用 Bun + Hono + Drizzle）
3. 實現 FE（按 docs/arch-decision.md 技術棧；若無 ADR 或全新項目則用 Next.js + React + shadcn）
4. 更新追溯矩陣所有 Must 為 ✅

完成後執行：
HARNESS_ROOT=$PWD node "$(cat /tmp/.harness_wf)" validate-doc api-spec
HARNESS_ROOT=$PWD node "$(cat /tmp/.harness_wf)" integration-check
HARNESS_ROOT=$PWD node "$(cat /tmp/.harness_wf)" advance
"
```

### IMPLEMENTATION → CODE_REVIEW

```
Agent: code-reviewer

Prompt:
"
你是 Code Reviewer，負責代碼審查。

前置：Read docs/api-spec.md, docs/arch-decision.md

目標：產出 docs/code-review.md
- 構建驗證：npm run build
- 類型檢查：npx tsc --noEmit
- 設計合規：對照 design/ 檢查實現

若 FAIL：詳細列出問題，要求 FE/BE 修復

完成後執行：
HARNESS_ROOT=$PWD node "$(cat /tmp/.harness_wf)" advance
"
```

### CODE_REVIEW → QA_PHASE

```
Agent: qa-engineer

Prompt:
"
你是 QA Engineer，負責測試。

前置：Read docs/traceability-matrix.md, docs/api-spec.md

目標：
1. 產出 docs/test-plan.md
2. 執行測試（單元 + E2E + 視覺回歸）
3. 產出 docs/test-report.md

若發現 P0/P1 bug：
- 執行 HARNESS_ROOT=$PWD node "$(cat /tmp/.harness_wf)" qa-failure
- 等待修復後重新測試

完成後執行：
HARNESS_ROOT=$PWD node "$(cat /tmp/.harness_wf)" validate-doc test-report
HARNESS_ROOT=$PWD node "$(cat /tmp/.harness_wf)" advance
"
```

### QA_PHASE → SECURITY_REVIEW

```
[Autopilot 自動推進]
HARNESS_ROOT=$PWD node "$(cat /tmp/.harness_wf)" advance
```

### SECURITY_REVIEW → DEPLOY_PREP_SETUP

```
Agent: security-auditor

Prompt:
"
你是 Security Auditor，負責 OWASP 審計。

前置：Read docs/security-baseline.md

目標：產出 docs/security-report.md
- OWASP Top 10 掃描
- 依賴漏洞檢查
- 威脅建模

若發現 Critical/High：
- 列出修復建議
- 等待修復後執行 security-reaudit

完成後執行：
HARNESS_ROOT=$PWD node "$(cat /tmp/.harness_wf)" advance
"
```

### DEPLOY_PREP_SETUP → DEPLOY_PREP

```
Agent: devops-engineer

Prompt:
"
你是 DevOps Engineer，負責部署準備。

前置：Read docs/prd.md, docs/arch-decision.md

目標：
1. 產出 docs/deploy-plan.md
2. 產出 docs/runbook.md
3. 配置 CI/CD（GitHub Actions）
4. 寫 Dockerfile

完成後執行：
HARNESS_ROOT=$PWD node "$(cat /tmp/.harness_wf)" validate-doc deploy-plan
HARNESS_ROOT=$PWD node "$(cat /tmp/.harness_wf)" advance
"
```

### DEPLOY_PREP → DONE

```
[Autopilot 自動推進]
HARNESS_ROOT=$PWD node "$(cat /tmp/.harness_wf)" advance

// Jira 回寫（如果本次流程來源於 Jira ticket）
if (state/jira-context.json 存在) {
  // 收集元數據供回寫使用
  fixTime = Bash: date "+%Y-%m-%d %H:%M:%S %Z"

  Skill: jira-mcp-setup (
    action: "write_back",
    context: {
      issueKey: jiraIssueKey,
      issueUrl: jiraIssueUrl,
      mode: "autopilot",
      fixTime: fixTime,
      changes: [摘要列表],
      testResult: "通過/失敗"
    }
  )
}

🎉 流程完成！
```

---

## 異常處理

| 異常 | 檢測方式 | 處理 |
|------|---------|------|
| 前置條件缺失 | `check` 返回 missing | 派發對應 Agent 補產出物 |
| validate-doc 失敗 | 返回 non-zero | 派發 Agent 修復，重新驗證 |
| Code Review FAIL | code-review.md 含 FAIL | 派發 fullstack-engineer 修復，rollback IMPLEMENTATION |
| QA P0/P1 bug | test-report.md 含 P0/P1 | 執行 qa-failure，派發 fullstack-engineer 修復 |
| Security Critical/High | security-report.md 含 Critical | 派發 fullstack-engineer 修復，執行 security-reaudit |
| CEO 審視 < 6分 | ceo-review.md 平均分 < 6 | rollback PRD_REVIEW，重新審視需求 |
| Agent 超時/失敗 | 無產出物 | 重試 1 次，仍失敗則暫停 autopilot |

---

## 暫停/恢復

### 暫停 Autopilot

```
用戶說："暫停"、"停止 autopilot"、"我要確認"

執行：
HARNESS_ROOT=$PWD node "$(cat /tmp/.harness_wf)" stop-autopilot

告知用戶當前狀態，等待進一步指令。
```

### 恢復 Autopilot

```
用戶說："繼續 autopilot"、"恢復自動"

執行：
HARNESS_ROOT=$PWD node "$(cat /tmp/.harness_wf)" init-autopilot <mode>

繼續核心循環。
```

---

## 完成通知

當 `currentState === 'DONE'` 時：

```
🎉 全流程自動完成！

產出物：
- docs/prd.md
- docs/arch-decision.md
- docs/security-baseline.md
- DESIGN.md
- docs/design-spec.md
- docs/interaction-spec.md
- docs/api-spec.md
- docs/traceability-matrix.md
- docs/code-review.md
- docs/test-plan.md
- docs/test-report.md
- docs/security-report.md
- docs/deploy-plan.md
- docs/runbook.md
- apps/web/ (FE 代碼)
- apps/server/ (BE 代碼)

下一步：
- 查看部署計劃：cat docs/deploy-plan.md
- 運行應用：npm run dev
- 部署到生產：按 runbook.md 執行
```

---

## 禁止行為

- 不跳過產出物驗證（validate-doc 必須通過）
- 不在 FAIL 狀態下推進
- 不忽略 Critical/High 安全漏洞
- 不繞過 qa-failure 機制
- 不在用戶主動暫停時繼續推進
