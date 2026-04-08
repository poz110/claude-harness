---
name: autopilot
description: "全流程自動模式：從當前狀態一路推進到 DONE，無需人為干預確認。自動推進 MANUAL 節點、派發 Agent、處理失敗回滾，直到項目完成。支持傳入需求描述，自動注入後續流程。可選關聯 Jira Issue，自動獲取需求並在完成後回寫狀態。"
---

# Autopilot — 全流程自動駕駛

## 用法

```bash
/autopilot <需求描述 或 Jira URL/Key>              # 完整流程
/autopilot greenfield <需求描述 或 Jira URL/Key>   # 完整流程（默認）
/autopilot feature <需求描述 或 Jira URL/Key>      # 增量功能
/autopilot hotfix <需求描述 或 Jira URL/Key>       # 緊急修復
/autopilot                                         # 傳統方式（會追問需求）
```

**示例**：
```
/autopilot 修復 PROJ-123：個人頁面余額顯示異常
/autopilot https://myteam.atlassian.net/browse/PROJ-123
/autopilot https://jira.mycompany.com/browse/BACKEND-456
/autopilot feature PROJ-789 添加用戶頭像上傳功能
/autopilot feature 添加用戶頭像上傳功能，支持裁剪和壓縮
```

---

## 觸發條件

用戶說：
- "/autopilot <任意>"
- "/autopilot greenfield <任意>"
- "/autopilot feature <任意>"
- "/autopilot hotfix <任意>"
- "autopilot"（傳統方式）
- "全流程自動"
- Jira URL（自動識別並提取 issue key）
- 裸 Jira Key（如 `PROJ-123`，自動識別）

---

## 參數解析

```
args = 用戶輸入除去 "/autopilot" 後的部分

1. 解析 Jira URL 或裸 Key（如存在）：

   a) Atlassian Cloud URL：
      正則：https?://([^/]+\.atlassian\.net)/browse/([A-Z][A-Z0-9]+-\d+)
      提取：jira_base_url = https://<host>, issue_key = <key>

   b) Self-hosted Jira URL：
      正則：https?://([^/]+)/browse/([A-Z][A-Z0-9]+-\d+)
      提取：jira_base_url = https://<host>, issue_key = <key>

   c) 裸 Key（無 URL，直接出現 PROJ-123 格式）：
      正則：\b([A-Z][A-Z0-9]+-\d+)\b
      提取：issue_key = <key>, jira_base_url = 待 MCP 探測後確定

2. 判斷 mode：
   - args[0] === 'greenfield' → mode = 'greenfield', requirement = args.slice(1).join(' ')
   - args[0] === 'feature'    → mode = 'feature', requirement = args.slice(1).join(' ')
   - args[0] === 'hotfix'     → mode = 'hotfix', requirement = args.slice(1).join(' ')
   - 否則 → mode = 'greenfield', requirement = args.join(' ')

3. Jira issue key 和 requirement 獨立處理：
   - issue_key 用於 Jira 讀寫
   - jira_base_url 用於生成瀏覽鏈接
   - requirement 作為備用/補充需求描述（從 args 中移除 URL/Key 後的部分）
```

---

## 路徑解析（必須最優先執行）

```bash
_w=scripts/workflow.js
if ! [ -f "$_w" ]; then
  _w=$(ls $HOME/.claude/plugins/marketplaces/claude-harness/scripts/workflow.js 2>/dev/null)
fi
if ! [ -f "$_w" ]; then
  _w=$(ls $HOME/.claude/plugins/cache/claude-harness/claude-harness/*/scripts/workflow.js 2>/dev/null|tail -1)
fi
echo "$_w" > /tmp/.harness_wf
echo "harness: $_w"
```

---

## 前置檢查

### Step 0 — MCP 環境預檢（自動檢測 Jira MCP）

**在做任何 Jira 相關操作之前，先確認 Jira MCP 是否可用：**

#### Step 0a — 嘗試調用 MCP 工具

