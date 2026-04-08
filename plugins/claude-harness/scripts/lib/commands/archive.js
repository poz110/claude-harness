'use strict'
/**
 * commands/archive.js — v1.1
 *
 * 任务归档浏览、恢复、对比命令
 */

const fs   = require('fs')
const path = require('path')

const {
  listTasks, getTaskDetail, getTaskArtifact, listTaskFiles,
  restoreFromTask, diffTaskArtifacts, ARCHIVE_DIR,
} = require('../archive.js')

const { ROOT } = require('../state.js')

// ─── task-list ───────────────────────────────────────────────────────────────

function cmdTaskList(args) {
  const opts = {}
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--mode' && args[i + 1]) { opts.mode = args[++i] }
    if (args[i] === '--limit' && args[i + 1]) { opts.limit = parseInt(args[++i], 10) }
  }
  if (!opts.limit) opts.limit = 20

  const tasks = listTasks(opts)
  if (tasks.length === 0) {
    console.log('\n  (no archived tasks yet)\n')
    return
  }

  console.log(`\n  ID${' '.repeat(32)}Mode${' '.repeat(8)}Final${' '.repeat(11)}Cost${' '.repeat(6)}Date`)
  console.log(`  ${'─'.repeat(78)}`)

  for (const t of tasks) {
    const id    = (t.taskId || '?').padEnd(35)
    const mode  = (t.mode || '?').padEnd(12)
    const final = (t.finalState || '?').padEnd(16)
    const cost  = t.estimatedCost > 0 ? `$${t.estimatedCost.toFixed(2)}`.padEnd(10) : '-'.padEnd(10)
    const date  = t.startedAt ? t.startedAt.slice(0, 10) : '-'
    console.log(`  ${id}${mode}${final}${cost}${date}`)
  }

  console.log(`\n  共 ${tasks.length} 个归档任务`)
  console.log(`  详情: node scripts/workflow.js task-show <taskId>\n`)
}

// ─── task-show ───────────────────────────────────────────────────────────────

function cmdTaskShow(args) {
  const taskId = args[0]
  if (!taskId) { console.error('Usage: task-show <taskId>'); process.exit(1) }

  const meta = getTaskDetail(taskId)
  if (!meta) { console.error(`归档不存在: ${taskId}`); process.exit(1) }

  const duration = meta.startedAt && meta.endedAt
    ? formatDuration(new Date(meta.endedAt) - new Date(meta.startedAt))
    : '-'
  const tokensK = meta.totalTokens ? `${(meta.totalTokens / 1000).toFixed(0)}K` : '-'

  console.log(`\n  Task    : ${meta.taskId}`)
  console.log(`  Mode    : ${meta.mode}`)
  console.log(`  Started : ${meta.startedAt || '-'}`)
  console.log(`  Ended   : ${meta.endedAt || '-'} (${duration})`)
  console.log(`  Final   : ${meta.finalState}`)
  console.log(`  Cost    : ~$${(meta.estimatedCost || 0).toFixed(4)} (${tokensK} tokens)`)
  if (meta.gitRef) {
    console.log(`  Git     : ${meta.gitRef}${meta.gitTag ? ` (tag: ${meta.gitTag})` : ''}`)
  }

  if (meta.statesVisited?.length > 0) {
    console.log(`\n  States  : ${meta.statesVisited.join(' -> ')}`)
  }

  if (meta.docsArchived?.length > 0) {
    console.log(`\n  Archived Files:`)
    const taskDir = path.join(ARCHIVE_DIR, taskId)
    for (const f of meta.docsArchived) {
      const fullPath = path.join(taskDir, f)
      const size = fs.existsSync(fullPath) ? `${(fs.statSync(fullPath).size / 1024).toFixed(1)} KB` : '-'
      console.log(`    ${f.padEnd(40)} (${size})`)
    }
  }

  console.log(`\n  Restore : node scripts/workflow.js task-restore ${taskId}`)
  console.log(`  Cat     : node scripts/workflow.js task-cat ${taskId} docs/prd.md\n`)
}

// ─── task-cat ────────────────────────────────────────────────────────────────

