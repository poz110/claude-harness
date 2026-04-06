# claude-harness

> A state machine driven multi-agent development workflow for Claude Code
>
> 基于 Claude Code 的多 Agent 协作开发工作流系统

[![MIT License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Claude Code](https://img.shields.io/badge/Claude%20Code-v3.5%2B-blue)](https://claude.com/code)

---

## English

### Features

| Feature | Description |
|---------|-------------|
| **12 Specialized Agents** | PM, Architect, Designer, FullStack Engineer, Reviewer, QA, Security, DevOps, and more |
| **14-State Pipeline** | Complete lifecycle: Idea → PRD → Architecture → Design → Implementation → QA → Security → Deploy |
| **Autopilot Mode** | Fully automated workflow with automatic requirement injection |
| **Hotfix Mode** | Skip design/implementation phases for emergency fixes |
| **Feature Mode** | Skip architecture/design for incremental features |
| **Context Budget** | Automatic context tracking and management |
| **Slash Commands** | Native `/autopilot`, `/generate-prd`, `/implement-feature` and more |

### Quick Start

```bash
# 1. Add the marketplace
claude plugin marketplace add poz110/claude-harness

# 2. Install the plugin
claude plugin install claude-harness

# 3. Initialize
/claude-harness:init

# 4. Start building!
/autopilot Build a blog system with user authentication
```

### Workflow Pipeline

```
IDEA → PRD_DRAFT → PRD_REVIEW → ARCH_REVIEW → CEO_REVIEW → DESIGN_PHASE
     → DESIGN_REVIEW → IMPLEMENTATION → CODE_REVIEW → QA_PHASE
     → SECURITY_REVIEW → DEPLOY_PREP_SETUP → DEPLOY_PREP → DONE
```

### Available Commands

| Command | Description |
|---------|-------------|
| `/claude-harness:init` | Install agents & skills to `~/.claude/` |
| `/autopilot <requirement>` | Full automation with requirement |
| `/autopilot greenfield <req>` | Full project from scratch |
| `/autopilot feature <req>` | Add new feature |
| `/autopilot hotfix <issue>` | Emergency fix |
| `/generate-prd` | Generate Product Requirement Document |
| `/generate-design` | Create design system and specs |
| `/implement-feature` | Implement a feature |
| `/implement-api` | Implement backend API |
| `/arch-review` | Architecture review |
| `/code-review-arch` | Code review + architecture compliance |
| `/qa` | Run QA testing |
| `/owasp-scan` | Security vulnerability scan |
| `/setup-cicd` | Configure CI/CD pipeline |
| `/monitor` | Launch monitoring dashboard |

### Requirements

| Requirement | Version |
|-------------|---------|
| Node.js | >= 18.0.0 |
| Claude Code | Latest |

---

## 中文

### 特性

| 特性 | 描述 |
|------|------|
| **12 个专职 Agent** | PM、架构师、设计师、全栈工程师、评审、QA、安全、DevOps 等 |
| **14 状态流水线** | 完整生命周期：想法 → PRD → 架构 → 设计 → 实现 → QA → 安全 → 部署 |
| **Autopilot 模式** | 全自动工作流，自动注入需求 |
| **Hotfix 模式** | 紧急修复，跳过设计/实现阶段 |
| **Feature 模式** | 增量功能，跳过架构/设计阶段 |
| **Context 预算** | 自动追踪和管理上下文使用 |
| **Slash 命令** | 原生 `/autopilot`、`/generate-prd`、`/implement-feature` 等 |

### 快速开始

```bash
# 1. 添加市场
claude plugin marketplace add poz110/claude-harness

# 2. 安装插件
claude plugin install claude-harness

# 3. 初始化
/claude-harness:init

# 4. 开始使用
/autopilot 构建一个博客系统，支持用户注册登录
```

### 工作流状态

| 状态 | 描述 | 类型 |
|------|------|------|
| `IDEA` | 初始想法，PM 生成 PRD | 自动 |
| `PRD_DRAFT` | PRD 已生成，等待审核 | 手动 |
| `PRD_REVIEW` | 架构师审核中 | 自动 |
| `ARCH_REVIEW` | ADR 完成，设计师工作中 | 自动 |
| `CEO_REVIEW` | CEO 审核 UX 逻辑 | 手动 |
| `DESIGN_PHASE` | 设计完成，等待审核 | 手动 |
| `DESIGN_REVIEW` | 全栈工程师实现中 | 自动 |
| `IMPLEMENTATION` | 实现中，评审审计中 | 自动 |
| `CODE_REVIEW` | 代码评审完成，QA 测试中 | 自动 |
| `QA_PHASE` | QA 完成，等待审核 | 手动 |
| `SECURITY_REVIEW` | 安全审计中 | 自动 |
| `DEPLOY_PREP_SETUP` | DevOps 准备部署中 | 自动 |
| `DEPLOY_PREP` | 部署就绪，等待确认 | 手动 |
| `DONE` | 流水线完成 | — |

### 可用命令

| 命令 | 描述 |
|------|------|
| `/claude-harness:init` | 安装 agents 和 skills 到 `~/.claude/` |
| `/autopilot <需求>` | 全自动模式，附带需求 |
| `/autopilot greenfield <需求>` | 全新项目 |
| `/autopilot feature <需求>` | 添加新功能 |
| `/autopilot hotfix <问题>` | 紧急修复 |
| `/generate-prd` | 生成产品需求文档 |
| `/generate-design` | 创建设计系统和规格 |
| `/implement-feature` | 实现功能 |
| `/implement-api` | 实现后端 API |
| `/arch-review` | 架构评审 |
| `/code-review-arch` | 代码评审 + 架构合规 |
| `/qa` | 执行 QA 测试 |
| `/owasp-scan` | 安全漏洞扫描 |
| `/setup-cicd` | 配置 CI/CD 流水线 |
| `/monitor` | 启动监控面板 |

### Autopilot 示例

```bash
# 完整应用
/autopilot 构建一个博客系统，支持文章发布、评论、用户注册登录

# 功能添加
/autopilot feature 添加社交分享功能，支持微信、微博分享

# 紧急修复
/autopilot hotfix 修复登录页面的 XSS 漏洞
```

### 项目结构

```
claude-harness/
├── .claude-plugin/              # Claude 插件清单
│   ├── marketplace.json
│   └── plugins/claude-harness/
│       ├── plugin.json
│       ├── agents/              # 12 个 Agent 定义
│       ├── skills/              # Skill 定义
│       └── settings.json
├── scripts/                     # 工作流引擎
│   ├── workflow.js              # CLI 入口
│   └── lib/                    # 核心模块
├── .claude/                    # 本地 Agent/Skill 覆盖
│   ├── agents/
│   └── skills/
├── docs/                       # 工作流产出物
├── design/                     # 设计输出
├── state/                      # 工作流状态
└── tests/                      # 单元测试
```

### 环境要求

| 要求 | 版本 |
|------|------|
| Node.js | >= 18.0.0 |
| Claude Code | 最新版 |

---

## License

MIT © Snow.Li

## Contributing

Contributions welcome! Please read `AGENTS.md` for contribution guidelines.

欢迎贡献！请阅读 `AGENTS.md` 了解贡献指南。