直接用解析出的 `issue_key` 探測 MCP 是否加載：

```
Tool: mcp__atlassian__jira_get_issue
Arguments: { "issue_key": "<issue_key>" }
```

#### Step 0b — 判斷結果並處理

**情況 1：MCP 工具有響應**（包括 404/Not Found，說明工具已加載）
→ Jira MCP 環境正常，繼續後續步驟。

**情況 2：MCP 工具不可用**（工具不存在 / 調用報錯 / 超時）
→ 執行以下分步安裝引導：

```bash
# 檢測 uvx 是否存在
command -v uvx 2>/dev/null && echo "uvx OK" || echo "uvx MISSING"
```

**如果 uvx 缺失**，輸出安裝引導：

```
❌ Jira MCP 未安裝。需要按以下步驟配置：

📦 第一步：安裝 uv（Python 包管理器）
  macOS:   brew install uv
  其他系統: pip install uv

📝 第二步：添加 MCP 配置
  在 .claude/settings.json 的 "mcpServers" 中添加：

  "atlassian": {
    "command": "uvx",
    "args": [
      "mcp-remote",
      "https://mcp.atlassian.com/v1/sse"
    ]
  }

  完整 settings.json 示例：
  {
    "mcpServers": {
      "atlassian": {
        "command": "uvx",
        "args": [
          "mcp-remote",
          "https://mcp.atlassian.com/v1/sse"
        ]
      }
    }
  }

🔄 第三步：重啟 Claude Code
  退出當前會話，在項目目錄重新運行 claude
  首次啟動時會提示 Atlassian OAuth 授權，按提示完成即可

完成以上步驟後，再次執行 /autopilot <Jira URL/Key>
```

**如果 uvx 已存在但 MCP 工具不可用**，輸出：

```
❌ Jira MCP 未加載（uvx 已安裝）

可能原因：
1. 未在 .claude/settings.json 中配置 atlassian MCP
2. 已配置但需要重啟

📝 請確認 .claude/settings.json 包含：
  "mcpServers": {
    "atlassian": {
      "command": "uvx",
      "args": ["mcp-remote", "https://mcp.atlassian.com/v1/sse"]
    }
  }

然後重啟 Claude Code 後重試。
```

**重要：不要在 MCP 不可用的情況下繼續執行 Phase 0.1 及後續步驟。**

---

## Phase 0 — Jira Issue 分析（可選，URL/Key 模式時執行）

> 當用戶傳入 Jira URL、裸 Jira Key、或在描述中包含 Jira issue key 時執行。
> 如果沒有 Jira 信息，則跳過 Phase 0，直接進入 Phase 1。

### Step 0.1 — 從輸入提取 Issue Key 和 Base URL

按參數解析規則提取：
- 從 URL 提取：`issue_key` + `jira_base_url`
- 從裸 Key 提取：`issue_key`（`jira_base_url` 由 MCP 響應推斷）

### Step 0.2 — 獲取完整 Jira Issue 信息

直接調用 MCP 工具（無需 Bash 腳本）：

```
Tool: mcp__atlassian__jira_get_issue
Arguments: { "issue_key": "<issue_key>" }
```

返回完整 issue 數據：
- summary、description（含富文本格式）
- status、priority、assignee、labels、components
- attachments（附件列表及下載 URL）
- comments
- project name 和 project key

### Step 0.3 — 項目匹配驗證

**在繼續處理前，必須驗證此 Jira issue 確實對應當前代碼倉庫。**

分析以下維度：

```
1. 項目名稱匹配：
   - 讀取 package.json 的 name / description
   - 與 Jira issue 的 project name、labels、components 對比

2. 技術棧匹配：
   - 當前倉庫的技術棧（從 package.json 依賴 / 文件結構推斷）
   - Jira issue 的 labels 中是否有技術棧標籤（前端/後端/iOS/Android 等）
   - 如 issue 標籤為 "iOS" 但倉庫是 React 項目 → 不匹配

3. 代碼路徑驗證（如 issue 描述中提到具體文件/組件）：
   - 用 Grep/Glob 驗證描述中提到的文件路徑或組件名是否存在於當前倉庫
```

