# [共享基礎規則 — _shared.md]
#
# 此文件由 install-global 自動注入到每個 Agent 文件末尾。
# 勿在 ~/.claude/agents/ 中直接修改此文件，請編輯源文件 .claude/agents/_shared.md。
# 修改後執行 `node scripts/workflow.js install-global --force` 使更改生效。

---

## ⚡ Iron Laws（不可违反，无例外）

以下为整个工作流的铁律。与普通指南不同，铁律不可因"这次情况特殊"而绕过。任何理由都不成立。

| # | Iron Law | 违反后果 |
|---|----------|---------|
| IL-01 | **前置文档不存在，禁止推进到下一阶段** | 立即停止，报告缺失文件 |
| IL-02 | **API spec 必须在写任何代码之前存在** | 无 api-spec.md 则拒绝写路由/组件 |
| IL-03 | **不通过 hookPreWrite 鉴权，禁止写入任何文件** | 系统强制执行，exit(2) |
| IL-04 | **审查者不得修改被审查的代码** | 只能报告问题，不能直接修改 |
| IL-05 | **测试必须用真浏览器（Playwright），不接受纯 mock 测试** | mock 测试不计入覆盖率 |
| IL-06 | **write-agent-result 必须在每个 Agent 完成时执行** | 未执行则 Orchestrator 无法路由 |
| IL-07 | **MANUAL 节点不得在无 --force 或 autopilot=true 时自行推进** | 等待用户确认 |
| IL-08 | **生产环境禁止 drizzle-kit push，必须 generate + migrate** | 不可逆数据风险 |
| IL-09 | **PRD Must 功能缺失即为 FAIL，不可降级为 WARN** | 直接触发 rollback |
| IL-10 | **新技能上线前，必须有"无此技能时的失败场景"记录** | 无失败证明则技能无效 |

---

## [元规则] 先查技能，再行动

**在执行任何非平凡操作之前，先检查是否有适用的技能（Skill）。**

优先级顺序：
1. 用户明确指令
2. `.claude/skills/` 中的适用技能
3. Agent 自身默认行为

检查技能的触发时机（即使只有 1% 的适用可能也要检查）：
- 要实现一个功能 → 先查 `implement-api` / `implement-feature`
- 要做代码审查 → 先查 `code-review-arch`
- 要写测试 → 先查 `prepare-tests`
- 遇到 Bug 不知从何下手 → 先查 `systematic-debugging`
- 要设计架构 → 先查 `arch-review`
- 要部署 → 先查 `setup-cicd`

---

## [共享] Workflow CLI 快速參考

| 命令 | 用途 |
|------|------|
| `node scripts/workflow.js status` | 查看當前狀態 + 前置條件 |
| `node scripts/workflow.js check` | 檢查前置條件是否滿足 |
| `node scripts/workflow.js advance [--force]` | 推進狀態機（MANUAL 節點需 `--force`） |
| `node scripts/workflow.js validate-doc <key>` | 驗證文檔格式（prd/arch/api-spec/design-spec/...） |
| `node scripts/workflow.js check-code FE\|BE` | 驗證代碼產出物文件存在 |
| `node scripts/workflow.js verify-code FE\|BE` | 運行構建/lint/typecheck |
| `node scripts/workflow.js integration-check` | 6 項靜態聯調檢查 |
| `node scripts/workflow.js update-progress FE\|BE done` | 標記並行進度完成 |
| `node scripts/workflow.js check-parallel-done` | 檢查 FE+BE 是否都完成 |
| `node scripts/workflow.js reset-context <agent>` | 重置 context 預算追蹤 |
| `node scripts/workflow.js context-status` | 查看 context 使用量 |
| `node scripts/workflow.js rollback <STATE>` | 回滾到指定狀態 |
| `node scripts/workflow.js fallback-notify <from> <to> <msg>` | Path B：寫入跨 Agent 通知 |
| `node scripts/workflow.js init-feature` | 在現有項目上啟動增量 feature 模式 |
| `node scripts/workflow.js write-agent-result '<json>'` | **[必填]** 完成後寫入結果協議 |
| `node scripts/workflow.js trace-summary` | 查看結構化審計 trace 摘要 |

## [共享] 通用禁止事項

- **禁止直接寫入 `state/workflow-state.json`** — 必須通過 workflow.js 命令修改
- **禁止跳過前置條件** — 前置文檔不存在時，不得推進狀態機
- **禁止自行推進 MANUAL 節點** — 必須由用戶確認（`--force`）後才能推進
- **禁止在生產環境使用 `drizzle-kit push`** — 必須使用 `generate + migrate`
- **禁止 `rm -rf state/`** — 使用 `node scripts/workflow.js reset`
- **禁止 `> state/workflow-state.json`** — 直接覆蓋會繞過鎖機制和 hook 系統

## [共享] Agent 結果協議（每個 Agent 完成時必須執行）

**工作完成後，必須執行以下命令記錄結果，harness 依此差異化路由：**

```bash
# 成功完成
node scripts/workflow.js write-agent-result '{"status":"success","artifactsProduced":["docs/api-spec.md"],"nextAction":"advance"}'

# 部分完成（有未完成項）
node scripts/workflow.js write-agent-result '{"status":"partial","artifactsProduced":["docs/api-spec.md"],"nextAction":"check"}'

# 被阻塞（等待依賴）
node scripts/workflow.js write-agent-result '{"status":"blocked","blockingReason":"缺少 arch-decision.md 的 API contract 部分","nextAction":"fix-blockers"}'

# 失敗（需要人工干預）
node scripts/workflow.js write-agent-result '{"status":"failed","blockingReason":"構建失敗：TypeScript 類型錯誤 23 個","nextAction":"rerun"}'
```

`status` 可選值：`success` | `partial` | `failed` | `blocked`
`nextAction` 可選值：`advance` | `check` | `fix-blockers` | `rerun`

## [共享] Context 生命周期（實現階段 Agent 適用）

**開始工作前執行一次：**
```bash
node scripts/workflow.js reset-context <your-agent-name>
# 例：reset-context frontend-engineer
```

Context 用量由 Hook 系統自動追蹤（每次 bash/write/read 自動計數），無需手動調用 `track-context`。

**收到「context 使用率 > 85%」警告時立即重讀：**
- `docs/traceability-matrix.md`（需求覆蓋矩陣）
- `docs/api-spec.md`（API 契約）
- `docs/arch-decision.md`（架構決策）
- `docs/interaction-spec.md`（交互行為規範）
