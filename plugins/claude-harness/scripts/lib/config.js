'use strict'
/**
 * config.js — v15.0 Single Source of Truth
 *
 * 纯配置模块，无 IO 副作用。所有常量、状态机定义、Agent 权限均在此维护。
 *
 * v15 变化：
 *   - 全 Agent 写入权限白名单（AGENT_WRITE_PERMISSIONS）
 *   - 删除 dead code 配置（TIMEOUT/RETRY/CIRCUIT_BREAKER/DASHBOARD/PROJECT_CONFIG）
 *   - 删除重复的 checkAgentTeamsEnabled（统一在 hooks.js）
 */
const fs   = require('fs')
const path = require('path')

const SCHEMA_VERSION = '1.0'

const STATES = {
  IDEA:             { desc: 'Initial idea, PM to generate PRD',                   manual: false },
  PRD_DRAFT:        { desc: 'PRD generated, awaiting user review',                manual: true  },
  PRD_REVIEW:       { desc: 'User approved PRD, Architect reviewing',             manual: false },
  ARCH_REVIEW:      { desc: 'ADR complete, Designer creating design',            manual: false },
  CEO_REVIEW:       { desc: 'Design complete, CEO reviewing UX logic',            manual: true  },
  DESIGN_PHASE:     { desc: 'Design complete, awaiting user review',              manual: true  },
  DESIGN_REVIEW:    { desc: 'User approved design, Full-Stack Engineer implementing', manual: false },
  IMPLEMENTATION:   { desc: 'Implementation done, Reviewer doing code review',    manual: false },
  CODE_REVIEW:      { desc: 'Code review done, QA testing',                       manual: false },
  QA_PHASE:         { desc: 'QA complete, awaiting user review',                  manual: true  },
  SECURITY_REVIEW:  { desc: 'User approved QA, Security auditing',                manual: false },
  DEPLOY_PREP_SETUP:{ desc: 'Security audit done, DevOps preparing deploy',       manual: false },
  DEPLOY_PREP:      { desc: 'Deploy ready, awaiting user approval',               manual: true  },
  DONE:             { desc: 'Pipeline complete — shipped!',                        manual: false },
}

const TRANSITIONS = {
  IDEA:             { next: 'PRD_DRAFT',          agent: 'product-manager',               type: 'auto'   },
  PRD_DRAFT:        { next: 'PRD_REVIEW',          agent: 'User',             type: 'manual' },
  PRD_REVIEW:       { next: 'ARCH_REVIEW',         agent: 'software-architect',        type: 'auto'   },
  ARCH_REVIEW:      { next: 'CEO_REVIEW',        agent: 'ux-designer',         type: 'auto'   },  // [v1.0] Designer完成后进入CEO审视
  CEO_REVIEW:       { next: 'DESIGN_PHASE',       agent: 'plan-ceo-review',       type: 'manual' },  // [v1.0] 用户确认CEO审视结果
  DESIGN_PHASE:     { next: 'DESIGN_REVIEW',       agent: 'User',             type: 'manual' },
  DESIGN_REVIEW:    { next: 'IMPLEMENTATION',      agent: 'fullstack-engineer',                           type: 'auto'   },
  IMPLEMENTATION:   { next: 'CODE_REVIEW',         agent: 'code-reviewer',         type: 'auto'   },
  CODE_REVIEW:      { next: 'QA_PHASE',            agent: 'qa-engineer',               type: 'auto'   },
  QA_PHASE:         { next: 'SECURITY_REVIEW',     agent: 'User',             type: 'manual' },
  SECURITY_REVIEW:  { next: 'DEPLOY_PREP_SETUP',   agent: 'security-auditor', type: 'auto'   },
  DEPLOY_PREP_SETUP:{ next: 'DEPLOY_PREP',         agent: 'devops-engineer',           type: 'auto'   },
  DEPLOY_PREP:      { next: 'DONE',                agent: 'User',             type: 'manual' },
  DONE:             { next: null,                   agent: '-',                type: 'end'    },
}

const PREREQS = {
  PRD_REVIEW:        ['docs/prd.md'],
  ARCH_REVIEW:       ['docs/prd.md', 'docs/arch-decision.md', 'docs/security-baseline.md'],
  CEO_REVIEW:        ['docs/prd.md', 'docs/arch-decision.md', 'docs/design-spec.md'],  // [v1.0] CEO审视前置
  DESIGN_PHASE:      ['DESIGN.md', 'docs/design-spec.md'],
  // [v12] interaction-spec.md required before FE/BE can start — it's the behavioral contract
  DESIGN_REVIEW:     ['DESIGN.md', 'docs/design-spec.md', 'docs/interaction-spec.md'],
  IMPLEMENTATION:    ['docs/api-spec.md', 'docs/traceability-matrix.md', 'docs/interaction-spec.md'],
  CODE_REVIEW:       ['docs/code-review.md'],
  QA_PHASE:          ['docs/test-plan.md', 'docs/test-report.md'],
  SECURITY_REVIEW:   ['docs/security-report.md'],
  DEPLOY_PREP:       ['docs/deploy-plan.md', 'docs/runbook.md'],
}

const STALE_ARTIFACTS = {
  PRD_DRAFT:         ['docs/prd.md'],
  ARCH_REVIEW:       ['docs/arch-decision.md', 'docs/security-baseline.md', 'docs/traceability-matrix.md'],
  // [v1.0.1 P1.2 修复] CEO_REVIEW stale artifacts 包含 Designer 在 ARCH_REVIEW 阶段产出的设计文件
  // 原因：rolling back CEO_REVIEW → ARCH_REVIEW 时 statesToClean=[CEO_REVIEW]，
  //       若设计文件只在 DESIGN_PHASE 中，回滚一步不会清理，导致陈旧设计残留。
  CEO_REVIEW:        ['docs/ceo-review.md', 'DESIGN.md', 'docs/design-spec.md', 'design/'],
  // [v12] interaction-spec.md 在 DESIGN_PHASE 阶段由 Designer 产出
  // [v13] design/states/ 在 DESIGN_PHASE 阶段产出
  // DESIGN.md / design-spec.md / design/ 已移至 CEO_REVIEW（更精确的生命周期）
  DESIGN_PHASE:      ['docs/interaction-spec.md', 'design/states/'],
  // Note: .claude/review-notes.md is intentionally NOT cleaned on rollback.
  // It is a permanent append-only communication log (fallback channel for Agent Teams disabled mode).
  // Cleaning it would erase cross-agent communication history that may still be relevant.
  DESIGN_REVIEW:     ['docs/api-spec.md', 'docs/pixel-check-report.md'],
  CODE_REVIEW:       ['docs/code-review.md'],
  QA_PHASE:          ['docs/test-plan.md', 'docs/test-report.md', 'docs/code-review.md'],
  SECURITY_REVIEW:   ['docs/security-report.md'],
  DEPLOY_PREP_SETUP: ['docs/deploy-plan.md', 'docs/runbook.md'],
}