**判斷邏輯：**

- **高度匹配**（項目名吻合 或 描述中的文件路徑都存在）→ 輸出確認信息，繼續：
  ```
  ✅ 項目匹配驗證通過：<issue_key> 屬於當前項目 <project-name>
  ```

- **不確定**（部分匹配或信息不足）→ 用 `AskUserQuestion` 詢問用戶：
  ```
  ⚠️ 無法確認 <issue_key> 是否屬於當前項目
  Jira 項目：<jira-project-name>
  當前倉庫：<repo-name>
  是否繼續處理此 issue？
  ```

- **明顯不匹配**（技術棧衝突 或 項目名完全不同）→ **停止**：
  ```
  ❌ 項目不匹配：<issue_key> 屬於 Jira 項目 "<jira-project-name>"，
  但當前倉庫為 "<repo-name>"（<tech-stack>）。
  請在正確的項目目錄下重新執行。
  ```

### Step 0.4 — 分析截圖（如有）

**如果 description 或 attachments 中有圖片，按以下方式處理：**

⛔ **禁止**直接使用 `mcp__atlassian__jira_get_issue_images` 或類似工具。該方式會將 base64 圖片注入對話歷史，一旦圖片下載失敗（CloudFront 返回 HTML 重定向頁面），會導致 `400 Could not process image` 錯誤並污染對話歷史（Poisoned Context）。

**正確方式：下載 → 驗證 → Read**

```bash
mkdir -p temp
# 從項目根目錄的 .env 或 .env.local 加載 Jira 憑證
export $(grep -E "JIRA_EMAIL|JIRA_API_TOKEN" .env.local 2>/dev/null | xargs)
export $(grep -E "JIRA_EMAIL|JIRA_API_TOKEN" .env 2>/dev/null | xargs)

# 下載圖片（--location-trusted 確保 http→https 重定向時保留 auth header）
curl -L --location-trusted -f -s -u "${JIRA_EMAIL}:${JIRA_API_TOKEN}" \
  "<image-url>" -o temp/jira-screenshot.png

# 驗證是否真的是圖片（防止保存了 HTML 錯誤頁）
file_type=$(file -b temp/jira-screenshot.png 2>/dev/null)
if echo "$file_type" | grep -qiE "PNG|JPEG|GIF|WebP|image"; then
  echo "✅ Valid image: $file_type"
else
  echo "⚠️ Download failed, not an image (got: $file_type) — skip image"
  rm -f temp/jira-screenshot.png
fi
```

驗證通過後用 `Read` 工具查看 `temp/jira-screenshot.png`。

**分析截圖重點：**
1. **紅色標注/框選區域**：問題所在位置
2. **文字說明**：具體的問題描述或修復要求
3. **對比分析**：當前狀態 vs 期望狀態
4. **UI 元素定位**：根據截圖定位代碼位置

### Step 0.5 — 整合需求描述

結合以下信息生成完整需求描述：

- Jira issue summary & description
- **截圖中的紅色標注和文字說明**
- 評論區的補充說明

將最終需求描述寫入 `state/autopilot-requirement.md`（覆蓋），格式：

```markdown
# Autopilot Requirement

## Source
Jira Issue: <issue_key>
URL: <jira_base_url>/browse/<issue_key>

## Summary
<issue summary>

## Description
<issue description + 截圖分析結果>

## Labels
<labels>
```

---

## Phase 1 — PRD + 追溯矩陣（product-manager，合併生成）

> **優化：PM 一次性生成 docs/prd.md 和 docs/traceability-matrix.md**

用 `Agent` 工具調用 `product-manager`：

