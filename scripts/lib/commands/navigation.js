'use strict'
/**
 * commands/navigation.js
 *
 * 状态机导航命令：advance, rollback, reset, status, states, history
 */

const {
  STATES, TRANSITIONS,
  SCHEMA_VERSION,
  FEATURE_SKIP_STATES,
  HOTFIX_SKIP_STATES,
  AGENT_MODEL_MAP,
  COST_PER_MILLION,
  MODEL_COSTS,
} = require('../config.js')

const {
  loadState, saveState,
  checkContextBudget,
  appendTrace, snapshotArtifacts,
  estimateTokens,
  ROOT,
} = require('../state.js')

const {
  checkPrereqs,
} = require('../verify.js')

// displayStatus is defined in workflow.js - we import via closure
// but for simplicity, commands that need it receive it as an argument

/**
 * Execute the status command
 */
function cmdStatus(state) {
  const current    = state.currentState
  const stateInfo  = STATES[current]
  const transition = TRANSITIONS[current]
  const stateKeys  = Object.keys(STATES)
  const step       = stateKeys.indexOf(current) + 1

  console.log(`\n${'─'.repeat(64)}`)
  console.log(`  Workflow v${SCHEMA_VERSION}   Step ${step}/${stateKeys.length}  [schema: ${state.schemaVersion || '?'}]`)
  console.log(`${'─'.repeat(64)}`)
  if (state.autopilot) {
    console.log(`  🤖 AUTOPILOT MODE — 全流程自動（MANUAL 節點自動推進）`)
  }
  if (state.mode === 'feature') {
    console.log(`  Mode    : ✨ FEATURE MODE — 自動跳過 ${FEATURE_SKIP_STATES.join('/')}`)
  }
  if (state.mode === 'hotfix') {
    console.log(`  Mode    : 🔧 HOTFIX MODE — 自動跳過 ${HOTFIX_SKIP_STATES.join('/')}`)
  }
  console.log(`  State   : ${current}`)
  console.log(`  Desc    : ${stateInfo?.desc}`)
  if (stateInfo?.manual) {
    if (state.autopilot) {
      console.log(`  Type    : ⏸  MANUAL → 🤖 自動推進 (autopilot)`)
    } else {
      console.log(`  Type    : ⏸  MANUAL (user action required)`)
    }
  } else {
    console.log(`  Type    : 🔄 AUTO`)
  }
  if (transition?.next) {
    const displayNext = state.mode === 'feature' && FEATURE_SKIP_STATES.includes(transition.next)
      ? `${transition.next} ⏭  → [auto-skip] → IMPLEMENTATION`
      : transition.next
    console.log(`  Next    : ${displayNext} (via ${transition.agent})`)
  }

  if (current === 'DESIGN_REVIEW') {
    console.log(`  Agent   : fullstack-engineer（API-first → BE → FE，同一 context 写全栈）`)
    console.log(`  Complete: node scripts/workflow.js advance`)
  }

  if (state.contextBudget) {
    const budget = state.contextBudget
    const { CONTEXT_BUDGET } = require('../config.js')
    const ratio = estimateTokens(budget) / 180000  // approximate
    const icon  = ratio >= CONTEXT_BUDGET.REREAD_THRESHOLD ? '🔴' : ratio >= CONTEXT_BUDGET.WARN_THRESHOLD ? '🟡' : '🟢'
    console.log(`  Context : ${icon} ${budget.agentName} ~${Math.round(ratio * 100)}% (bash:${budget.bashCount || 0} write:${budget.writeCount || 0} read:${budget.readCount || 0})`)
  }

  if (state.qaFailureCount > 0) console.log(`  QA Fails: ${state.qaFailureCount} (≥2 → ARCH_REVIEW escalation)`)
  if (state.securityReauditNeeded) console.log(`  ⚠️  Security re-audit needed`)

  if (state.techStack) {
    console.log(`  Stack   : FE=${state.techStack.fe}  BE=${state.techStack.be}  (change: init-project with new stack)`)
  }

  const inOrPastDesign = ['DESIGN_PHASE','DESIGN_REVIEW','IMPLEMENTATION','CODE_REVIEW',
    'QA_PHASE','SECURITY_REVIEW','DEPLOY_PREP_SETUP','DEPLOY_PREP','DONE'].includes(current)
  if (inOrPastDesign) {
    const iSpec  = state.interactionSpecReady ? '✅' : '⬜'
    const dBase  = state.designBaselineReady  ? '✅' : '⬜'
    const sBase  = state.stateBaselineReady   ? '✅' : '⬜ (run Designer /state-baseline)'
    console.log(`  Spec    : ${iSpec} interaction-spec  ${dBase} page-baseline  ${sBase} state-baseline`)
  }

  const last = state.history?.slice(-3) || []
  if (last.length > 0) {
    console.log(`\n  Recent history:`)
    last.forEach(h => console.log(`    ${h.from?.padEnd(22)} → ${h.to?.padEnd(22)} [${h.agent}] ${h.timestamp?.slice(0,10)}`))
  }

  console.log(`${'─'.repeat(64)}`)
}

/**
 * Execute the states command
 */
function cmdStates() {
  console.log('\nAll states:\n')
  Object.entries(STATES).forEach(([k, v]) => {
    const t = TRANSITIONS[k]
    console.log(`  ${v.manual ? '⏸ ' : '🔄'} ${k.padEnd(22)} → ${t?.next?.padEnd(22) || 'END'.padEnd(22)} [${t?.agent}]`)
  })
  console.log()
}

/**
 * Execute the history command
 */
function cmdHistory(state) {
  const hist = state.history || []
  console.log(`\nWorkflow history (${hist.length} entries):\n`)
  hist.forEach((h, i) => {
    const icon = h.type === 'rollback' ? '⏪' : h.type === 'security-reaudit' ? '🔒' : h.type === 'manual' ? '⏸' : '→'
    console.log(`  ${String(i+1).padStart(3)}. ${h.from?.padEnd(22)} ${icon} ${h.to?.padEnd(22)} [${h.agent}] ${h.timestamp?.slice(0,10)}`)
    if (h.cleanedArtifacts?.length > 0) console.log(`        🗑  cleaned: ${h.cleanedArtifacts.join(', ')}`)
  })
  console.log()
}

/**
 * Execute the reset command
 */
function cmdReset() {
  const fresh = {
    schemaVersion: SCHEMA_VERSION, currentState: 'IDEA',
    rollbackStack: [], history: [],
    parallelProgress: { FE: false, BE: false },
    qaFailureCount: 0, securityReauditNeeded: false, context: {},
    traceabilityReady: false, designBaselineReady: false,
    interactionSpecReady: false, stateBaselineReady: false,
    contextBudget: null,
    mode: 'greenfield',
    autopilot: false,
    createdAt: new Date().toISOString(),
  }
  saveState(fresh)
  console.log('♻️  Reset to IDEA (greenfield mode)')
}

module.exports = {
  cmdStatus,
  cmdStates,
  cmdHistory,
  cmdReset,
}
