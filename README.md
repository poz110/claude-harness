# claude-harness

> 基于 Claude Code 的多 Agent 协作开发工作流系统

[![MIT License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Claude Code](https://img.shields.io/badge/Claude%20Code-v3.5%2B-blue)](https://claude.com/code)

## 特性

| 特性 | 描述 |
|------|------|
| **12 个专职 Agent** | PM、架构师、设计师、全栈工程师、评审、QA、安全、DevOps 等 |
| **14 状态流水线** | 完整生命周期：想法 → PRD → 架构 → 设计 → 实现 → QA → 安全 → 部署 |
| **Autopilot 模式** | 全自动工作流，自动注入需求 |
| **Hotfix 模式** | 紧急修复，跳过设计/实现阶段 |
| **Feature 模式** | 增量功能，跳过架构/设计阶段 |
| **Context 预算** | 自动追踪和管理上下文使用 |
| **Slash 命令** | 原生 `/autopilot`、`/generate-prd`、`/implement-feature` 等 |

## 快速开始

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

## 工作流状态

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

## 工作流流水线图

```
IDEA
  │
  ▼
PRD_DRAFT ──────► PRD_REVIEW
                       │
                       ▼
                  ARCH_REVIEW ──────► CEO_REVIEW
                       │                    │
                       ▼                    ▼
                 DESIGN_PHASE ◄────────────┘
                       │
                       ▼
                 DESIGN_REVIEW ──────► IMPLEMENTATION
                       │                      │
                       ▼                      ▼
                   QA_PHASE ◄──────── CODE_REVIEW
                       │                      │
                       ▼                      ▼
                 SECURITY ◄────────── QA_PHASE
                   REVIEW                    │
                       │                     │
                       ▼                     ▼
                 DEPLOY_PREP ◄─────── DEPLOY
                   _SETUP                      │
                       │                      ▼
                       └──────────────────► DONE
```

## 可用命令

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

## Autopilot 示例

```bash
# 完整应用
/autopilot 构建一个博客系统，支持文章发布、评论、用户注册登录

# 功能添加
/autopilot feature 添加社交分享功能，支持微信、微博分享

# 紧急修复
/autopilot hotfix 修复登录页面的 XSS 漏洞
```

## 项目结构

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
└── tests/                     # 单元测试
```

## 环境要求

| 要求 | 版本 |
|------|------|
| Node.js | >= 18.0.0 |
| Claude Code | 最新版 |

## License

MIT © Snow.Li

## 贡献

欢迎贡献！请阅读 `AGENTS.md` 了解贡献指南。