```
subagent_type: "product-manager"
prompt: |
  你是 product-manager agent，請完成以下兩項任務。

  ## 信息來源（按優先級）
  1. 如果存在 state/autopilot-requirement.md，優先讀取其中的需求描述
  2. 如果是 Jira issue，則包含以下信息：
     - Key: <issue_key>
     - Summary: <summary>
     - Description: <description>

  ## 任務一：生成 docs/prd.md
  - Feature 模式 PRD，只描述本次新增/修改功能
  - 如果有 state/autopilot-requirement.md，直接基於該文件生成
  - 技術棧：根據現有項目 package.json 判斷（存量項目適配）
  - 參考 docs/seeds/arch-decision.md（如存在）
  - 參考 docs/seeds/security-baseline.md（如存在）
  - 參考 docs/seeds/design-spec.md（如存在）

  ## 任務二：生成 docs/traceability-matrix.md
  基於剛寫完的 docs/prd.md，立即生成追溯矩陣：
  - 每個 PRD Must/Should 功能 → 預期實現文件路徑
  - 對應 Gherkin 驗收場景（1-2 條）
  - 實現狀態標為 ⬜ pending

  ⚠️ 兩個文件都寫完後直接結束，不要運行任何 workflow 命令
```

等待完成後：

```bash
HARNESS_ROOT=$PWD node "$(cat /tmp/.harness_wf)" check
HARNESS_ROOT=$PWD node "$(cat /tmp/.harness_wf)" advance
HARNESS_ROOT=$PWD node "$(cat /tmp/.harness_wf)" advance --force  # PRD_DRAFT → PRD_REVIEW
HARNESS_ROOT=$PWD node "$(cat /tmp/.harness_wf)" advance         # PRD_REVIEW → ARCH_REVIEW
```

---

## Phase 2 — 架構決策（software-architect）

> **greenfield/hotfix 模式執行；feature 模式跳過**

用 `Agent` 工具調用 `software-architect`：

```
subagent_type: "software-architect"
prompt: |
  你是 Software Architect，負責架構決策。

  前置：Read docs/prd.md

  目標：
  1. 產出 docs/arch-decision.md（含 4 張 ASCII 圖）
  2. 產出 docs/security-baseline.md
  3. 更新 docs/traceability-matrix.md

  完成後執行：
  HARNESS_ROOT=$PWD node "$(cat /tmp/.harness_wf)" validate-doc arch
  HARNESS_ROOT=$PWD node "$(cat /tmp/.harness_wf)" validate-doc security-baseline
  HARNESS_ROOT=$PWD node "$(cat /tmp/.harness_wf)" advance
```

等待完成後：

```bash
HARNESS_ROOT=$PWD node "$(cat /tmp/.harness_wf)" advance --force  # ARCH_REVIEW → CEO_REVIEW
HARNESS_ROOT=$PWD node "$(cat /tmp/.harness_wf)" advance         # CEO_REVIEW → DESIGN_PHASE
HARNESS_ROOT=$PWD node "$(cat /tmp/.harness_wf)" advance --force  # DESIGN_PHASE → DESIGN_REVIEW
```

---

## Phase 3 — 設計系統（ux-designer）

> **greenfield/hotfix 模式執行；feature 模式跳過**

用 `Agent` 工具調用 `ux-designer`：

```
subagent_type: "ux-designer"
prompt: |
  你是 UX Designer，負責設計系統和視覺規範。

  前置（按順序）：
  1. 執行 designer.md 模式 0 Step 0 — 檢測現有設計系統
  2. Read docs/prd.md, docs/arch-decision.md（如存在）

  目標：
  1. 產出 DESIGN.md（存量項目：文檔化現有系統；全新項目：全新設計系統）
  2. 產出 docs/design-spec.md（80 項審計 ≥40/80）
  3. 直接編寫 HTML/CSS 設計稿（design/{page-slug}/desktop.html）

  完成後執行：
  HARNESS_ROOT=$PWD node "$(cat /tmp/.harness_wf)" validate-doc design-spec
  HARNESS_ROOT=$PWD node "$(cat /tmp/.harness_wf)" check CEO_REVIEW
  HARNESS_ROOT=$PWD node "$(cat /tmp/.harness_wf)" advance
```

