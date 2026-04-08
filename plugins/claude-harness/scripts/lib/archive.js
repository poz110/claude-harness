'use strict'
/**
 * archive.js — v1.1 Multi-Task Artifact Versioning
 *
 * 为每次任务创建轻量级归档，保留文档快照和元数据。
 * 不复制 apps/ 代码（通过 git tag 引用）。
 *
 * 存储布局：
 *   state/archive/
 *     task-index.jsonl            全局索引
 *     {taskId}/
 *       meta.json                 任务元数据
 *       workflow-state.json       状态快照
 *       trace-segment.jsonl       Trace 切片
 *       docs/                     文档快照
 *       design/                   设计快照
 */

const fs   = require('fs')
const path = require('path')
const { execSync } = require('child_process')

const { ROOT, TRACE_LOG } = require('./state.js')
const { ARCHIVE_CONFIG }  = require('./config.js')

const ARCHIVE_DIR = path.join(ROOT, 'state', 'archive')
const TASK_INDEX  = path.join(ARCHIVE_DIR, 'task-index.jsonl')

// ─── Utilities ───────────────────────────────────────────────────────────────

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

function copyDirRecursive(src, dst) {
  if (!fs.existsSync(src)) return 0
  ensureDir(dst)
  let count = 0
  for (const item of fs.readdirSync(src)) {
    if (item === 'node_modules' || item === '.next' || item === 'dist') continue
    const srcPath = path.join(src, item)
    const dstPath = path.join(dst, item)
    if (fs.statSync(srcPath).isDirectory()) {
      count += copyDirRecursive(srcPath, dstPath)
    } else {
      fs.copyFileSync(srcPath, dstPath)
      count++
    }
  }
  return count
}

function hasAnyDocs() {
  const docsDir = path.join(ROOT, 'docs')
  if (!fs.existsSync(docsDir)) return false
  return fs.readdirSync(docsDir).some(f => f.endsWith('.md'))
}

// ─── Git Helpers ─────────────────────────────────────────────────────────────

function isGitRepo() {
  try {
    execSync('git rev-parse --git-dir', { stdio: 'ignore', cwd: ROOT })
    return true
  } catch { return false }
}

function getGitHead() {
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8', cwd: ROOT, stdio: ['pipe', 'pipe', 'ignore'] }).trim()
  } catch { return null }
}

function createGitTag(tagName) {
  try {
    execSync(`git tag "${tagName}"`, { stdio: 'ignore', cwd: ROOT })
    return true
  } catch { return false }
}

// ─── Task ID Generation ──────────────────────────────────────────────────────

function generateTaskId(mode, refDate) {
  const d = refDate ? new Date(refDate) : new Date()
  const dateStr = d.toISOString().slice(0, 10).replace(/-/g, '')

  ensureDir(ARCHIVE_DIR)
  const prefix = `${dateStr}-${mode}-`
  let maxSeq = 0

  if (fs.existsSync(ARCHIVE_DIR)) {
    for (const entry of fs.readdirSync(ARCHIVE_DIR)) {
      if (entry.startsWith(prefix)) {
        const seq = parseInt(entry.slice(prefix.length), 10)
        if (seq > maxSeq) maxSeq = seq
      }
    }
  }

  return `${prefix}${String(maxSeq + 1).padStart(3, '0')}`
}

// ─── Start Task ──────────────────────────────────────────────────────────────

function startTask(state) {
  state.taskId = generateTaskId(state.mode || 'greenfield')
  state.taskStartedAt = new Date().toISOString()
  return state
}

// ─── Archive Current Task ────────────────────────────────────────────────────

