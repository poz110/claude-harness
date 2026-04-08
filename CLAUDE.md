# claude-harness

基于 Claude Code Subagents 的多 Agent 协作开发工作流。12 个专职 Agent 通过 14 步状态机串联。

## 状态机

```
IDEA → PRD_DRAFT* → PRD_REVIEW → ARCH_REVIEW → CEO_REVIEW* → DESIGN_PHASE*
     → DESIGN_REVIEW → IMPLEMENTATION[FullStack] → CODE_REVIEW → QA_PHASE*
     → SECURITY_REVIEW → DEPLOY_PREP_SETUP → DEPLOY_PREP* → DONE

* = 人工确认节点    [FullStack] = fullstack-engineer 单 Agent
```

## Agent 团队

| Agent | Tier | 核心职责 | 可写路径 |
|-------|------|----------|----------|
| `workflow-orchestrator` | FAST | 状态机决策、任务路由 | `state/` |
| `product-manager` | HEAVY | 需求分析、PRD | `docs/prd.md` |
| `software-architect` | HEAVY | 技术方案、ADR | `docs/arch-*.md`, `docs/traceability-matrix.md` |
| `ux-designer` | HEAVY | UI/UX、Design Token | `docs/design-spec.md`, `design/` |
| `plan-ceo-review` | STANDARD | CEO UX 审视 | `docs/ceo-review.md` |
| `fullstack-engineer` | STANDARD | API先行→BE→FE | `apps/`, `docs/api-spec.md` |
| `code-reviewer` | STANDARD | 代码审查 | `docs/code-review.md` |
| `qa-engineer` | STANDARD | 测试 | `docs/test-*.md` |
| `security-auditor` | AUDIT | OWASP 审计 | `docs/security-*.md` |
| `devops-engineer` | STANDARD | CI/CD、部署 | `docs/deploy-*.md`, `Dockerfile` |
| `general-assistant` | FAST | 探索/修复 | （只读） |

## Autopilot 模式

全流程自動模式：從當前狀態一路推進到 DONE，無需人為干預確認。支持傳入需求描述，自動注入後續流程。

```bash
# 推薦：直接傳入需求描述
/autopilot 構建一個用戶認證系統，支持郵箱註冊、登錄、OAuth登錄
/feature 添加用戶頭像上傳功能，支持裁剪和壓縮   # 增量功能快捷指令

# 命令行方式
node scripts/workflow.js init-autopilot greenfield "需求描述"  # 全新項目
node scripts/workflow.js init-autopilot feature "需求描述"    # 增量功能
node scripts/workflow.js stop-autopilot                       # 停止 autopilot

# 傳統方式（無需求注入，會追問用戶）
/autopilot
```

**需求注入**：傳入的需求描述會寫入 `state/autopilot-requirement.md`，PM agent 優先讀取該文件，跳過 office-hours 追問環節。

**MANUAL 節點自動推進**：啟用後，所有 MANUAL 節點（`PRD_DRAFT`, `CEO_REVIEW`, `DESIGN_PHASE`, `QA_PHASE`, `DEPLOY_PREP`）自動 `--force` 推進，無需用戶確認。

**失敗處理**：Agent 失敗 → 重試 1 次 → 仍失敗則暫停 autopilot，等待用戶介入。

**存量项目适配**：Autopilot 在执行过程中会自动检测目标项目的现有技术栈（package.json 依赖、已有代码量），在 Architect / Designer / Fullstack 阶段自动以现有栈为准，不会强制替换为 Bun/Next.js/shadcn 等默认技术栈。

## 快速命令

```bash
node scripts/workflow.js status              # 当前状态
node scripts/workflow.js check               # 检查前置条件
node scripts/workflow.js advance [--force]   # 推进（MANUAL 需 --force）
node scripts/workflow.js init-feature        # 增量功能模式
node scripts/workflow.js trace-summary       # 审计日志摘要
```

## 文件系统契约

```
docs/         — 文档产出物（prd.md, arch-decision.md, api-spec.md, ...）
design/       — 设计稿 + 基准截图 + 交互状态 HTML
state/        — workflow-state.json + agent-log.jsonl + trace.jsonl
scripts/      — 工作流引擎（workflow.js + lib/）
.claude/      — agents/ + skills/ + settings.json
```

## 读文件顺序

1. 本文档 → 全局背景
2. `state/workflow-state.json` → 当前阶段
3. `.claude/agents/orchestrator.md` → 状态机规则
4. `.claude/agents/[当前角色].md` → Agent 规范
5. `docs/[上游产出物].md` → 消费输入

## 关键机制

- **写入权限白名单**：每个 Agent 只能写入职责匹配的路径，hookPreWrite 强制执行
- **Context 追踪**：Hook 自动追踪操作的实际字节数，压缩后自动重注入关键文档
- **产出物指纹**：advance/rollback 后对关键文档计算 SHA256，跨状态修改触发警告
- **Feature 模式**：`init-feature` 跳过 Arch/CEO/Design 阶段，适合增量开发

## 版本管理

**必须使用 `bump-version` 更新版本，禁止手动修改版本号。**

```bash
node scripts/bump-version.js <x.y.z>   # 例如：node scripts/bump-version.js 1.1.6
```

`bump-version` 会同步更新以下文件的版本号：
- `package.json` → `version`
- `plugins/claude-harness/plugin.json` → `version`
- `.claude-plugin/marketplace.json` → `plugins[0].version`

更新后提交并 push：
```bash
git add . && git commit -m "chore: bump to <version>" && git push
```

**注意**：如果只改 `package.json` 而不用 `bump-version`，marketplace 版本不会同步，导致其他用户安装时拿到旧文件。

## 模型配置

修改 `scripts/lib/config.js` → `AGENT_MODEL_MAP`，然后 `node scripts/workflow.js install-global --force`

详细变更历史见 `docs/changelog.md`。