等待完成後：

```bash
HARNESS_ROOT=$PWD node "$(cat /tmp/.harness_wf)" advance --force  # DESIGN_REVIEW → CEO_REVIEW
HARNESS_ROOT=$PWD node "$(cat /tmp/.harness_wf)" advance         # CEO_REVIEW → DESIGN_PHASE（如需）
```

---

## Phase 4 — 全棧實現（fullstack-engineer）

用 `Agent` 工具調用 `fullstack-engineer`：

```
subagent_type: "fullstack-engineer"
prompt: |
  你是 Full-Stack Engineer，負責 API 先行 → BE → FE 全棧實現。

  前置（按順序讀取）：
  1. docs/arch-decision.md（如存在） → 技術棧決策
  2. docs/traceability-matrix.md
  3. docs/design-spec.md（如存在）
  4. DESIGN.md（如存在）
  5. 項目根目錄 package.json / requirements.txt → 確認現有依賴

  目標：
  1. 寫 docs/api-spec.md（API 先行）
  2. 實現 BE（根據現有技術棧；若無則用 Bun + Hono + Drizzle）
  3. 實現 FE（根據現有技術棧；若無則用 Next.js + React + shadcn）
  4. 更新 docs/traceability-matrix.md 將已實現條目標為 ✅

  ## 構建門禁（動態檢測）
  實現完成後，按以下順序驗證（全部通過才算完成）：
  1. 檢測項目構建工具（package.json 中的 scripts）：
     - 有 `build` script → 執行相應構建命令（npm run build / yarn build / bun run build）
     - 有 `lint` script  → 執行 lint（npm run lint / yarn lint）
     - 無 build script   → 跳過構建驗證，記錄 warning
  2. 構建成功 → 繼續
  3. 構建失敗 → 停在這裡，報告錯誤，不推進

  ⚠️ 完成後直接結束，不要運行任何 workflow 命令
```

等待完成後，**Orchestrator 親自驗證構建**：

```bash
# 檢測構建工具
if grep -q '"build"' package.json 2>/dev/null; then
  if grep -q '"dev"' package.json 2>/dev/null || grep -q '"scripts":.*{[^}]*"build":' package.json | grep -q '"build":'; then
    # 判斷包管理器
    if [ -f yarn.lock ]; then
      yarn build 2>&1 | grep -E "Compiled successfully|ERROR|Failed to compile" || echo "BUILD_OUTPUT_UNCLEAR"
    elif [ -f bun.lockb ]; then
      bun run build 2>&1 | grep -E "Compiled successfully|ERROR|Failed to compile" || echo "BUILD_OUTPUT_UNCLEAR"
    else
      npm run build 2>&1 | grep -E "Compiled successfully|ERROR|Failed to compile" || echo "BUILD_OUTPUT_UNCLEAR"
    fi
  fi
fi
```

- 如果輸出包含 `Compiled successfully` → 繼續
- 如果輸出包含 `Failed to compile` 或 `ERROR` → **停止**，告知用戶具體錯誤
- 如果無 build script → 記錄 warning，繼續

```bash
HARNESS_ROOT=$PWD node "$(cat /tmp/.harness_wf)" check
HARNESS_ROOT=$PWD node "$(cat /tmp/.harness_wf)" advance  # IMPLEMENTATION → CODE_REVIEW
```

---

## Phase 5 — 代碼審查（code-reviewer）

用 `Agent` 工具調用 `code-reviewer`：