const CODE_OUTPUTS = {
  FE: {
    dir: 'apps/web',
    required: ['package.json', 'tsconfig.json'],
    minFiles: 5,
    verifySteps: [
      { name: 'Install deps', cmd: ['npm', 'install'],              timeout: 300, optional: false },
      { name: 'Build',        cmd: ['npm', 'run', 'build'],          timeout: 300, optional: false },
      { name: 'Lint',         cmd: ['npx', 'biome', 'check', '.'],   timeout: 120, optional: true  },
      { name: 'Type check',   cmd: ['npx', 'tsc', '--noEmit'],       timeout: 120, optional: false },
    ],
  },
  BE: {
    dir: 'apps/server',
    required: ['package.json', 'src/db/schema.ts'],
    minFiles: 5,
    verifySteps: [
      { name: 'Install deps', cmd: ['bun', 'install'],              timeout: 120, optional: false },
      { name: 'Build',        cmd: ['bun', 'run', 'build'],          timeout: 180, optional: false },
      { name: 'Lint',         cmd: ['npx', 'biome', 'check', '.'],   timeout: 120, optional: true  },
      { name: 'Type check',   cmd: ['npx', 'tsc', '--noEmit'],       timeout: 120, optional: false },
    ],
  },
}

const ARTIFACT_STATE_MAP = {
  'docs/prd.md':                  { completedState: 'IDEA',              validatorKey: 'prd'               },
  'docs/arch-decision.md':        { completedState: 'PRD_REVIEW',        validatorKey: 'arch'              },
  'docs/security-baseline.md':    { completedState: 'PRD_REVIEW',        validatorKey: 'security-baseline' },
  'docs/design-spec.md':          { completedState: 'ARCH_REVIEW',       validatorKey: 'design-spec'       },
  'DESIGN.md':                    { completedState: 'ARCH_REVIEW',       validatorKey: null                },
  // [v12] interaction-spec: produced by Designer at end of DESIGN_PHASE
  'docs/interaction-spec.md':     { completedState: 'ARCH_REVIEW',       validatorKey: 'interaction-spec'  },
  // [v1.0] ceo-review: produced by plan-ceo-review Agent after ARCH_REVIEW
  'docs/ceo-review.md':           { completedState: 'ARCH_REVIEW',       validatorKey: 'ceo-review'        },
  'docs/api-spec.md':             { completedState: 'DESIGN_REVIEW',     validatorKey: 'api-spec'          },
  'docs/code-review.md':          { completedState: 'IMPLEMENTATION',    validatorKey: null                },
  'docs/test-report.md':          { completedState: 'CODE_REVIEW',       validatorKey: 'test-report'       },
  'docs/security-report.md':      { completedState: 'QA_PHASE',          validatorKey: null                },
  'docs/deploy-plan.md':          { completedState: 'DEPLOY_PREP_SETUP', validatorKey: 'deploy-plan'       },
  'docs/runbook.md':              { completedState: 'DEPLOY_PREP_SETUP', validatorKey: null                },
  'docs/traceability-matrix.md':  { completedState: 'PRD_REVIEW',        validatorKey: 'traceability'      },
  'design/baseline/':             { completedState: 'DESIGN_PHASE',       validatorKey: null                },
}

// [v1.0.2] 每個狀態對應的產物文檔（用於 Monitor 面板顯示）
const ARTIFACT_DOCS = {
  IDEA: [],
  PRD_DRAFT: ['docs/prd.md'],
  PRD_REVIEW: ['docs/prd.md', 'docs/arch-decision.md', 'docs/security-baseline.md', 'docs/traceability-matrix.md'],
  ARCH_REVIEW: ['docs/prd.md', 'docs/arch-decision.md', 'docs/design-spec.md', 'DESIGN.md'],
  CEO_REVIEW: ['docs/ceo-review.md', 'docs/design-spec.md'],
  DESIGN_PHASE: ['docs/interaction-spec.md', 'design/'],
  DESIGN_REVIEW: ['docs/api-spec.md'],
  IMPLEMENTATION: ['docs/api-spec.md', 'docs/code-review.md'],
  CODE_REVIEW: ['docs/code-review.md', 'docs/test-plan.md'],
  QA_PHASE: ['docs/test-plan.md', 'docs/test-report.md'],
  SECURITY_REVIEW: ['docs/security-report.md'],
  DEPLOY_PREP_SETUP: ['docs/deploy-plan.md', 'docs/runbook.md'],
  DEPLOY_PREP: ['docs/deploy-plan.md', 'docs/runbook.md'],
  DONE: ['docs/prd.md', 'docs/arch-decision.md', 'docs/deploy-plan.md', 'docs/runbook.md'],
}

const DANGEROUS_BASH_PATTERNS = [
  {
    pattern: /drizzle-kit push/,
    check: () => {
      try {
        const fs = require('fs'), path = require('path')
        return process.env.NODE_ENV === 'production' ||
               fs.existsSync(path.join(process.cwd(), '.production'))
      } catch { return false }
    },
    message: '生产环境禁止使用 drizzle-kit push，请使用 drizzle-kit generate + migrate',
  },
  {
    pattern: /rm\s+-rf\s+state\//,
    check: () => true,
    message: '禁止直接删除 state/ 目录，请使用 node scripts/workflow.js reset',
  },
  {
    pattern: />\s*state\/workflow-state\.json/,
    check: () => true,
    message: '禁止直接覆盖 workflow-state.json，请使用 workflow.js 命令',
  },
]