function cmdTaskCat(args) {
  const taskId  = args[0]
  const file    = args[1]
  if (!taskId || !file) { console.error('Usage: task-cat <taskId> <file>'); process.exit(1) }

  const content = getTaskArtifact(taskId, file)
  if (content === null) {
    console.error(`文件不存在: ${taskId}/${file}`)
    process.exit(1)
  }

  process.stdout.write(content)
}

// ─── task-diff ───────────────────────────────────────────────────────────────

function cmdTaskDiff(args) {
  const id1  = args[0]
  const id2  = args[1]
  const file = args[2] || 'docs/prd.md'
  if (!id1 || !id2) { console.error('Usage: task-diff <taskId1> <taskId2> [file]'); process.exit(1) }

  const result = diffTaskArtifacts(id1, id2, file)
  if (!result.ok) { console.error(result.error); process.exit(1) }

  console.log(`\n  diff ${id1}/${file} vs ${id2}/${file}\n`)

  let changes = 0
  for (const d of result.diff) {
    if (d.type === '-') {
      console.log(`  \x1b[31m- ${d.line}\x1b[0m`)
      changes++
    } else if (d.type === '+') {
      console.log(`  \x1b[32m+ ${d.line}\x1b[0m`)
      changes++
    }
    // Skip unchanged lines for brevity (only show diff)
  }

  if (changes === 0) {
    console.log('  (no differences)')
  }
  console.log()
}

// ─── task-restore ────────────────────────────────────────────────────────────

function cmdTaskRestore(args) {
  const taskId = args[0]
  if (!taskId) { console.error('Usage: task-restore <taskId> [--docs-only] [--file <path>] [--force]'); process.exit(1) }

  const opts = {}
  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--docs-only') opts.docsOnly = true
    if (args[i] === '--file' && args[i + 1]) opts.file = args[++i]
    if (args[i] === '--force') opts.force = true
  }

  if (!opts.force) {
    console.log(`\n  将从归档 ${taskId} 恢复文件到工作目录（会覆盖当前文件）`)
    console.log(`  添加 --force 确认执行\n`)
    return
  }

  const result = restoreFromTask(taskId, opts)
  if (!result.ok) { console.error(result.error); process.exit(1) }

  console.log(`\n  已恢复 ${result.restored.length} 个文件:`)
  result.restored.forEach(f => console.log(`    ${f}`))
  console.log()
}

// ─── task-cost ───────────────────────────────────────────────────────────────

function cmdTaskCost(args) {
  const tasks = listTasks({})
  if (tasks.length === 0) {
    console.log('\n  (no archived tasks)\n')
    return
  }

  let grandTotal = 0, grandTokens = 0
  console.log(`\n  ${'Task'.padEnd(35)} ${'Cost'.padEnd(12)} ${'Tokens'}`)
  console.log(`  ${'─'.repeat(60)}`)

  for (const t of tasks) {
    const cost = t.estimatedCost || 0
    const tokens = t.totalTokens || 0
    grandTotal += cost
    grandTokens += tokens
    const tokensK = tokens > 0 ? `${(tokens / 1000).toFixed(0)}K` : '-'
    console.log(`  ${(t.taskId || '?').padEnd(35)} $${cost.toFixed(4).padEnd(11)} ${tokensK}`)
  }

  console.log(`  ${'─'.repeat(60)}`)
  const grandTokensK = grandTokens > 0 ? `${(grandTokens / 1000).toFixed(0)}K` : '-'
  console.log(`  ${'TOTAL'.padEnd(35)} $${grandTotal.toFixed(4).padEnd(11)} ${grandTokensK}`)
  console.log()
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDuration(ms) {
  if (ms < 60000) return `${(ms / 1000).toFixed(0)}s`
  if (ms < 3600000) return `${(ms / 60000).toFixed(1)}m`
  return `${(ms / 3600000).toFixed(1)}h`
}

// ─── Exports ─────────────────────────────────────────────────────────────────

module.exports = {
  cmdTaskList,
  cmdTaskShow,
  cmdTaskCat,
  cmdTaskDiff,
  cmdTaskRestore,
  cmdTaskCost,
}
