---
name: feature
description: "增量功能模式：等同於 /autopilot feature，跳過 Arch/Design 阶段，直接推进到 DONE。"
---

# Feature — 增量功能快捷指令

等同於 `/autopilot feature <需求描述>`，無需輸入 `autopilot feature` 前綴。

## 用法

```
/feature <需求描述>
```

**示例**：
```
/feature 添加用戶頭像上傳功能，支持裁剪和壓縮
/feature 為訂單列表增加導出 CSV 功能
```

## 觸發條件

用戶輸入 `/feature` 或 `feature` 加需求描述。

## 執行邏輯

解析 args 為需求描述，然後完全按照 `/autopilot` skill 中 `feature` 模式執行：

```
requirement = args（用戶輸入除去 "/feature" 後的全部內容）
mode = 'feature'
```

接著執行與 autopilot SKILL.md 完全相同的流程，僅 mode 固定為 `feature`：

1. **路徑解析**（必須第一步）：
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

2. **啟用 autopilot feature 模式**：
   ```bash
   HARNESS_ROOT=$PWD node "$(cat /tmp/.harness_wf)" init-autopilot feature "<requirement>"
   ```

3. **執行核心循環**，直到 `currentState === 'DONE'`（與 autopilot SKILL.md 核心循環相同）。

> 完整執行規範見 `.claude/skills/autopilot/SKILL.md`。