```
subagent_type: "code-reviewer"
prompt: |
  你是 Code Reviewer，負責代碼審查。

  前置：Read docs/api-spec.md（如存在）, docs/arch-decision.md（如存在）, docs/prd.md

  審查重點：
  - PRD 功能是否全部實現
  - 技術棗約束合規（根據現有項目棗選型）
  - 顏色/樣式是否使用變量而非寫死 hex
  - 安全：無 eval()、無 localStorage 私鑰

  結果寫入 docs/code-review.md，末尾必须有 ## Verdict: PASS 或 ## Verdict: FAIL。

  ⚠️ 寫完後直接結束，不要運行任何 workflow 命令
```

等待完成後檢查 verdict：

```bash
grep -i "verdict" docs/code-review.md
```

如果是 FAIL → **停止**，向用戶展示 reviewer 意見。

如果是 PASS：

```bash
HARNESS_ROOT=$PWD node "$(cat /tmp/.harness_wf)" advance  # CODE_REVIEW → QA_PHASE
HARNESS_ROOT=$PWD node "$(cat /tmp/.harness_wf)" advance --force  # QA_PHASE → SECURITY_REVIEW
```

---

## Phase 6 — 安全審計（security-auditor）

> **輕量化審計：根據觸碰範圍動態調整**

### Step 6.1 — 快速 grep 安全檢查（Orchestrator 直接執行）

```bash
CHANGED_FILES=$(git diff --name-only HEAD~1 HEAD 2>/dev/null | grep -E "\.(js|jsx|ts|tsx|py|go)$" | tr '\n' ' ')

echo "=== XSS 檢查 ==="
echo "$CHANGED_FILES" | xargs grep -l "dangerouslySetInnerHTML\|innerHTML\s*=" 2>/dev/null || echo "✅ 無 XSS 風險"

echo "=== eval 檢查 ==="
echo "$CHANGED_FILES" | xargs grep -n "\beval\s*(" 2>/dev/null || echo "✅ 無 eval()"

echo "=== localStorage 私鑰檢查 ==="
echo "$CHANGED_FILES" | xargs grep -n "localStorage.*\(privateKey\|mnemonic\|seed\|secret\)" 2>/dev/null || echo "✅ 無私鑰存儲"

echo "=== 錢包/Auth 觸碰檢查 ==="
echo "$CHANGED_FILES" | xargs grep -l "\(tronWeb\|TronLink\|signTransaction\|triggerSmartContract\|auth\|jwt\|token\)" 2>/dev/null && echo "⚠️ 觸碰錢包/Auth，需完整審計" || echo "✅ 未觸碰錢包/Auth"
```

**判斷邏輯：**
- 無高危發現 → 寫入 `docs/security-report.md`（PASS），跳過 agent 調用
- 有高危發現 或 觸碰錢包/Auth → 執行 Step 6.2 完整審計

**快速通過時寫入報告：**

```bash
cat > docs/security-report.md << 'EOF'
# Security Report

## Scope
快速 grep 掃描

## Checks Performed
- ✅ XSS（dangerouslySetInnerHTML / innerHTML）：未檢出
- ✅ eval()：未檢出
- ✅ localStorage 私鑰存儲：未檢出
- ✅ 錢包/Auth 代碼：未觸碰

## Verdict: PASS
EOF
```

### Step 6.2 — 完整安全審計（僅在 Step 6.1 發現風險時執行）

```
subagent_type: "security-auditor"
prompt: |
  你是 Security Auditor，負責 OWASP 審計。

  前置：Read docs/security-baseline.md（如存在）

  重點檢查：
  - XSS（dangerouslySetInnerHTML、用戶輸入直接渲染）
  - localStorage 無私鑰/助記詞
  - 無 eval()
  - Sentry 無 PII 泄漏

  結果寫入 docs/security-report.md，末尾必须有 ## Verdict: PASS 或 ## Verdict: FAIL。

  ⚠️ 寫完後直接結束，不要運行任何 workflow 命令
```

等待完成後檢查 verdict：

```bash
grep -i "verdict" docs/security-report.md
```

如果是 FAIL → **停止**，列出高危 finding。

### Step 6.3 — 推進到 DONE