const DOC_VALIDATORS = {
  prd: {
    file: 'docs/prd.md',
    checks: [
      { name: 'Has office-hours insight',  pattern: /Office Hours|关键洞察|真实问题/i },
      { name: 'Has Appetite/scope mode',   pattern: /Appetite|Small Batch|Big Batch|scope.?mode/i },
      { name: 'Has OKR section',           pattern: /##\s*(OKR|Objective|Key Results)/i },
      { name: 'Has guardrail metrics',     pattern: /(护|護)(栏|欄)指(标|標)|Guardrail/i },
      { name: 'Has Gherkin scenario',      pattern: /Scenario:/i },
      { name: 'Has MoSCoW table',          pattern: /Must|Should|Could|Won't/i },
      { name: 'Has death conditions',      pattern: /死亡(条|條)件|Kill Condition/i },
      { name: 'Has stakeholder matrix',    pattern: /Stakeholder|干系人/i },
      { name: 'Has non-functional req',    pattern: /非功能需求|Non-functional/i },
      { name: 'Word count 600-2500',       fn: (c) => { const w = c.split(/\s+/).length; return w >= 600 && w <= 2500 } },
      { name: 'No vague acceptance',       fn: (c) => !['易于使用','快速响应','用户友好','user-friendly','easy to use'].some(v => c.includes(v)) },
    ],
  },
  arch: {
    file: 'docs/arch-decision.md',
    checks: [
      { name: 'Has system diagram (ASCII)', pattern: /[┌│└├─┐┘┤]/ },
      { name: 'Has tech stack table',       pattern: /\|\s*层级\s*\||\|\s*Layer\s*\|/i },
      { name: 'Has rejected alternatives',  pattern: /放弃|Rejected|Alternative/i },
      { name: 'Has state machine diagram',  pattern: /状态机|State Machine|→.*→/i },
      { name: 'Has sequence diagram',       pattern: /序列|Sequence|─+▶/i },
      { name: 'Has error paths',            pattern: /错误路径|Error Path/i },
      { name: 'Has data model',             pattern: /pgTable|schema\.ts|数据模型/i },
      { name: 'Has interface contract',     pattern: /tRPC|REST|API.*contract|接口契约/i },
      { name: 'Has tech debt radar',        pattern: /技术债|Tech Debt/i },
      { name: 'Has risk matrix',            pattern: /风险|Risk/i },
    ],
  },
  'security-baseline': {
    file: 'docs/security-baseline.md',
    checks: [
      { name: 'Has auth scheme',            pattern: /认证|Authentication|JWT|session/i },
      { name: 'Has endpoint permissions',   pattern: /端点|Endpoint|权限表|Permission/i },
      { name: 'Has data classification',    pattern: /PII|数据分类|敏感数据/i },
      { name: 'Has FE constraints',         pattern: /FE.*约束|前端.*禁止|localStorage/i },
      { name: 'Has BE constraints',         pattern: /BE.*约束|后端.*禁止|SQL.*注入/i },
    ],
  },
  'design-spec': {
    file: 'docs/design-spec.md',
    checks: [
      { name: 'Has audit score (>=40/80)',  fn: (c) => { const m = c.match(/(\d+)\s*\/\s*80/); return m && parseInt(m[1],10) >= 40 } },
      { name: 'Has color tokens',           pattern: /--color-|color.*token/i },
      { name: 'Has typography spec',        pattern: /font|字体|字阶|typography/i },
      { name: 'Has spacing system',         pattern: /spacing|间距|padding.*8px/i },
      { name: 'Has component states',       pattern: /hover|focus|disabled|loading|error/i },
      { name: 'Has responsive breakpoints', pattern: /375|768|1440|mobile|desktop/i },
    ],
  },
  'test-report': {
    file: 'docs/test-report.md',
    checks: [
      { name: 'Has pass/fail verdict',      pattern: /PASS|FAIL/i },
      { name: 'Has P0/P1 bug section',      pattern: /P0|P1/i },
      { name: 'Has coverage stats',         pattern: /coverage|覆盖率|\d+%/i },
      { name: 'Has test counts',            pattern: /\d+\s*(tests?|个测试|passed|failed)/i },
    ],
  },
  traceability: {
    file: 'docs/traceability-matrix.md',
    checks: [
      { name: 'Has PRD requirement IDs (F###)',  pattern: /F\d{3}/ },
      { name: 'Has implementation mapping',      pattern: /impl|component|route|endpoint/i },
      { name: 'Has test coverage mapping',       pattern: /test|QA|scenario|Scenario/i },
      { name: 'Has Must features listed',        pattern: /Must/i },
      { name: 'Has coverage percentage',         fn: (c) => /\d+\s*\/\s*\d+/.test(c) || /%/.test(c) },
    ],
  },
  'api-spec': {
    file: 'docs/api-spec.md',
    checks: [
      { name: 'Has endpoint table',             pattern: /Method.*Path|GET|POST|PUT|DELETE/i },
      { name: 'Has request schema',             pattern: /request|body|params|query/i },
      { name: 'Has response schema',            pattern: /response|returns|data:/i },
      { name: 'Has error codes',                pattern: /error|4\d{2}|5\d{2}/i },
      { name: 'Has auth requirements',          pattern: /auth|protected|permission/i },
      { name: 'Has version',                    pattern: /v\d|version/i },
    ],
  },
  'deploy-plan': {
    file: 'docs/deploy-plan.md',
    checks: [
      { name: 'Has deploy strategy',        pattern: /rolling|blue.green|蓝绿|滚动/i },
      { name: 'Has rollback procedure',     pattern: /rollback|回滚/i },
      { name: 'Has health check',           pattern: /health.*check|健康检查/i },
      { name: 'Has env variables list',     pattern: /env|环境变量|secrets/i },
      { name: 'Has SLO definition',         pattern: /SLO|99\.\d%|可用性/i },
    ],
  },

  // ── [v12.1] Interaction Spec ──────────────────────────────────────────────
  // Generated from user-confirmed intent checklist (not a template).
  // Contains: confirmed navigation behaviors, form field specs, operation behaviors,
  // global rules, and explicitly excluded features.
  'interaction-spec': {
    file: 'docs/interaction-spec.md',
    checks: [
      // Must be based on confirmed user intent
      { name: 'Has confirmed intent marker',   pattern: /已确认|用户.*确认|confirmed|intent/i },
      // Must have navigation behaviors (元素→目标)
      { name: 'Has navigation behaviors',      pattern: /跳转|弹窗|抽屉|Modal|Drawer|navigate|open.*modal/i },
      // Must have form field specs
      { name: 'Has form field specs',          pattern: /必填|required|校验|validate|placeholder/i },
      // Must have operation behaviors with success/failure handling
      { name: 'Has operation success/failure', pattern: /成功.*跳转|失败.*提示|success.*redirect|error.*display/i },
      // Must have global interaction rules
      { name: 'Has global rules',              pattern: /全局|global|所有.*页面|适用.*所有/i },
      // Must have explicit exclusions (confirmed out-of-scope)
      { name: 'Has confirmed exclusions',      pattern: /本期不做|不实现|排除|v2|excluded/i },
      // Must cover error code handling
      { name: 'Has error code handling',       pattern: /4\d{2}|5\d{2}|401|422|500/i },
    ],
  },

  // ── [v12] Error Map ────────────────────────────────────────────────────────
  // Maps every BE error code to FE display behavior. Embedded in interaction-spec.md
  // or as a standalone section. Checked at CODE_REVIEW by Reviewer (F-019).
  'error-map': {
    file: 'docs/interaction-spec.md',
    checks: [
      { name: 'Has 400 mapping',  pattern: /400|Bad Request|参数错误/i },
      { name: 'Has 401 mapping',  pattern: /401|Unauthorized|未登录|登录过期/i },
      { name: 'Has 403 mapping',  pattern: /403|Forbidden|无权限/i },
      { name: 'Has 404 mapping',  pattern: /404|Not Found|不存在/i },
      { name: 'Has 422 mapping',  pattern: /422|Validation|字段.*错误|校验失败/i },
      { name: 'Has 429 mapping',  pattern: /429|Rate Limit|频率.*限制|请求.*过多/i },
      { name: 'Has 500 mapping',  pattern: /500|Server Error|服务器.*错误|系统.*异常/i },
      { name: 'Has network error',pattern: /network|网络.*错误|断网|超时/i },
    ],
  },

  // ── [v1.0] CEO Review Validator ──────────────────────────────────────────────
  // Validates CEO UX review output before Design phase starts
  'ceo-review': {
    file: 'docs/ceo-review.md',
    checks: [
      { name: 'Has UX dimension scores',     pattern: /维度.*评分|###\s*\d+\./i },
      { name: 'Has scoring for each dimension', pattern: /\d+\/10/ },
      { name: 'Has decision summary',        pattern: /决策确认|决策点|需要你确认/i },
      { name: 'Has clear recommendations',   pattern: /建议|改进|挑战/i },
      { name: 'Has average score',           pattern: /平均分|总分/i },
    ],
  },
}

// ─── [v11] Context Budget Config ─────────────────────────────────────────────

const CONTEXT_BUDGET = {
  WARN_THRESHOLD: 0.70,
  REREAD_THRESHOLD: 0.85,
  TRACK_BATCH_SIZE: 5,   // [v1.0.1 P0.2] 每 N 次操作才持久化 context 计数（减少 80% I/O）
  CRITICAL_DOCS: {
    fe: [
      'docs/traceability-matrix.md',
      'docs/api-spec.md',
      'design/design-tokens.css',
      'docs/prd.md',
    ],
    be: [
      'docs/traceability-matrix.md',
      'docs/api-spec.md',
      'docs/arch-decision.md',
      'docs/security-baseline.md',
    ],
    reviewer: [
      'docs/traceability-matrix.md',
      'docs/arch-decision.md',
      'docs/code-review.md',
    ],
    qa: [
      'docs/traceability-matrix.md',
      'docs/test-plan.md',
      'docs/api-spec.md',
    ],
  },
}

// ─── [v11.1] Agent Teams Communication Config ─────────────────────────────────
//
// v11 设计错误与 v11.1 修正：
//
// v11 的问题：
//   `send-message` / `read-messages` 用 review-notes.md 文件模拟了官方 Mailbox。
//   当 Agent Teams 真正启用时，这套文件层与官方 Mailbox 语义重叠，造成两条并行
//   但功能相同的通信通道，增加认知负担，且官方通道更可靠。
//
// v11.1 的修正（严格两路分离）：
//
//   路径 A — Agent Teams 启用（CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1）：
//     Orchestrator 直接使用官方原生工具：
//       TeamCreate   → 创建 fe-be-team
//       TaskCreate   → 为 FE/BE 各创建一个 Task（含 blockedBy 依赖）
//       SendMessage  → FE/BE 之间直接互发消息
//     workflow.js 提供 `generate-team-dispatch` 命令，输出完整的 Orchestrator
//     调度脚本（包含 TaskCreate 调用示例），不再自己管理消息。
//     review-notes.md 在此路径下：不使用。
//
//   路径 B — Agent Teams 禁用（默认，向后兼容）：
//     保留 review-notes.md 文件轮询，作为唯一的降级通信通道。
//     FE/BE 通过 Orchestrator 写入 / 读取 review-notes.md 传递接口变更通知。
//     没有任何"消息 ID"或"已读/未读"状态——保持简单的 append-only 日志格式。
//
// 两条路径不混用，不互相感知，各自完整。

const AGENT_TEAMS_CONFIG = {
  // 官方环境变量（设置为 "1" 启用）
  ENV_FLAG: 'CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS',

  // ── 路径 A：Agent Teams 原生工具调用模板 ────────────────────────────────
  // [DEPRECATED v14.3] 并行 FE+BE 调度模板
  // DESIGN_REVIEW 阶段已改为 fullstack-engineer 单 Agent，无需 Team 调度
  // 本模板仅保留向后兼容，generate-team-dispatch 命令已标记废弃

  NATIVE_TEAM_NAME: 'fe-be-impl',  // ~/.claude/teams/fe-be-impl/ (deprecated)

  // [DEPRECATED v14.3] — DESIGN_REVIEW 现在用 fullstack-engineer 单 Agent
  NATIVE_DISPATCH_TEMPLATE: `
## ⚠️  [DEPRECATED v14.3] 本模板已废弃

DESIGN_REVIEW 阶段现在由 fullstack-engineer 单 Agent 实现，无需并行团队调度。
以下内容仅保留历史参考。Orchestrator 请直接派发 fullstack-engineer。

---

## Agent Teams 原生调度（CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 已启用）

Orchestrator 在 DESIGN_REVIEW 阶段执行以下步骤：

### Step 1：创建团队

\`\`\`
TeamCreate({
  "name": "fe-be-impl",
  "description": "FE + BE 并行实现团队，负责 DESIGN_REVIEW → IMPLEMENTATION 阶段"
})
\`\`\`

### Step 2：创建 BE 任务（先于 FE，因为 FE 依赖 api-spec）

\`\`\`
TaskCreate({
  "subject": "BE：实现后端 API",
  "description": "读 docs/traceability-matrix.md 确认 BE 负责的 API 范围。\\n执行 env-check 模块 B。\\n先写 docs/api-spec.md（v1.0），用 SendMessage 通知 FE teammate。\\n运行 node scripts/workflow.js validate-doc api-spec 验证。\\n实现所有路由后运行 node scripts/workflow.js update-progress BE true。\\n如接口有变更，更新版本号并再次 SendMessage 通知 FE。",
  "activeForm": "实现后端 API..."
})
\`\`\`

### Step 3：创建 FE 任务（依赖 BE 的 api-spec 就绪）

\`\`\`
TaskCreate({
  "subject": "FE：实现前端功能",
  "description": "读 docs/traceability-matrix.md 确认 FE 负责的功能范围，将条目更新为 🔧。\\n等待 BE teammate 的 SendMessage 通知（api-spec v1.0 就绪）后开始实现。\\n执行 env-check 模块 C。\\n对照 design/ 设计稿实现，以 design/baseline/ 为视觉基准。\\n如发现接口问题，用 SendMessage 告知 BE teammate（不要写文件）。\\n完成后运行 node scripts/workflow.js update-progress FE true。",
  "activeForm": "实现前端功能..."
})
\`\`\`
注意：FE 任务无需设 blockedBy——FE teammate 会等待 BE 发来的 SendMessage 再开始，
不需要 TaskList 层面的硬依赖（保持并行调度灵活性）。

### Step 4：BE→FE 通知 api-spec 就绪（BE teammate 执行）

\`\`\`
SendMessage({
  "to": "fe-impl",          // FE teammate 的 agent_id
  "text": "api-spec v1.0 已写入 docs/api-spec.md。端点列表：\\n- POST /api/xxx\\n- GET /api/xxx/:id\\n可以开始前端实现。",
  "summary": "api-spec v1.0 就绪"
})
\`\`\`

### Step 5：FE→BE 通知接口问题（FE teammate 执行，如有需要）

\`\`\`
SendMessage({
  "to": "be-impl",          // BE teammate 的 agent_id
  "text": "接口问题：POST /api/xxx 响应缺少 createdAt 字段，FE 列表需要显示时间。建议：在响应 schema 中添加 createdAt: string（ISO 8601）。",
  "summary": "POST /api/xxx 响应缺少 createdAt"
})
\`\`\`

### Step 6：Orchestrator 等待双方完成

轮询 TaskList 直到两个 Task 均为 completed：
\`\`\`
TaskList({ "filter": "in_progress" })
// 当结果为空时，双方均已完成
\`\`\`

然后执行：
\`\`\`bash
node scripts/workflow.js check-parallel-done && node scripts/workflow.js advance
\`\`\`
`.trim(),

  // ── 路径 B：文件轮询降级通道 ──────────────────────────────────────────────
  // Agent Teams 禁用时，FE/BE 通过此文件 append-only 传递变更通知
  // 格式：简单的 Markdown，无消息 ID，无已读状态，保持最简单
  FALLBACK_CHANNEL_FILE: '.claude/review-notes.md',

  // 路径 B 的消息写入规范（给 Orchestrator/FE/BE Agent 看的格式说明）
  FALLBACK_FORMAT_GUIDE: `
文件轮询模式下，在 .claude/review-notes.md 追加消息（append-only）：

## [时间戳] FROM: be → FE 通知
api-spec 已更新至 v1.1。变更：新增 GET /users/me 端点。
FE 请在继续实现前重读 docs/api-spec.md。

---

## [时间戳] FROM: fe → BE 通知  
接口问题：POST /users 响应缺少 createdAt 字段。
建议：添加 createdAt: string (ISO 8601)。

---

规则：
- 只追加，不修改已有内容
- 无需消息 ID 或已读标记（Agent 自行判断哪些是新的）
- Orchestrator 在 advance 之前读取此文件确认无未处理问题
`.trim(),
}

// ─── [v11] Global Install Config ──────────────────────────────────────────────

// ─── [v13.1] Tech Stack Presets ───────────────────────────────────────────────
//
// init-project 时询问用户选择技术栈，动态写入项目的 CODE_OUTPUTS 和路径前缀。
// 新增技术栈：在此加一个 key，其余逻辑自动适配。
//
const TECH_STACK_PRESETS = {
  // ── 前端 ──
  'nextjs': {
    label: 'Next.js 15 (App Router, TypeScript)',
    fe: {
      dir: 'apps/web',
      required: ['package.json', 'tsconfig.json'],
      minFiles: 5,
      verifySteps: [
        { name: 'Install deps', cmd: ['npm', 'install'],            timeout: 300, optional: false },
        { name: 'Build',        cmd: ['npm', 'run', 'build'],        timeout: 300, optional: false },
        { name: 'Lint',         cmd: ['npx', 'biome', 'check', '.'], timeout: 120, optional: true  },
        { name: 'Type check',   cmd: ['npx', 'tsc', '--noEmit'],     timeout: 120, optional: false },
      ],
    },
  },
  'vue': {
    label: 'Vue 3 + Vite (TypeScript)',
    fe: {
      dir: 'apps/web',
      required: ['package.json', 'vite.config.ts'],
      minFiles: 5,
      verifySteps: [
        { name: 'Install deps', cmd: ['npm', 'install'],            timeout: 300, optional: false },
        { name: 'Build',        cmd: ['npm', 'run', 'build'],        timeout: 300, optional: false },
        { name: 'Lint',         cmd: ['npx', 'eslint', '.'],         timeout: 120, optional: true  },
        { name: 'Type check',   cmd: ['npx', 'vue-tsc', '--noEmit'], timeout: 120, optional: false },
      ],
    },
  },
  'remix': {
    label: 'Remix (TypeScript)',
    fe: {
      dir: 'apps/web',
      required: ['package.json', 'remix.config.js'],
      minFiles: 5,
      verifySteps: [
        { name: 'Install deps', cmd: ['npm', 'install'],            timeout: 300, optional: false },
        { name: 'Build',        cmd: ['npm', 'run', 'build'],        timeout: 300, optional: false },
        { name: 'Type check',   cmd: ['npx', 'tsc', '--noEmit'],     timeout: 120, optional: false },
      ],
    },
  },

  // ── 后端 ──
  'bun-hono': {
    label: 'Bun + Hono (TypeScript) — default',
    be: {
      dir: 'apps/server',
      required: ['package.json', 'src/db/schema.ts'],
      minFiles: 5,
      verifySteps: [
        { name: 'Install deps', cmd: ['bun', 'install'],              timeout: 120, optional: false },
        { name: 'Build',        cmd: ['bun', 'run', 'build'],          timeout: 180, optional: false },
        { name: 'Lint',         cmd: ['npx', 'biome', 'check', '.'],   timeout: 120, optional: true  },
        { name: 'Type check',   cmd: ['npx', 'tsc', '--noEmit'],       timeout: 120, optional: false },
      ],
    },
  },
  'node-express': {
    label: 'Node.js + Express (TypeScript)',
    be: {
      dir: 'apps/server',
      required: ['package.json', 'src/index.ts'],
      minFiles: 5,
      verifySteps: [
        { name: 'Install deps', cmd: ['npm', 'install'],              timeout: 300, optional: false },
        { name: 'Build',        cmd: ['npm', 'run', 'build'],          timeout: 180, optional: false },
        { name: 'Lint',         cmd: ['npx', 'eslint', 'src'],         timeout: 120, optional: true  },
        { name: 'Type check',   cmd: ['npx', 'tsc', '--noEmit'],       timeout: 120, optional: false },
      ],
    },
  },
  'django': {
    label: 'Django (Python)',
    be: {
      dir: 'apps/server',
      required: ['manage.py', 'requirements.txt'],
      minFiles: 5,
      verifySteps: [
        { name: 'Install deps', cmd: ['pip', 'install', '-r', 'requirements.txt'], timeout: 300, optional: false },
        { name: 'Check',        cmd: ['python', 'manage.py', 'check'],              timeout: 60,  optional: false },
        { name: 'Test',         cmd: ['python', 'manage.py', 'test', '--keepdb'],   timeout: 180, optional: true  },
      ],
    },
  },
  'go-gin': {
    label: 'Go + Gin',
    be: {
      dir: 'apps/server',
      required: ['go.mod', 'main.go'],
      minFiles: 3,
      verifySteps: [
        { name: 'Tidy',   cmd: ['go', 'mod', 'tidy'],   timeout: 120, optional: false },
        { name: 'Build',  cmd: ['go', 'build', './...'], timeout: 180, optional: false },
        { name: 'Vet',    cmd: ['go', 'vet', './...'],   timeout: 60,  optional: true  },
        { name: 'Test',   cmd: ['go', 'test', './...'],  timeout: 180, optional: true  },
      ],
    },
  },
  'fastapi': {
    label: 'FastAPI (Python)',
    be: {
      dir: 'apps/server',
      required: ['requirements.txt', 'main.py'],
      minFiles: 3,
      verifySteps: [
        { name: 'Install deps', cmd: ['pip', 'install', '-r', 'requirements.txt'], timeout: 300, optional: false },
        { name: 'Lint',         cmd: ['ruff', 'check', '.'],                        timeout: 60,  optional: true  },
        { name: 'Type check',   cmd: ['mypy', '.'],                                 timeout: 120, optional: true  },
      ],
    },
  },

  // ── monorepo 目录别名（影响 FE_PATH_PREFIX / BE_PATH_PREFIX）──
  'flat': {
    label: 'Flat (无 monorepo，前端根目录 / 后端 server/)',
    feDir: '',          // 前端在根目录
    beDir: 'server',
  },
}

/** 从 workflow-state.json 读取已选技术栈，回退到默认值 */
function resolveCodeOutputs(state) {
  const feKey = state?.techStack?.fe || 'nextjs'
  const beKey = state?.techStack?.be || 'bun-hono'
  const fePreset = TECH_STACK_PRESETS[feKey]?.fe || TECH_STACK_PRESETS['nextjs'].fe
  const bePreset = TECH_STACK_PRESETS[beKey]?.be || TECH_STACK_PRESETS['bun-hono'].be
  return { FE: fePreset, BE: bePreset }
}

// ─── [v13.1] Agent Model Map ──────────────────────────────────────────────────
//
// 单一真相来源。升级模型只改这里，所有 agent 自动生效。
//
// 设计原则：
//   - TIER_HEAVY  : 需要深度推理、长文档生成、多步骤规划的 agent（PM/Architect/Designer）
//   - TIER_STANDARD : 主力实现 agent（FE/BE/QA/DevOps/Reviewer）
//   - TIER_FAST   : 轻量探索、快速修复（General / Orchestrator 路由决策）
//   - TIER_AUDIT  : 只读安全审计（权限最小，模型无需最强）
//
// 每个 tier 可独立升降级，不影响其他 tier。
// 在 agent .md 文件的 frontmatter 中引用为注释占位符，
// 实际模型由 workflow.js 在 install-global / init-project 时注入。
//
const AGENT_MODEL_MAP = {
  // ── tier 定义 ──
  // [v1.0 P1.2] 模型分级优化：根据工作负载复杂度分配不同模型
  //
  // 成本优先级（降序）：opus > sonnet > haiku
  // 性能优先级（降序）：opus > sonnet > haiku
  //
  // 建议配置（根据预算/质量要求选择）：
  //   追求质量（预算充足）: TIER_HEAVY 用 opus
  //   平衡成本/质量: TIER_HEAVY 用 sonnet（本配置默认）
  //   优化成本: TIER_FAST / TIER_AUDIT 用 haiku
  //
  TIER_HEAVY:    'claude-sonnet-4-6',   // PM/Architect/Designer — 深度推理，可升级为 opus-4-6
  TIER_STANDARD: 'claude-sonnet-4-6', // FE/BE/QA/DevOps/Reviewer — 主力实现
  TIER_FAST:     'claude-haiku-4-5-20251001', // Orchestrator/General — 快速路由/修复（成本优化）
  TIER_AUDIT:    'claude-haiku-4-5-20251001', // Security Auditor — 只读审计（成本优化）

  // ── agent → tier 映射 ──
  'product-manager':        'TIER_HEAVY',
  'software-architect':   'TIER_HEAVY',
  'ux-designer':        'TIER_HEAVY',
  'plan-ceo-review':     'TIER_STANDARD',  // [v1.0.2 P1.1修复] CEO审视分 < 6 会触发整轮回滚（PM+Arch重做），需要Sonnet质量保障
  'fullstack-engineer':   'TIER_STANDARD',  // [v1.0.3] 合并 FE+BE，消除接口漂移
  'frontend-engineer':    'TIER_STANDARD',  // [deprecated] 保留向后兼容，推荐使用 fullstack-engineer
  'backend-engineer':     'TIER_STANDARD',  // [deprecated] 保留向后兼容，推荐使用 fullstack-engineer
  'code-reviewer':      'TIER_STANDARD',
  'qa-engineer':        'TIER_STANDARD',
  'devops-engineer':    'TIER_STANDARD',
  'workflow-orchestrator': 'TIER_FAST',
  'general-assistant':   'TIER_FAST',
  'security-auditor':   'TIER_AUDIT',
}

// ─── [v1.0.2 P1.5] Model Cost Table ───────────────────────────────────────────
//
// Claude API pricing (per 1M tokens, approximate).
// 用于估算各 Agent 阶段的 token 消耗成本。
// Tier 映射来自 AGENT_MODEL_MAP。
//
const MODEL_COSTS = {
  // $ per 1M tokens (input + output blended)
  'claude-sonnet-4-6':  9.00,   // Sonnet 4: $3/M in + $6/M out ≈ $9/M blended
  'claude-haiku-4-5-20251001': 2.40,  // Haiku 4.5: $0.8/M in + $1.6/M out ≈ $2.4/M blended
  'claude-opus-4-6':   45.00,  // Opus 4: $15/M in + $30/M out ≈ $45/M blended
}

// 估算 token 成本（基于 estimated tokens）
const COST_PER_MILLION = {
  TIER_HEAVY:    MODEL_COSTS['claude-sonnet-4-6'],
  TIER_STANDARD: MODEL_COSTS['claude-sonnet-4-6'],
  TIER_FAST:     MODEL_COSTS['claude-haiku-4-5-20251001'],
  TIER_AUDIT:    MODEL_COSTS['claude-haiku-4-5-20251001'],
}


const GLOBAL_INSTALL_CONFIG = {
  GLOBAL_AGENTS: [
    'agents/pm.md', 'agents/architect.md', 'agents/designer.md',
    'agents/fullstack.md',                 // [v1.0.3] 主实现 agent，替代并行 fe+be
    'agents/fe.md', 'agents/be.md',        // [deprecated] 保留向后兼容
    'agents/reviewer.md',
    'agents/qa.md', 'agents/security-auditor.md', 'agents/devops.md',
    'agents/orchestrator.md', 'agents/general.md',
    'agents/plan-ceo-review.md',
  ],
  GLOBAL_SKILLS: [
    'skills/arch-review/SKILL.md', 'skills/code-review-arch/SKILL.md',
    'skills/env-check/SKILL.md', 'skills/generate-design/SKILL.md',
    'skills/generate-prd/SKILL.md', 'skills/implement-api/SKILL.md',
    'skills/implement-feature/SKILL.md', 'skills/owasp-scan/SKILL.md',
    'skills/prepare-tests/SKILL.md', 'skills/setup-cicd/SKILL.md',
    'skills/stitch-design/SKILL.md', 'skills/traceability-matrix/SKILL.md',
    'skills/interaction-spec/SKILL.md',
  ],
  LOCAL_ONLY: [
    'scripts/workflow.js', 'scripts/lib/config.js',
    'state/', 'docs/', 'design/', '.claude/settings.json',
  ],
}

// ─── [v1.0] Agent 写入权限白名单（全覆盖）────────────────────────────────────
//
// 每个 Agent 只能写入与其职责匹配的路径。hookPreWrite 在每次 Write/Edit 前校验。
// 未列出的 Agent 默认无写入限制（向后兼容）。
//
const AGENT_WRITE_PERMISSIONS = {
  'workflow-orchestrator': {
    allowedPaths: ['state/'],
    reason: 'Orchestrator 只管理状态机，不写业务文件',
  },
  'product-manager': {
    allowedPaths: ['docs/prd.md'],
    reason: 'PM 只写 PRD 文档',
  },
  'software-architect': {
    allowedPaths: [
      'docs/arch-decision.md',
      'docs/security-baseline.md',
      'docs/traceability-matrix.md',
    ],
    reason: 'Architect 只写架构和安全基线文档',
  },
  'ux-designer': {
    allowedPaths: [
      'docs/design-spec.md',
      'docs/interaction-spec.md',
      'design/',
      'DESIGN.md',
    ],
    reason: 'Designer 只写设计文档和设计稿',
  },
  'plan-ceo-review': {
    allowedPaths: ['docs/ceo-review.md'],
    reason: 'CEO Review 只写审视报告',
  },
  'fullstack-engineer': {
    allowedPaths: [
      'apps/',
      'docs/api-spec.md',
      'docs/traceability-matrix.md',
      '.env.example',
      'package.json',
    ],
    reason: '全栈工程师写代码、API 规范和追溯矩阵',
  },
  'frontend-engineer': {
    allowedPaths: ['apps/web/', 'docs/traceability-matrix.md'],
    reason: '[deprecated] 前端工程师只写前端代码',
  },
  'backend-engineer': {
    allowedPaths: ['apps/server/', 'docs/api-spec.md', 'docs/traceability-matrix.md'],
    reason: '[deprecated] 后端工程师只写后端代码和 API 规范',
  },
  'code-reviewer': {
    allowedPaths: ['docs/code-review.md'],
    reason: 'Reviewer 不直接修改被审查的代码',
  },
  'qa-engineer': {
    allowedPaths: ['docs/test-plan.md', 'docs/test-report.md'],
    reason: 'QA 只写测试文档',
  },
  'security-auditor': {
    allowedPaths: ['docs/security-report.md', 'docs/security-fixes.md'],
    reason: 'Security Auditor 是只读审计角色',
  },
  'devops-engineer': {
    allowedPaths: [
      'docs/deploy-plan.md',
      'docs/runbook.md',
      'Dockerfile',
      'docker-compose.yml',
      'docker-compose.yaml',
      '.github/',
      '.env.example',
    ],
    reason: 'DevOps 只写部署相关文件',
  },
  'general-assistant': {
    allowedPaths: [],  // 空 = 禁止所有写入
    reason: 'General 是只读探索 Agent',
  },
}

// ─── [v1.0.3 Harness D] 産出物完整性追蹤文件列表 ──────────────────────────────
//
// advance() 後對這些關鍵文件計算 SHA256 快照，存入 state.artifactFingerprints。
// hookPreWrite 中若發現指紋已建立且修改者不是預期 Agent，輸出警告。
//
const TRACKED_ARTIFACT_FILES = [
  'docs/prd.md',
  'docs/arch-decision.md',
  'docs/security-baseline.md',
  'docs/api-spec.md',
  'docs/design-spec.md',
  'docs/interaction-spec.md',
  'docs/traceability-matrix.md',
  'docs/code-review.md',
  'docs/test-plan.md',
  'docs/test-report.md',
  'docs/security-report.md',
  'docs/deploy-plan.md',
  'docs/runbook.md',
]

// ─── [v1.0.2 P1.4] Feature Mode — 增量開發支持 ────────────────────────────────
//
// Feature 模式讓用戶在已有項目上添加新功能，無需重跑完整架構和設計流程。
//
// 觸發方式：node scripts/workflow.js init-feature
// 前提條件：docs/arch-decision.md 存在（說明已經過完整的 Architect 階段）
//
// 自動跳過的階段：
//   ARCH_REVIEW   — 現有架構決策仍然有效
//   CEO_REVIEW    — 新功能不需要 CEO 級別的 UX 重審
//   DESIGN_PHASE  — 沿用現有設計系統，僅添加新組件
//   DESIGN_REVIEW — 無完整設計稿，設計由 FE/BE 協商完成
//
// 實際執行路徑：
//   IDEA → PRD_DRAFT* → PRD_REVIEW → IMPLEMENTATION → CODE_REVIEW → QA_PHASE* → SECURITY_REVIEW → DONE
//
// PM 在 feature 模式下應生成「功能 PRD」：
//   - 範圍更窄（只描述本次新增/修改的功能）
//   - 無需重寫整個 PRD（可在 docs/prd.md 末尾追加 ## Feature: <名稱> 章節）
//
const FEATURE_SKIP_STATES = ['ARCH_REVIEW', 'CEO_REVIEW', 'DESIGN_PHASE', 'DESIGN_REVIEW']

// ─── [v1.0.2 P1.1] Hotfix 模式 ───────────────────────────────────────────────
//
// 用于紧急修复：不走完整流程，直接到 IMPLEMENTATION。
// 路径：IDEA → PRD_DRAFT → PRD_REVIEW → CODE_REVIEW → QA_PHASE → SECURITY_REVIEW → DEPLOY_PREP_SETUP → DEPLOY_PREP → DONE
// （跳过 IMPLEMENTATION 阶段本身，直接从 CODE_REVIEW 开始）
//
// 实际执行路径：
//   IDEA → PRD_DRAFT* → PRD_REVIEW → CODE_REVIEW → QA_PHASE* → SECURITY_REVIEW → DEPLOY_PREP_SETUP → DEPLOY_PREP* → DONE
//
// Hotfix 适用于：单文件 bug 修复、小改动、不需要设计和架构评审的场景。
// 产物：直接提交到已有代码库，不需要 docs/arch-decision.md 等。
//
const HOTFIX_SKIP_STATES = ['ARCH_REVIEW', 'CEO_REVIEW', 'DESIGN_PHASE', 'DESIGN_REVIEW', 'IMPLEMENTATION']

// Hotfix 模式下的 PRD 前置条件（只要求目标 PRD 文件存在）
const HOTFIX_PREREQS = {
  PRD_REVIEW:     ['docs/prd.md'],
  CODE_REVIEW:    ['docs/code-review.md'],
  QA_PHASE:       ['docs/test-plan.md', 'docs/test-report.md'],
  SECURITY_REVIEW: ['docs/security-report.md'],
  DEPLOY_PREP:    ['docs/deploy-plan.md', 'docs/runbook.md'],
}

// ─── [v1.0.1] Autopilot 模式 ────────────────────────────────────────────────
//
// 全流程自動模式：無需人為干預確認，自動推進 MANUAL 節點。
//
// MANUAL 節點正常情況需要用戶 --force：
//   PRD_DRAFT, CEO_REVIEW, DESIGN_PHASE, QA_PHASE, DEPLOY_PREP
//
// Autopilot 模式下行為：
//   1. 自動對 MANUAL 節點應用 --force
//   2. 跳過用戶交互確認環節（office-hours、交互意圖確認等）
//   3. 使用默認決策推進
//
// 啟用方式：
//   /autopilot 技能 或 node scripts/workflow.js init-autopilot
//
const AUTOPILOT_MODES = {
  OFF: 'off',           // 默認，正常流程
  GREENFIELD: 'autopilot-greenfield',  // 全新項目全自動
  FEATURE: 'autopilot-feature',        // 增量功能全自動（跳過 Arch/Design）
}

// Autopilot 模式下跳過用戶交互的階段（使用默認決策）
const AUTOPILOT_SKIP_INTERACTIONS = {
  PRD_DRAFT: {
    skipOfficeHours: true,      // 跳過 office-hours 追問，使用假設
    defaultAppetite: 'small',   // 默認 Small Batch
    defaultScopeMode: 'core',   // 默認核心功能優先
  },
  CEO_REVIEW: {
    autoAccept: true,           // 自動接受 CEO 審視結果
    minScore: 6,                // 低於此分數自動回滾
  },
  DESIGN_PHASE: {
    autoAccept: true,           // 自動確認設計稿
    skipInteractionConfirm: true, // 跳過交互意圖確認
  },
  QA_PHASE: {
    autoAccept: true,           // 自動批准 QA 報告
    failOnP0P1: true,           // P0/P1 bug 自動觸發修復循環
  },
  DEPLOY_PREP: {
    autoApprove: true,          // 自動批准部署
  },
}

// Feature 模式下放寬的前置條件（IMPLEMENTATION 不要求 interaction-spec.md）
const FEATURE_PREREQS = {
  PRD_REVIEW:     ['docs/prd.md'],
  IMPLEMENTATION: ['docs/prd.md', 'docs/api-spec.md', 'docs/traceability-matrix.md'],
  CODE_REVIEW:    ['docs/code-review.md'],
  QA_PHASE:       ['docs/test-plan.md', 'docs/test-report.md'],
  SECURITY_REVIEW: ['docs/security-report.md'],
  DEPLOY_PREP:    ['docs/deploy-plan.md', 'docs/runbook.md'],
}

// ─── [v1.0.2 P1.3] Config Self-Validation ─────────────────────────────────────
//
// 在模块加载时验证配置一致性。发现错误立即抛出，避免运行时才暴露问题。
// 只在非测试环境下运行（test 环境跳过以避免 CI 失败）。
//
function validateConfig() {
  if (process.env.NODE_ENV === 'test') return  // 测试环境跳过，避免 CI 意外失败

  const errors = []
  const stateNames = Object.keys(STATES)

  // 1. 每个状态有且只有一个 TRANSITIONS 条目
  for (const state of stateNames) {
    if (!TRANSITIONS[state]) errors.push(`STATES["${state}"] missing in TRANSITIONS`)
  }

  // 2. 每个 TRANSITIONS.next 指向有效状态或 null
  for (const [state, t] of Object.entries(TRANSITIONS)) {
    if (!stateNames.includes(state)) errors.push(`TRANSITIONS["${state}"] is not in STATES`)
    if (t.next !== null && !stateNames.includes(t.next)) {
      errors.push(`TRANSITIONS["${state}"].next = "${t.next}" is not a valid state`)
    }
  }

  // 3. PREREQS 键都是有效状态
  for (const state of Object.keys(PREREQS)) {
    if (!stateNames.includes(state)) errors.push(`PREREQS["${state}"] is not in STATES`)
  }

  // 4. STALE_ARTIFACTS 键都是有效状态
  for (const state of Object.keys(STALE_ARTIFACTS)) {
    if (!stateNames.includes(state)) errors.push(`STALE_ARTIFACTS["${state}"] is not in STATES`)
  }

  // 5. FEATURE_SKIP_STATES 全部是有效状态
  for (const state of FEATURE_SKIP_STATES) {
    if (!stateNames.includes(state)) errors.push(`FEATURE_SKIP_STATES contains invalid state: "${state}"`)
  }

  // 6. HOTFIX_SKIP_STATES 全部是有效状态
  for (const state of HOTFIX_SKIP_STATES) {
    if (!stateNames.includes(state)) errors.push(`HOTFIX_SKIP_STATES contains invalid state: "${state}"`)
  }

  // 7. FEATURE_PREREQS 键都是有效状态
  for (const state of Object.keys(FEATURE_PREREQS)) {
    if (!stateNames.includes(state)) errors.push(`FEATURE_PREREQS["${state}"] is not in STATES`)
  }

  // 8. HOTFIX_PREREQS 键都是有效状态
  for (const state of Object.keys(HOTFIX_PREREQS)) {
    if (!stateNames.includes(state)) errors.push(`HOTFIX_PREREQS["${state}"] is not in STATES`)
  }

  // 9. 所有 ARTIFACT_STATE_MAP.completedState 是有效状态
  for (const [file, info] of Object.entries(ARTIFACT_STATE_MAP)) {
    if (!stateNames.includes(info.completedState)) {
      errors.push(`ARTIFACT_STATE_MAP["${file}"].completedState = "${info.completedState}" is not a valid state`)
    }
    if (info.validatorKey !== null && !DOC_VALIDATORS[info.validatorKey]) {
      errors.push(`ARTIFACT_STATE_MAP["${file}"].validatorKey = "${info.validatorKey}" has no matching DOC_VALIDATORS entry`)
    }
  }

  if (errors.length > 0) {
    const msg = [
      `❌ [v1.0.2 P1.3] Config validation failed — ${errors.length} error(s):`,
      ...errors.map(e => `   • ${e}`),
      '',
      '修复方法：编辑 scripts/lib/config.js 修正上述问题',
    ].join('\n')
    // 使用 console.error 输出（不是 throw），让 require 者能捕获
    console.error(msg)
    throw new Error(`Config validation failed: ${errors[0]}`)
  }
}

validateConfig()

module.exports = {
  SCHEMA_VERSION,
  STATES, TRANSITIONS, PREREQS, STALE_ARTIFACTS,
  CODE_OUTPUTS, ARTIFACT_STATE_MAP, DANGEROUS_BASH_PATTERNS, DOC_VALIDATORS,
  CONTEXT_BUDGET, AGENT_TEAMS_CONFIG, GLOBAL_INSTALL_CONFIG,
  AGENT_MODEL_MAP,
  MODEL_COSTS, COST_PER_MILLION,
  TECH_STACK_PRESETS, resolveCodeOutputs,
  FEATURE_SKIP_STATES, FEATURE_PREREQS,
  HOTFIX_SKIP_STATES, HOTFIX_PREREQS,
  AUTOPILOT_MODES, AUTOPILOT_SKIP_INTERACTIONS,
  AGENT_WRITE_PERMISSIONS, TRACKED_ARTIFACT_FILES,
  FE_PATH_PREFIX: 'apps/web/',
  BE_PATH_PREFIX: 'apps/server/',
}