function archiveCurrentTask(state, opts = {}) {
  // Skip empty tasks (IDEA state + no docs)
  if (state.currentState === 'IDEA' && !hasAnyDocs()) {
    return { skipped: true, reason: 'empty task' }
  }

  try {
    // Generate taskId if missing (retroactive for pre-versioning states)
    const taskId = state.taskId || generateTaskId(
      state.mode || 'greenfield',
      state.createdAt || state.taskStartedAt
    )
    const taskDir = path.join(ARCHIVE_DIR, taskId)

    // Guard: don't re-archive same taskId
    if (fs.existsSync(taskDir)) {
      return { skipped: true, reason: 'already archived', taskId }
    }

    ensureDir(taskDir)

    // 1. Copy docs/ and design/ directories
    const docsArchived = []
    for (const dir of ARCHIVE_CONFIG.COPY_DIRS) {
      const srcDir = path.join(ROOT, dir)
      const dstDir = path.join(taskDir, dir)
      if (fs.existsSync(srcDir)) {
        const count = copyDirRecursive(srcDir, dstDir)
        if (count > 0) {
          // List archived files
          listFilesRecursive(dstDir, dir).forEach(f => docsArchived.push(f))
        }
      }
    }

    // 2. Copy individual files (DESIGN.md etc.)
    for (const file of ARCHIVE_CONFIG.COPY_FILES) {
      const srcFile = path.join(ROOT, file)
      if (fs.existsSync(srcFile)) {
        fs.copyFileSync(srcFile, path.join(taskDir, file))
        docsArchived.push(file)
      }
    }

    // 3. Copy workflow-state.json snapshot
    const stateFile = path.join(ROOT, 'state', 'workflow-state.json')
    if (fs.existsSync(stateFile)) {
      fs.copyFileSync(stateFile, path.join(taskDir, 'workflow-state.json'))
    }

    // 4. Extract trace segment
    const traceSegment = extractTraceSegment(
      state.taskStartedAt || state.createdAt,
      new Date().toISOString()
    )
    if (traceSegment.length > 0) {
      fs.writeFileSync(
        path.join(taskDir, 'trace-segment.jsonl'),
        traceSegment.map(e => JSON.stringify(e)).join('\n') + '\n'
      )
    }

    // 5. Calculate cost from trace
    let estimatedCost = 0, totalTokens = 0
    for (const e of traceSegment) {
      if (e.eventType === 'advance' && e.costEstimate) {
        estimatedCost += e.costEstimate.estimatedCost || 0
        totalTokens   += e.costEstimate.tokens || 0
      }
    }

    // 6. Git integration
    let gitRef = null, gitTag = null
    if (isGitRepo()) {
      gitRef = getGitHead()
      const tagName = `task/${taskId}`
      if (createGitTag(tagName)) gitTag = tagName
    }

    // 7. Collect visited states from history
    const statesVisited = []
    if (state.history) {
      for (const h of state.history) {
        if (h.from && !statesVisited.includes(h.from)) statesVisited.push(h.from)
        if (h.to && !statesVisited.includes(h.to)) statesVisited.push(h.to)
      }
    }
    if (!statesVisited.includes(state.currentState)) {
      statesVisited.push(state.currentState)
    }

    // 8. Write meta.json
    const meta = {
      v: 1,
      taskId,
      mode: state.mode || 'greenfield',
      startedAt: state.taskStartedAt || state.createdAt || null,
      endedAt: new Date().toISOString(),
      finalState: state.currentState,
      statesVisited,
      docsArchived,
      estimatedCost,
      totalTokens,
      gitRef,
      gitTag,
    }
    fs.writeFileSync(path.join(taskDir, 'meta.json'), JSON.stringify(meta, null, 2) + '\n')

    // 9. Append to task-index.jsonl (commit point)
    appendTaskIndex(meta)

    return { skipped: false, taskId, archivePath: taskDir }
  } catch (err) {
    console.error(`  ⚠️  归档失败（不影响后续操作）: ${err.message}`)
    return { skipped: true, reason: `error: ${err.message}` }
  }
}

// ─── Trace Segment Extraction ────────────────────────────────────────────────

function extractTraceSegment(startTime, endTime) {
  if (!fs.existsSync(TRACE_LOG)) return []
  const startTs = startTime ? new Date(startTime).getTime() : 0
  const endTs   = endTime ? new Date(endTime).getTime() : Date.now()

  const lines = fs.readFileSync(TRACE_LOG, 'utf8').trim().split('\n').filter(Boolean)
  const events = []
  for (const line of lines) {
    try {
      const e = JSON.parse(line)
      if (e.ts >= startTs && e.ts <= endTs) events.push(e)
    } catch {}
  }
  return events
}

// ─── Task Index ──────────────────────────────────────────────────────────────

function appendTaskIndex(meta) {
  ensureDir(ARCHIVE_DIR)
  const entry = {
    v: 1,
    taskId:        meta.taskId,
    mode:          meta.mode,
    startedAt:     meta.startedAt,
    endedAt:       meta.endedAt,
    finalState:    meta.finalState,
    docsCount:     meta.docsArchived.length,
    estimatedCost: meta.estimatedCost,
    totalTokens:   meta.totalTokens,
    gitRef:        meta.gitRef,
  }
  fs.appendFileSync(TASK_INDEX, JSON.stringify(entry) + '\n')
}

function listTasks(opts = {}) {
  if (!fs.existsSync(TASK_INDEX)) return []
  const lines = fs.readFileSync(TASK_INDEX, 'utf8').trim().split('\n').filter(Boolean)
  let tasks = lines.map(l => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)

  if (opts.mode) tasks = tasks.filter(t => t.mode === opts.mode)
  tasks.sort((a, b) => (b.startedAt || '').localeCompare(a.startedAt || ''))
  if (opts.limit) tasks = tasks.slice(0, opts.limit)

  return tasks
}