```bash
HARNESS_ROOT=$PWD node "$(cat /tmp/.harness_wf)" advance  # SECURITY_REVIEW → DEPLOY_PREP_SETUP（如有）
HARNESS_ROOT=$PWD node "$(cat /tmp/.harness_wf)" advance  # DEPLOY_PREP_SETUP → DEPLOY_PREP
HARNESS_ROOT=$PWD node "$(cat /tmp/.harness_wf)" advance --force  # DEPLOY_PREP → DONE
```

---

## Phase 7 — Jira 回寫（可選，關聯 Jira Issue 時執行）

> **前置條件：**
> 1. Phase 0 成功解析出 Jira issue key
> 2. Jira MCP 工具可用
>
> 如果沒有 Jira issue key，直接跳過整個 Phase 7。

### Step 7.0 — 回寫前驗證

**在回寫 Jira 狀態之前，必須確認問題確實已解決：**

```
1. 讀取 state/workflow-state.json → 確認 currentState === 'DONE'
2. 如果 currentState !== 'DONE'（pipeline 中途停止）：
   - ⛔ 不回寫狀態轉換（不執行 Step 7.2）
   - ✅ 仍然發布評論（Step 7.3），說明當前進度和停止原因
   - 跳到 Step 7.3（失敗模式）
```

### Step 7.1 — 查詢可用狀態轉換

```
Tool: mcp__atlassian__jira_get_transitions
Arguments: { "issue_key": "<issue_key>" }
```

從返回結果中找目標 transition ID：
- **優先**找名稱含 `已處理`、`提測中` 的 transition
- 其次找 `提測` / `In Review` / `待测试`
- 最後兜底找 `Done` / `完成` / `Closed` / `Resolved`
- 記錄對應的 `id` 字段

### Step 7.2 — 轉換 Issue 狀態（僅 DONE 時執行）

```
Tool: mcp__atlassian__jira_transition_issue
Arguments: {
  "issue_key": "<issue_key>",
  "transition_id": "<id-from-step-7.1>",
  "comment": "已完成修復，自動通過 autopilot pipeline 驗證（build ✅ security ✅）"
}
```

### Step 7.3 — 發評論

**成功模式（DONE）：**

```
Tool: mcp__atlassian__jira_add_comment
Arguments: {
  "issue_key": "<issue_key>",
  "body": "## ✅ 修復完成\n\n**修復內容：**\n<來自 traceability-matrix.md 的 ✅ 條目，逐條列出>\n\n**修改文件：**\n<git diff --name-only 的結果>\n\n**驗證結果：**\n- 🔨 Build：<結果>\n- 📝 Code Review：<結果>\n- 🔒 安全審計：<結果>\n\n> 由 Claude Code autopilot 自動處理"
}
```

**失敗模式（非 DONE，pipeline 中途停止）：**

```
Tool: mcp__atlassian__jira_add_comment
Arguments: {
  "issue_key": "<issue_key>",
  "body": "## ⚠️ 自動修復未完成\n\n**停止階段：**<currentState>\n**停止原因：**<具體錯誤信息>\n\n**已完成部分：**\n<來自 traceability-matrix.md 的 ✅ 條目（如有）>\n\n> 由 Claude Code autopilot 報告，需人工介入"
}
```

### Step 7 完成標誌

**成功時輸出：**
```
✅ Jira 回寫完成
  - 狀態已更新為：<transition-name>
  - 評論已發布到 <issue_key>
  - <jira_base_url>/browse/<issue_key>
```

**失敗時輸出：**
```
⚠️ Jira 進度已同步（未更新狀態，僅發布評論）
  - 評論已發布到 <issue_key>
  - <jira_base_url>/browse/<issue_key>
  - 原因：pipeline 停止在 <currentState> 階段
```

---

## 核心循環

