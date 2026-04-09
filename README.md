# claude-harness &nbsp; [![中文](https://img.shields.io/badge/lang-%E4%B8%AD%E6%96%87-red.svg)](README_ZH.md) [![English](https://img.shields.io/badge/lang-English-blue.svg)](README.md)

A multi-agent collaborative development workflow powered by Claude Code Subagents. 12 specialized agents orchestrated through a 14-step state machine — from requirements to deployment, fully automated.

<div align="center">

### [web-silk-five-22.vercel.app](https://web-silk-five-22.vercel.app/)

**Ship Production-Ready Code with AI Agent Orchestration**

*From PRD to deployed code — in minutes, not weeks.*

*This tutorial site was built entirely by claude-harness itself — from PRD to deployment, fully automated.*

</div>

---

## Features

- **12 Specialized Agents** — PM, Architect, Designer, Fullstack Engineer, Reviewer, QA, Security, DevOps, and more
- **14-Step Pipeline** — Idea → PRD → Architecture → Design → Implementation → QA → Security → Deploy
- **Autopilot Mode** — Fully automated workflow, just describe your requirements
- **3 Work Modes** — `/autopilot` (full pipeline), `/feature` (incremental), `/hotfix` (quick fix)
- **Context Budget** — Automatic context tracking and management
- **Existing Project Support** — Auto-detects your tech stack, never forces framework changes

## Installation

### Option 1: Plugin Marketplace (Recommended)

**1. Add the marketplace source**

```bash
claude plugin marketplace add poz110/claude-harness
```

**2. Install the plugin**

```bash
claude plugin install claude-harness
```

> [!TIP]
> To update when a new version is released:
> ```bash
> claude plugin marketplace remove claude-harness
> rm -rf ~/.claude/plugins/cache/claude-harness
> claude plugin marketplace add poz110/claude-harness
> claude plugin install claude-harness
> ```

Once installed, all commands are immediately available, including `/autopilot` for full automation. Workflow state is saved in your project's `state/` directory and persists across sessions.

**Getting started:**

```bash
# 1. Navigate to your project directory
cd your-project

# 2. Start Claude in dangerously-skip-permissions mode (required for autopilot)
claude --dangerously-skip-permissions

# 3. Type in Claude
/autopilot Build a blog system with Markdown editing and tag categorization
```

> **Updating from an older version?** Marketplace sources don't auto-sync:
> ```bash
> claude plugin marketplace remove claude-harness
> rm -rf ~/.claude/plugins/cache/claude-harness
> claude plugin marketplace add poz110/claude-harness
> claude plugin install claude-harness
> ```

### Option 2: Source Installation

For modifying the workflow engine itself or contributing code.

```bash
git clone https://github.com/poz110/claude-harness.git
cd claude-harness
node scripts/workflow.js init   # Install agents/skills/hooks to ~/.claude/
node scripts/workflow.js status # Verify installation
```

---

## Usage

### Autopilot — Fully Automated

```bash
/autopilot Build a blog system with Markdown editing and tag categorization
/feature Add user avatar upload with cropping and compression
/hotfix Fix the CSRF token vulnerability on the login page
```

Autopilot automatically dispatches all agents with no manual confirmation required until the project is complete. State is saved in `state/workflow-state.json` and can be resumed across sessions.

**Existing project support**: Autopilot auto-detects your project's tech stack (React/Vue/Ant Design/MUI/Tailwind, etc.) and builds on top of it during the Architect / Designer / Fullstack phases — it will never force new frameworks or deployment platforms.

### Three Work Modes

| Mode | Command | Use Case | Flow |
|------|---------|----------|------|
| **Full Pipeline** | `/autopilot <requirement>` | New projects, complete lifecycle | All 14 steps |
| **Incremental** | `/feature <requirement>` | Add features to existing projects | Skips arch/design, 10 steps |
| **Quick Fix** | `/hotfix <desc or Jira URL>` | Emergency bug fixes | Analyze → Fix → Writeback, 3 steps |

### Standalone Skill Commands (Available after plugin install)

```bash
/generate-prd           # Generate product requirements document
/generate-design        # Create design system
/implement-feature      # Implement frontend features
/implement-api          # Implement backend API
/arch-review            # Architecture review (generates ADR)
/code-review-arch       # Code review
/owasp-scan             # OWASP security scan
/prepare-tests          # Generate test plans and cases
/setup-cicd             # Configure CI/CD
/monitor                # Launch monitoring dashboard
```

### Workflow CLI (Requires source installation)

```bash
node scripts/workflow.js status       # View current state
node scripts/workflow.js advance      # Advance to next stage
node scripts/workflow.js check        # Check prerequisites
node scripts/workflow.js init-feature # Incremental feature mode (skip arch/design)
```

---

## Workflow State Machine

```
IDEA → PRD_DRAFT* → PRD_REVIEW → ARCH_REVIEW → CEO_REVIEW* → DESIGN_PHASE*
     → DESIGN_REVIEW → IMPLEMENTATION → CODE_REVIEW → QA_PHASE*
     → SECURITY_REVIEW → DEPLOY_PREP_SETUP → DEPLOY_PREP* → DONE

* = Manual confirmation node (auto-approved in Autopilot mode)
```

| State | Agent | Artifacts |
|-------|-------|-----------|
| `IDEA` | product-manager | `docs/prd.md` |
| `PRD_REVIEW` | software-architect | `docs/arch-decision.md` |
| `ARCH_REVIEW` | ux-designer | `DESIGN.md`, `docs/design-spec.md` |
| `CEO_REVIEW` | plan-ceo-review | `docs/ceo-review.md` |
| `DESIGN_REVIEW` | fullstack-engineer | `docs/api-spec.md`, code |
| `CODE_REVIEW` | qa-engineer | `docs/test-report.md` |
| `SECURITY_REVIEW` | security-auditor | `docs/security-report.md` |
| `DEPLOY_PREP_SETUP` | devops-engineer | `docs/deploy-plan.md`, `Dockerfile` |

---

## Requirements

- Node.js >= 18.0.0
- Claude Code (latest)

## License

MIT (c) Snow.Li
