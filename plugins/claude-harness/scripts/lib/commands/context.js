'use strict'
/**
 * commands/context.js
 *
 * Context 生命周期命令：track-context, reset-context, context-status, set-context, get-context
 */

const {
  trackContext, resetContextBudget,
} = require('../state.js')

const { CONTEXT_BUDGET } = require('../config.js')

/**
 * Execute track-context command
 */
function cmdTrackContext(args) {
  const agentName = args[0]
  const opType    = args[1] // 'bash' | 'write'
  if (!agentName || !opType) { console.error('Usage: track-context <agent> <bash|write>'); process.exit(1) }
  const result = trackContext(agentName, opType)
  const icon   = result.critical ? '🔴' : result.warning ? '🟡' : '🟢'
  console.log(`${icon} Context[${agentName}]: ~${Math.round(result.usageRatio * 100)}% (bash:${result.bashCount} write:${result.writeCount} ~${result.estimatedTokens} tokens)`)
  if (result.critical) {
    console.log(`\n⚠️  超过强制重读阈值！重读核心文档：`)
    const docs = CONTEXT_BUDGET.CRITICAL_DOCS[agentName] || []
    docs.forEach((d, i) => console.log(`  ${i + 1}. Read ${d}`))
  }
}

/**
 * Execute reset-context command
 */
function cmdResetContext(args) {
  const agentName = args[0]
  if (!agentName) { console.error('Usage: reset-context <agent>'); process.exit(1) }
  resetContextBudget(agentName)
  console.log(`✅ Context budget reset for ${agentName}`)
}

/**
 * Execute context-status command
 */
function cmdContextStatus(state) {
  const budget = state.contextBudget
  if (!budget) { console.log('ℹ️  Context tracking not active (no agent running or already reset)'); return }
  const estimated = budget.bashCount * 1000 + budget.writeCount * 500
  const ratio = estimated / 180000
  const icon  = ratio >= CONTEXT_BUDGET.REREAD_THRESHOLD ? '🔴' : ratio >= CONTEXT_BUDGET.WARN_THRESHOLD ? '🟡' : '🟢'
  console.log(`\n${icon} Context Status: ${budget.agentName}`)
  console.log(`  Bash ops  : ${budget.bashCount}`)
  console.log(`  Write ops : ${budget.writeCount}`)
  console.log(`  Est. tokens: ~${estimated}`)
  console.log(`  Usage ratio: ~${Math.round(ratio * 100)}%`)
  console.log(`  Warn threshold   : ${Math.round(CONTEXT_BUDGET.WARN_THRESHOLD * 100)}%`)
  console.log(`  Reread threshold : ${Math.round(CONTEXT_BUDGET.REREAD_THRESHOLD * 100)}%`)
  if (ratio >= CONTEXT_BUDGET.REREAD_THRESHOLD) {
    console.log(`\n  Critical docs to reread:`)
    const docs = CONTEXT_BUDGET.CRITICAL_DOCS[budget.agentName] || []
    docs.forEach(d => console.log(`    - ${d}`))
  }
  console.log()
}

/**
 * Execute set-context command
 */
function cmdSetContext(args, state, saveState) {
  const [key, ...valueParts] = args
  state.context = state.context || {}
  state.context[key] = valueParts.join(' ')
  saveState(state)
  console.log(`✅ context.${key} = "${state.context[key]}"`)
}

/**
 * Execute get-context command
 */
function cmdGetContext(args, state) {
  const key = args[0]
  console.log(key ? (state.context?.[key] ?? '(not set)') : JSON.stringify(state.context || {}, null, 2))
}

module.exports = {
  cmdTrackContext,
  cmdResetContext,
  cmdContextStatus,
  cmdSetContext,
  cmdGetContext,
}
