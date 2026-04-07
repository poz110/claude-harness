'use strict'
/**
 * commands/trace.js
 *
 * Trace 分析命令：trace-summary, trace-timing, trace-cost
 */

const fs = require('fs')
const path = require('path')

const { TRACE_LOG } = require('../state.js')

/**
 * Execute trace-summary command
 */
function cmdTraceSummary() {
  if (!fs.existsSync(TRACE_LOG)) {
    console.log('\n📊 trace.jsonl 為空，運行 advance/rollback 等操作後再查看\n')
    return
  }
  const rawLines = fs.readFileSync(TRACE_LOG, 'utf8').trim().split('\n').filter(Boolean)
  const events = rawLines
    .map(l => { try { return JSON.parse(l) } catch { return null } })
    .filter(Boolean)

  console.log(`\n📊 Workflow Trace 摘要（共 ${events.length} 個事件）\n`)

  // 事件類型分佈
  const byType = {}
  for (const e of events) byType[e.eventType] = (byType[e.eventType] || 0) + 1
  console.log('事件類型分佈：')
  Object.entries(byType)
    .sort((a, b) => b[1] - a[1])
    .forEach(([type, count]) => {
      const icon = { advance: '→', rollback: '⏪', prereq_block: '🚫',
        tool_permission_block: '🔒', artifact_fingerprint_warn: '⚠️',
        agent_result: '📋', init_feature: '✨' }[type] || '•'
      console.log(`  ${icon} ${type.padEnd(30)} ${count}`)
    })

  // 前置阻斷統計
  const blocks = events.filter(e => e.eventType === 'prereq_block')
  if (blocks.length > 0) {
    console.log(`\n🚫 前置條件阻斷記錄（${blocks.length} 次）：`)
    blocks.slice(-5).forEach(e => {
      const ts = new Date(e.iso).toLocaleString()
      console.log(`  ${ts}  ${e.payload?.from} → ${e.payload?.to}`)
      if (e.payload?.missing?.length > 0) {
        console.log(`    缺失：${e.payload.missing.join(', ')}`)
      }
    })
  }

  // 權限阻斷統計
  const permBlocks = events.filter(e => e.eventType === 'tool_permission_block')
  if (permBlocks.length > 0) {
    console.log(`\n🔒 工具權限阻斷記錄（${permBlocks.length} 次）：`)
    permBlocks.slice(-5).forEach(e => {
      const ts = new Date(e.iso).toLocaleString()
      console.log(`  ${ts}  ${e.payload?.agentName} 嘗試寫 ${e.payload?.relPath}`)
    })
  }

  // 最近 10 個事件
  console.log('\n最近 10 個事件：')
  events.slice(-10).forEach(e => {
    const ts = new Date(e.iso).toLocaleTimeString()
    const agent = e.agentName !== 'unknown' ? ` [${e.agentName}]` : ''
    console.log(`  ${ts}  ${e.eventType.padEnd(28)} ${e.workflowState}${agent}`)
  })
  console.log()
}

/**
 * Execute trace-timing command
 */
function cmdTraceTiming() {
  if (!fs.existsSync(TRACE_LOG)) {
    console.log('\n⏱  trace.jsonl 為空，運行 advance 後再查看耗時\n')
    return
  }
  const rawLines = fs.readFileSync(TRACE_LOG, 'utf8').trim().split('\n').filter(Boolean)
  const events = rawLines
    .map(l => { try { return JSON.parse(l) } catch { return null } })
    .filter(Boolean)
    .filter(e => e.eventType === 'advance' && e.durationMs)

  if (events.length === 0) {
    console.log('\n⏱  無 advance 耗時數據（需升級到 v15.2）\n')
    return
  }

  const totalMs = events.reduce((s, e) => s + e.durationMs, 0)
  console.log(`\n⏱  Phase Timing Summary（共 ${events.length} 個階段）\n`)
  console.log(`  ${'State'.padEnd(24)} ${'Duration'.padEnd(10)} ${'Cumulative'}`)
  console.log(`  ${'─'.repeat(48)}`)
  let cumulative = 0
  for (const e of events) {
    cumulative += e.durationMs
    const dur = e.durationMs >= 60000
      ? `${(e.durationMs / 60000).toFixed(1)}m`
      : `${(e.durationMs / 1000).toFixed(0)}s`
    const cum = cumulative >= 60000
      ? `${(cumulative / 60000).toFixed(1)}m`
      : `${(cumulative / 1000).toFixed(0)}s`
    console.log(`  ${e.payload?.from?.padEnd(24)} ${dur.padEnd(10)} ${cum}`)
  }
  console.log(`  ${'─'.repeat(48)}`)
  const total = totalMs >= 60000
    ? `${(totalMs / 60000).toFixed(1)}m`
    : `${(totalMs / 1000).toFixed(0)}s`
  console.log(`  ${'TOTAL'.padEnd(24)} ${total}`)
  console.log()
}

/**
 * Execute trace-cost command
 */
function cmdTraceCost() {
  if (!fs.existsSync(TRACE_LOG)) {
    console.log('\n💰 trace.jsonl 為空，運行 advance 後再查看成本\n')
    return
  }
  const rawLines = fs.readFileSync(TRACE_LOG, 'utf8').trim().split('\n').filter(Boolean)
  const events = rawLines
    .map(l => { try { return JSON.parse(l) } catch { return null } })
    .filter(Boolean)
    .filter(e => e.eventType === 'advance' && e.costEstimate)

  if (events.length === 0) {
    console.log('\n💰 無成本估算數據（需升級到 v15.2）\n')
    return
  }

  const totalTokens = events.reduce((s, e) => s + (e.costEstimate?.tokens || 0), 0)
  const totalCost  = events.reduce((s, e) => s + (e.costEstimate?.estimatedCost || 0), 0)

  console.log(`\n💰 Per-Phase Cost Summary（共 ${events.length} 個階段）\n`)
  console.log(`  ${'State'.padEnd(24)} ${'Agent'.padEnd(24)} ${'Tokens (k)'.padEnd(12)} ${'Cost'}`)
  console.log(`  ${'─'.repeat(70)}`)
  for (const e of events) {
    const c = e.costEstimate
    if (!c) continue
    const tokensK = (c.tokens / 1000).toFixed(1)
    const cost    = `$${c.estimatedCost.toFixed(4)}`
    console.log(`  ${e.payload?.from?.padEnd(24)} ${(c.agentName || 'unknown').padEnd(24)} ${tokensK.padEnd(12)} ${cost}`)
  }
  console.log(`  ${'─'.repeat(70)}`)
  console.log(`  ${'TOTAL'.padEnd(24)} ${''.padEnd(24)} ${(totalTokens / 1000).toFixed(1)}k tokens   $${totalCost.toFixed(4)}`)
  console.log('\n  ⚠️  為估算值（基於操作字節數推算），實際成本以 Claude API 帳單為準')
  console.log()
}

module.exports = {
  cmdTraceSummary,
  cmdTraceTiming,
  cmdTraceCost,
}
