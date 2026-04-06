# claude-harness

> A state machine driven multi-agent development workflow for Claude Code

[![MIT License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Claude Code](https://img.shields.io/badge/Claude%20Code-v3.5%2B-blue)](https://claude.com/code)

claude-harness is a sophisticated development workflow system that orchestrates 12 specialized AI agents through a 14-state pipeline — from initial idea to production deployment.

## Features

| Feature | Description |
|---------|-------------|
| **12 Specialized Agents** | PM, Architect, Designer, FullStack Engineer, Reviewer, QA, Security, DevOps, and more |
| **14-State Pipeline** | Complete lifecycle: Idea → PRD → Architecture → Design → Implementation → QA → Security → Deploy |
| **Autopilot Mode** | Fully automated workflow with automatic requirement injection |
| **Hotfix Mode** | Skip design/implementation phases for emergency fixes |
| **Feature Mode** | Skip architecture/design for incremental features |
| **Context Budget** | Automatic context tracking and management |
| **Slash Commands** | Native `/autopilot`, `/generate-prd`, `/implement-feature` and more |

---

## Quick Start

```bash
# 1. Add the marketplace
claude plugin marketplace add poz110/claude-harness

# 2. Install the plugin
claude plugin install claude-harness

# 3. Initialize (use the slash command)
(claude-harness) /claude-harness:init

# 4. Start building!
(claude-harness) /autopilot 构建一个待办事项应用
```

---

## Workflow Pipeline

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
                       └──────────────────► DONE 🎉
```

| State | Description | Type |
|-------|-------------|------|
| `IDEA` | Initial idea, PM generates PRD | Auto |
| `PRD_DRAFT` | PRD generated, awaiting review | Manual |
| `PRD_REVIEW` | Architect reviewing | Auto |
| `ARCH_REVIEW` | ADR complete, Designer creating | Auto |
| `CEO_REVIEW` | CEO reviewing UX logic | Manual |
| `DESIGN_PHASE` | Design complete, awaiting review | Manual |
| `DESIGN_REVIEW` | FullStack Engineer implementing | Auto |
| `IMPLEMENTATION` | Implementation, Reviewer auditing | Auto |
| `CODE_REVIEW` | Code review complete, QA testing | Auto |
| `QA_PHASE` | QA complete, awaiting review | Manual |
| `SECURITY_REVIEW` | Security auditing | Auto |
| `DEPLOY_PREP_SETUP` | DevOps preparing deploy | Auto |
| `DEPLOY_PREP` | Deploy ready, awaiting approval | Manual |
| `DONE` | Pipeline complete | — |

---

## Available Commands

### Initialization

| Command | Description |
|---------|-------------|
| `/claude-harness:init` | Install agents & skills to `~/.claude/` |
| `/init` | Alias for init |

### Workflow Navigation

| Command | Description |
|---------|-------------|
| `/autopilot <requirement>` | Full automation with requirement |
| `/autopilot greenfield <req>` | Full project from scratch |
| `/autopilot feature <req>` | Add new feature |
| `/autopilot hotfix <issue>` | Emergency fix |
| `/status` | Check current state |
| `/advance` | Move to next state |
| `/rollback <state>` | Rollback to state |

### Generation Commands

| Command | Description |
|---------|-------------|
| `/generate-prd` | Generate Product Requirement Document |
| `/generate-design` | Create design system and specs |
| `/implement-feature` | Implement a feature |
| `/implement-api` | Implement backend API |

### Review Commands

| Command | Description |
|---------|-------------|
| `/arch-review` | Architecture review |
| `/code-review-arch` | Code review + architecture compliance |
| `/qa` | Run QA testing |
| `/owasp-scan` | Security vulnerability scan |
| `/traceability-matrix` | Check requirement traceability |

### DevOps Commands

| Command | Description |
|---------|-------------|
| `/setup-cicd` | Configure CI/CD pipeline |
| `/monitor` | Launch monitoring dashboard |

---

## Autopilot Examples

### Full Application

```bash
/autopilot 构建一个博客系统，支持文章发布、评论、用户注册登录
```

### Feature Addition

```bash
/autopilot feature 添加社交分享功能，支持微信、微博分享
```

### Emergency Fix

```bash
/autopilot hotfix 修复登录页面的 XSS 漏洞
```

---

## Project Structure

```
claude-harness/
├── .claude-plugin/              # Claude plugin manifest
│   ├── marketplace.json
│   └── plugins/claude-harness/
│       ├── plugin.json
│       ├── agents/              # 12 agent definitions
│       ├── skills/             # Skill definitions
│       └── settings.json
├── scripts/                     # Workflow engine
│   ├── workflow.js              # CLI entry point
│   └── lib/                     # Core modules
│       ├── config.js            # Configuration
│       ├── state.js             # State management
│       ├── hooks.js             # Hook handlers
│       ├── verify.js            # Validation
│       └── install.js           # Installation
├── .claude/                     # Local agent/skill overrides
│   ├── agents/
│   └── skills/
├── docs/                        # Workflow artifacts
├── design/                      # Design outputs
├── state/                       # Workflow state
└── tests/                       # Unit tests
```

---

## Workflow States Explained

### IDEA → PRD_DRAFT

The Product Manager agent generates a comprehensive PRD including:
- User stories and use cases
- Functional requirements (Must/Should/Could)
- Appetite and constraints
- MVP scope definition

### PRD_REVIEW → ARCH_REVIEW

The Software Architect creates:
- `docs/arch-decision.md` — Architecture decision records with ASCII diagrams
- `docs/security-baseline.md` — Security requirements
- `docs/traceability-matrix.md` — Requirement traceability

### ARCH_REVIEW → CEO_REVIEW

The UX Designer produces:
- `DESIGN.md` — Design system with tokens
- `docs/design-spec.md` — 80-dimension design audit
- `design/*.html` — Interactive design prototypes

### DESIGN_REVIEW → IMPLEMENTATION

The FullStack Engineer implements:
- `docs/api-spec.md` — API specification
- `apps/web/` — Next.js frontend
- `apps/server/` — Bun/Hono backend

### IMPLEMENTATION → DONE

Through automated phases:
- Code review with quality gates
- QA testing (unit + E2E + visual regression)
- Security audit (OWASP Top 10)
- CI/CD deployment pipeline

---

## Requirements

| Requirement | Version |
|-------------|---------|
| Node.js | >= 18.0.0 |
| Claude Code | Latest |

---

## License

MIT © Snow.Li

---

## Contributing

Contributions welcome! Please read `AGENTS.md` for contribution guidelines.
