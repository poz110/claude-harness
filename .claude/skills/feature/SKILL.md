---
name: feature
description: "增量功能模式：等同於 /autopilot feature，跳過 Arch/Design 階段，適合在現有項目上添加新功能。"
---

# Feature — 增量功能快捷指令

等同於 `/autopilot feature <需求描述>`，無需輸入 `autopilot feature` 前綴。

## 用法

```
/feature <需求描述>
/feature <Jira URL>
```

**示例**：
```
/feature 添加用戶頭像上傳功能，支持裁剪和壓縮
/feature 為訂單列表增加導出 CSV 功能
/feature https://troneco.atlassian.net/browse/PROJ-123
```

## 觸發條件

用戶輸入 `/feature` 加需求描述或 Jira URL。

## 實際執行路徑

```
IDEA → PRD_DRAFT* → PRD_REVIEW → IMPLEMENTATION → CODE_REVIEW
     → QA_PHASE* → SECURITY_REVIEW → DEPLOY_PREP_SETUP → DEPLOY_PREP* → DONE
```

跳過：ARCH_REVIEW、CEO_REVIEW、DESIGN_PHASE、DESIGN_REVIEW（4 個階段）

`*` = MANUAL 節點，autopilot 模式下自動推進。

## 執行邏輯

```
1. 解析參數
   requirement = 用戶輸入除去 "/feature" 後的全部內容
   mode = 'feature'

2. 路徑解析（必須第一步）
   _w=scripts/workflow.js; test -f "$_w" \
     || _w=$(ls $HOME/.claude/plugins/cache/claude-harness/claude-harness/*/scripts/workflow.js 2>/dev/null|tail -1)
   echo "$_w" > /tmp/.harness_wf
   echo "harness: $_w"

3. Jira URL 檢測
   if (requirement matches /atlassian\.net\/browse\/([A-Z]+-\d+)/) {
     result = Skill: jira-mcp-setup (
       action: "get_issue",
       url: requirement,
       mode: "autopilot"
     )
     requirement = result.requirement
   }

4. 啟用 autopilot feature 模式
   HARNESS_ROOT=$PWD node "$(cat /tmp/.harness_wf)" init-autopilot feature "<requirement>"

5. 執行核心循環，直到 currentState === 'DONE'
   完全按照 autopilot SKILL.md 的核心循環 + 狀態派發表執行。
```

> 完整執行規範見 `.claude/skills/autopilot/SKILL.md`。
