# claude-harness

基于 Claude Code Subagents 的多 Agent 协作开发工作流系统。12 个专职 Agent 通过 14 步状态机串联。

## 特性

- **12 个专职 Agent** — PM、架构师、设计师、全栈工程师、评审、QA、安全、DevOps 等
- **14 步状态流水线** — 想法 → PRD → 架构 → 设计 → 实现 → QA → 安全 → 部署
- **Autopilot 模式** — 全自动工作流，说出需求即可驱动全流程
- **Context 预算** — 自动追踪和管理上下文使用

## 安装

### 方式一：插件市场安装

适合单次使用独立技能命令的场景。

```bash
claude plugin marketplace add poz110/claude-harness
claude plugin install claude-harness
```

安装完成后，所有 slash 命令即刻可用。

> **局限**：无状态持久化。每个技能命令独立执行，对话结束后不记录进度，无法跨会话追踪"当前在哪个阶段"。如需完整的多轮工作流，请使用方式二。

### 方式二：源码安装（完整功能，含 Autopilot）

`/autopilot` 依赖工作流引擎（`scripts/workflow.js`）和项目状态文件（`state/`），需要在 harness 源码目录内运行。

```bash
# 1. 克隆源码
git clone https://github.com/poz110/claude-harness.git
cd claude-harness

# 2. 安装 Node.js 依赖（如有）
# node >= 18.0.0 即可，无需 npm install

# 3. 初始化：将 agents/skills/hooks 安装到全局 ~/.claude/
node scripts/workflow.js init

# 4. 验证安装
node scripts/workflow.js status
```

> **说明**：`/init` 命令与 `node scripts/workflow.js init` 等价，必须在 claude-harness 源码目录内执行。

---

## 使用

### Autopilot — 全自动流程（需源码安装）

```bash
# 进入 claude-harness 源码目录后，在 Claude Code 中输入：
/autopilot 构建一个博客系统，支持 Markdown 写作和标签分类
/autopilot feature 给现有系统添加用户头像上传功能
/autopilot hotfix 修复登录页 CSRF token 漏洞
```

Autopilot 会自动调度所有 Agent，无需人工确认，直到项目完成。

### 独立技能命令（插件安装即可用）

```bash
/generate-prd           # 生成产品需求文档
/generate-design        # 创建设计系统
/implement-feature      # 实现前端功能
/implement-api          # 实现后端 API
/arch-review            # 架构评审（生成 ADR）
/code-review-arch       # 代码审查
/owasp-scan             # OWASP 安全扫描
/prepare-tests          # 生成测试计划和用例
/setup-cicd             # 配置 CI/CD
/hotfix <问题描述>      # 紧急修复模式
/monitor                # 启动监控面板
```

### 工作流 CLI（需源码安装）

```bash
node scripts/workflow.js status       # 查看当前状态
node scripts/workflow.js advance      # 推进到下一阶段
node scripts/workflow.js check        # 检查前置条件
node scripts/workflow.js init-feature # 增量功能模式（跳过架构/设计）
```

---

## 工作流状态机

```
IDEA → PRD_DRAFT* → PRD_REVIEW → ARCH_REVIEW → CEO_REVIEW* → DESIGN_PHASE*
     → DESIGN_REVIEW → IMPLEMENTATION → CODE_REVIEW → QA_PHASE*
     → SECURITY_REVIEW → DEPLOY_PREP_SETUP → DEPLOY_PREP* → DONE

* = 人工确认节点（Autopilot 模式下自动通过）
```

| 状态 | Agent | 产出物 |
|------|-------|--------|
| `IDEA` | product-manager | `docs/prd.md` |
| `PRD_REVIEW` | software-architect | `docs/arch-decision.md` |
| `ARCH_REVIEW` | ux-designer | `DESIGN.md`, `docs/design-spec.md` |
| `CEO_REVIEW` | plan-ceo-review | `docs/ceo-review.md` |
| `DESIGN_REVIEW` | fullstack-engineer | `docs/api-spec.md`, 代码 |
| `CODE_REVIEW` | qa-engineer | `docs/test-report.md` |
| `SECURITY_REVIEW` | security-auditor | `docs/security-report.md` |
| `DEPLOY_PREP_SETUP` | devops-engineer | `docs/deploy-plan.md`, `Dockerfile` |

---

## 环境要求

- Node.js >= 18.0.0
- Claude Code 最新版

## License

MIT © Snow.Li
