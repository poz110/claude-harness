# claude-harness

基于 Claude Code Subagents 的多 Agent 协作开发工作流系统。12 个专职 Agent 通过 14 步状态机串联。

## 特性

- **12 个专职 Agent** — PM、架构师、设计师、全栈工程师、评审、QA、安全、DevOps 等
- **14 步状态流水线** — 想法 → PRD → 架构 → 设计 → 实现 → QA → 安全 → 部署
- **Autopilot 模式** — 全自动工作流，说出需求即可驱动全流程
- **Context 预算** — 自动追踪和管理上下文使用

## 安装

### 方式一：插件市场安装（推荐）

```bash
claude plugin marketplace add poz110/claude-harness
claude plugin install claude-harness
```

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

> **已安装旧版本？** 运行 `claude plugin update claude-harness` 升级到最新版本，旧版本存在 hook 报错和 `/autopilot` 路径解析问题。

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
/autopilot feature 给现有系统添加用户头像上传功能
/autopilot hotfix 修复登录页 CSRF token 漏洞
```

Autopilot 会自动调度所有 Agent，无需人工确认，直到项目完成。状态保存在当前目录 `state/workflow-state.json`，重启会话后可继续上次进度。

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
