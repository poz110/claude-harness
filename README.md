# claude-harness &nbsp; [![中文](https://img.shields.io/badge/lang-%E4%B8%AD%E6%96%87-red.svg)](README.md) [![English](https://img.shields.io/badge/lang-English-blue.svg)](README_EN.md)

基于 Claude Code Subagents 的多 Agent 协作开发工作流系统。12 个专职 Agent 通过 14 步状态机串联，从需求到部署全自动。

<div align="center">

### [web-silk-five-22.vercel.app](https://web-silk-five-22.vercel.app/)

**Ship Production-Ready Code with AI Agent Orchestration**

*From PRD to deployed code — in minutes, not weeks.*

*This tutorial site was built entirely by claude-harness itself — from PRD to deployment, fully automated.*

</div>

---

## 特性

- **12 个专职 Agent** — PM、架构师、设计师、全栈工程师、评审、QA、安全、DevOps 等
- **14 步状态流水线** — 想法 → PRD → 架构 → 设计 → 实现 → QA → 安全 → 部署
- **Autopilot 模式** — 全自动工作流，说出需求即可驱动全流程
- **3 种工作模式** — `/autopilot`（全流程）、`/feature`（增量功能）、`/hotfix`（快速修复）
- **Context 预算** — 自动追踪和管理上下文使用
- **存量项目适配** — 自动检测现有技术栈，不强制替换框架

## 安装

### 方式一：插件市场安装（推荐）

**1. 添加 marketplace 源**

```bash
claude plugin marketplace add poz110/claude-harness
```
**2. 安装插件**

```bash
claude plugin install claude-harness
```

> [!TIP]
> 作者发布新版本后，运行以下命令更新：
> ```bash
> claude plugin marketplace remove claude-harness
> rm -rf ~/.claude/plugins/cache/claude-harness
> claude plugin marketplace add poz110/claude-harness
> claude plugin install claude-harness
> ```

安装完成后，所有命令即刻可用，包括 `/autopilot` 全流程自动模式。工作流状态写入当前项目目录的 `state/`，跨会话持久保存。

**安装后使用：**

```bash
# 1. 进入你的项目目录
cd your-project

# 2. 用 dangerously-skip-permissions 模式启动 Claude（autopilot 需要自动执行命令）
claude --dangerously-skip-permissions

# 3. 在 Claude 中输入
/autopilot 构建一个博客系统，支持 Markdown 写作和标签分类
```

> **已有旧版本，需要更新？** marketplace 源不会自动同步，完整流程：
> ```bash
> claude plugin marketplace remove claude-harness
> rm -rf ~/.claude/plugins/cache/claude-harness
> claude plugin marketplace add poz110/claude-harness
> claude plugin install claude-harness
> ```

### 方式二：源码安装

适合需要修改工作流引擎本身，或贡献代码的场景。

```bash
git clone https://github.com/poz110/claude-harness.git
cd claude-harness
node scripts/workflow.js init   # 将 agents/skills/hooks 安装到全局 ~/.claude/
node scripts/workflow.js status # 验证安装
```

---

## 使用

### Autopilot — 全自动流程

```bash
/autopilot 构建一个博客系统，支持 Markdown 写作和标签分类
/feature 给现有系统添加用户头像上传功能
/hotfix 修复登录页 CSRF token 漏洞
```

Autopilot 会自动调度所有 Agent，无需人工确认，直到项目完成。状态保存在当前目录 `state/workflow-state.json`，重启会话后可继续上次进度。

**存量项目支持**：Autopilot 自动检测目标项目的现有技术栈（React/Vue/Ant Design/MUI/Tailwind 等），在 Architect / Designer / Fullstack 阶段以现有栈为准进行实现，不会强制引入新的框架或部署平台。

### 三种工作模式

| 模式 | 命令 | 适用场景 | 流程 |
|------|------|---------|------|
| **全流程** | `/autopilot <需求>` | 全新项目，完整生命周期 | 14 步全走 |
| **增量功能** | `/feature <需求>` | 现有项目添加功能 | 跳过架构/设计，10 步 |
| **快速修复** | `/hotfix <描述或Jira URL>` | 紧急 bug 修复 | 分析 → 修复 → 回写，3 步 |

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

MIT (c) Snow.Li