```
while (currentState !== 'DONE') {
  1. Read state/workflow-state.json → 獲取 currentState
  2. 檢查前置條件 → HARNESS_ROOT=$PWD node "$(cat /tmp/.harness_wf)" check
  3. 派發對應 Agent（見狀態派發表）
  4. 等待 Agent 完成（檢查產出物）
  5. 推進狀態 → HARNESS_ROOT=$PWD node "$(cat /tmp/.harness_wf)" advance [--force]
  6. 處理異常（見異常處理表）
}
```

---

## 狀態派發表

| 狀態 | 派發 Agent | 產出物 | 備註 |
|------|-----------|--------|------|
| IDEA | product-manager | `docs/prd.md` | |
| PRD_DRAFT | — 自動推進 | — | autopilot auto-force |
| PRD_REVIEW | software-architect（greenfield/hotfix） | `docs/arch-decision.md`<br>`docs/security-baseline.md` | feature 模式跳過 |
| ARCH_REVIEW | ux-designer（greenfield/hotfix） | `DESIGN.md`<br>`docs/design-spec.md` | feature 模式跳過 |
| CEO_REVIEW | — 自動推進 | — | autopilot auto-force |
| DESIGN_PHASE | — 自動推進 | — | autopilot auto-force |
| DESIGN_REVIEW | fullstack-engineer | 代碼<br>`docs/api-spec.md` | feature 模式跳過 Arch/Design |
| IMPLEMENTATION | code-reviewer | `docs/code-review.md` | |
| CODE_REVIEW | qa-engineer（如有測試） | `docs/test-plan.md`<br>`docs/test-report.md` | 默認跳過 E2E |
| QA_PHASE | — 自動推進 | — | autopilot auto-force |
| SECURITY_REVIEW | — 快速 grep + 條件觸發完整審計 | `docs/security-report.md` | |
| DEPLOY_PREP_SETUP | — 自動推進 | — | |
| DEPLOY_PREP | — 自動推進 | — | autopilot auto-force |
| DONE | — 結束 + Jira 回寫（如關聯，驗證 DONE 後才回寫狀態） | — | 🎉 |

---

## 異常處理

| 異常 | 檢測方式 | 處理 |
|------|---------|------|
| 前置條件缺失 | `check` 返回 missing | 派發對應 Agent 補產出物 |
| validate-doc 失敗 | 返回 non-zero | 派發 Agent 修復，重新驗證 |
| Code Review FAIL | code-review.md 含 FAIL | 派發 fullstack-engineer 修復，rollback IMPLEMENTATION |
| QA P0/P1 bug | test-report.md 含 P0/P1 | 派發 fullstack-engineer 修復 |
| Security Critical/High | security-report.md 含 Critical | 派發 fullstack-engineer 修復 |
| Agent 超時/失敗 | 無產出物 | 重試 1 次，仍失敗則暫停 autopilot |

---

## 暫停/恢復

### 暫停 Autopilot

用戶說："暫停"、"停止 autopilot"

```bash
HARNESS_ROOT=$PWD node "$(cat /tmp/.harness_wf)" stop-autopilot
```

### 恢復 Autopilot

用戶說："繼續 autopilot"、"恢復自動"

```bash
HARNESS_ROOT=$PWD node "$(cat /tmp/.harness_wf)" init-autopilot <mode>
```

---

## 完成通知

當 `currentState === 'DONE'` 時：

```
🎉 全流程自動完成！

產出物：
- docs/prd.md
- docs/arch-decision.md（如執行）
- docs/security-baseline.md
- DESIGN.md（如執行）
- docs/design-spec.md（如執行）
- docs/interaction-spec.md（如執行）
- docs/api-spec.md
- docs/traceability-matrix.md
- docs/code-review.md
- docs/test-report.md（如執行）
- docs/security-report.md
- apps/web/ (FE 代碼)
- apps/server/ (BE 代碼)
```

---

## 禁止行為

- 不跳過產出物驗證（validate-doc 必須通過）
- 不在 FAIL 狀態下推進
- 不忽略 Critical/High 安全漏洞
- 不在用戶主動暫停時繼續推進