// ─── Task Detail ─────────────────────────────────────────────────────────────

function getTaskDetail(taskId) {
  const metaPath = path.join(ARCHIVE_DIR, taskId, 'meta.json')
  if (!fs.existsSync(metaPath)) return null
  return JSON.parse(fs.readFileSync(metaPath, 'utf8'))
}

function getTaskArtifact(taskId, filePath) {
  const fullPath = path.join(ARCHIVE_DIR, taskId, filePath)
  if (!fs.existsSync(fullPath)) return null
  return fs.readFileSync(fullPath, 'utf8')
}

function listTaskFiles(taskId) {
  const taskDir = path.join(ARCHIVE_DIR, taskId)
  if (!fs.existsSync(taskDir)) return []
  return listFilesRecursive(taskDir, '')
}

// ─── Restore ─────────────────────────────────────────────────────────────────

function restoreFromTask(taskId, opts = {}) {
  const taskDir = path.join(ARCHIVE_DIR, taskId)
  if (!fs.existsSync(taskDir)) return { ok: false, error: `归档不存在: ${taskId}` }

  const restored = []

  if (opts.file) {
    // Restore single file
    const srcPath = path.join(taskDir, opts.file)
    if (!fs.existsSync(srcPath)) return { ok: false, error: `文件不存在: ${opts.file}` }
    const dstPath = path.join(ROOT, opts.file)
    ensureDir(path.dirname(dstPath))
    fs.copyFileSync(srcPath, dstPath)
    restored.push(opts.file)
  } else {
    // Restore directories
    const dirs = opts.docsOnly ? ['docs'] : ARCHIVE_CONFIG.COPY_DIRS
    for (const dir of dirs) {
      const srcDir = path.join(taskDir, dir)
      if (fs.existsSync(srcDir)) {
        const count = copyDirRecursive(srcDir, path.join(ROOT, dir))
        listFilesRecursive(srcDir, dir).forEach(f => restored.push(f))
      }
    }
    // Restore individual files
    if (!opts.docsOnly) {
      for (const file of ARCHIVE_CONFIG.COPY_FILES) {
        const srcFile = path.join(taskDir, file)
        if (fs.existsSync(srcFile)) {
          fs.copyFileSync(srcFile, path.join(ROOT, file))
          restored.push(file)
        }
      }
    }
  }

  return { ok: true, restored }
}

// ─── Diff ────────────────────────────────────────────────────────────────────

function diffTaskArtifacts(taskId1, taskId2, filePath) {
  const content1 = getTaskArtifact(taskId1, filePath)
  const content2 = getTaskArtifact(taskId2, filePath)
  if (content1 === null) return { ok: false, error: `${taskId1} 中不存在 ${filePath}` }
  if (content2 === null) return { ok: false, error: `${taskId2} 中不存在 ${filePath}` }

  const lines1 = content1.split('\n')
  const lines2 = content2.split('\n')
  const diff = []
  const maxLen = Math.max(lines1.length, lines2.length)

  for (let i = 0; i < maxLen; i++) {
    const l1 = lines1[i]
    const l2 = lines2[i]
    if (l1 === l2) {
      diff.push({ type: ' ', line: l1 || '' })
    } else {
      if (l1 !== undefined) diff.push({ type: '-', line: l1 })
      if (l2 !== undefined) diff.push({ type: '+', line: l2 })
    }
  }

  return { ok: true, diff, taskId1, taskId2, filePath }
}

// ─── File Listing Helper ─────────────────────────────────────────────────────

function listFilesRecursive(dir, base) {
  const result = []
  if (!fs.existsSync(dir)) return result
  for (const item of fs.readdirSync(dir)) {
    const full = path.join(dir, item)
    const rel  = base ? `${base}/${item}` : item
    if (fs.statSync(full).isDirectory()) {
      result.push(...listFilesRecursive(full, rel))
    } else {
      result.push(rel)
    }
  }
  return result
}

// ─── Exports ─────────────────────────────────────────────────────────────────

module.exports = {
  ARCHIVE_DIR,
  TASK_INDEX,
  generateTaskId,
  startTask,
  archiveCurrentTask,
  extractTraceSegment,
  listTasks,
  getTaskDetail,
  getTaskArtifact,
  listTaskFiles,
  restoreFromTask,
  diffTaskArtifacts,
  isGitRepo,
  getGitHead,
}
