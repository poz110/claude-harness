'use strict'
/**
 * state.js — v15.0
 *
 * 职责：状态机 IO 层 + Context Budget 追踪
 *   - 文件锁 (O_EXCL 原子创建 + 僵尸锁检测)
 *   - loadState / saveState / migrateState
 *   - atomicUpdateState — 原子 read-modify-write
 *   - appendAgentLog / appendErrorLog
 *   - checkContextBudget / trackContext / resetContextBudget
 *   - autoTrackContext — 批量保存优化 + 实际字节追踪
 *   - Session Checkpoint / Work Queue
 *   - Structured Trace / Agent Result Protocol
 *
 * 无循环依赖：只依赖 config.js（纯数据）
 */

const fs     = require('fs')
const path   = require('path')
const crypto = require('crypto')

const { SCHEMA_VERSION, CONTEXT_BUDGET, TRACKED_ARTIFACT_FILES } = require('./config.js')

// ─── Paths ────────────────────────────────────────────────────────────────────
const ROOT              = process.env.HARNESS_ROOT || path.join(__dirname, '../..')
const STATE_FILE        = path.join(ROOT, 'state', 'workflow-state.json')
const STATE_DIR         = path.join(ROOT, 'state')
const AGENT_LOG         = path.join(ROOT, 'state', 'agent-log.jsonl')
const ERROR_LOG         = path.join(ROOT, 'state', 'error-log.json')
const LOCK_FILE         = path.join(ROOT, 'state', '.workflow.lock')
const TRACE_LOG         = path.join(ROOT, 'state', 'trace.jsonl')         // [v1.0.3 Harness E]
const AGENT_RESULT_FILE = path.join(ROOT, 'state', 'agent-result.json')   // [v1.0.3 Harness A]
const CHECKPOINT_FILE   = path.join(ROOT, 'state', 'session-checkpoint.json') // [v1.0.4 Context]
const WORKQUEUE_FILE    = path.join(ROOT, 'state', 'agent-workqueue.json')    // [v1.0.4 Context]

// ─── File Lock ────────────────────────────────────────────────────────────────

function acquireLock(timeoutMs = 5000) {
  const start = Date.now()
  const sab   = new SharedArrayBuffer(4)
  const i32   = new Int32Array(sab)
  while (true) {
    try {
      const fd = fs.openSync(LOCK_FILE, 'ax')
      fs.writeSync(fd, String(process.pid))
      fs.closeSync(fd)
      return
    } catch (err) {
      if (err.code !== 'EEXIST') throw err
      if (Date.now() - start > timeoutMs) {
        try {
          const holder = parseInt(fs.readFileSync(LOCK_FILE, 'utf8'), 10)
          if (holder && !isProcessAlive(holder)) { fs.unlinkSync(LOCK_FILE); continue }
        } catch {}
        throw new Error(`Lock acquisition timeout after ${timeoutMs}ms (holder: ${tryReadLockPid()})`)
      }
      Atomics.wait(i32, 0, 0, 5)
    }
  }
}

function releaseLock()       { try { fs.unlinkSync(LOCK_FILE) } catch {} }
function isProcessAlive(pid) { try { process.kill(pid, 0); return true } catch { return false } }
function tryReadLockPid()    { try { return fs.readFileSync(LOCK_FILE, 'utf8').trim() } catch { return 'unknown' } }

// ─── Atomic Update ────────────────────────────────────────────────────────────
//
// [v1.0.1] P0.3 修复：并行 FE/BE hook 同时写状态导致互相覆盖的竞态问题
//
// 用法：
//   atomicUpdateState(state => {
//     if (state.parallelProgress.FE) return null  // null = 无需保存
//     state.parallelProgress.FE = true
//     return state
//   })
//
// 与 saveState 的区别：
//   - saveState：先在外部 loadState，再传入已修改的副本 → load 和 save 之间无锁保护
//   - atomicUpdateState：load + modify + save 全程在锁内 → 真正原子
//
function atomicUpdateState(updateFn) {
  acquireLock()
  try {
    if (!fs.existsSync(STATE_FILE)) return
    const state = migrateState(JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')))
    const updated = updateFn(state)
    if (updated !== null && updated !== undefined) {
      updated.schemaVersion = SCHEMA_VERSION
      updated.updatedAt     = new Date().toISOString()
      const tmpFile = STATE_FILE + '.tmp'
      fs.writeFileSync(tmpFile, JSON.stringify(updated, null, 2), { encoding: 'utf8' })
      fs.renameSync(tmpFile, STATE_FILE)
    }
  } finally {
    releaseLock()
  }
}

// ─── State Migration ──────────────────────────────────────────────────────────

function migrateState(state) {
  const ver = state.schemaVersion || '0'
  if (ver === SCHEMA_VERSION) return state

  const [cMaj, cMin] = SCHEMA_VERSION.split('.').map(n => parseInt(n, 10) || 0)
  const [sMaj, sMin] = ver.split('.').map(n => parseInt(n, 10) || 0)
  if (sMaj > cMaj || (sMaj === cMaj && sMin >= cMin)) return state

  console.log(`  ℹ️  Migrating state from schema ${ver} → ${SCHEMA_VERSION}`)
  // v10 fields
  if (!('traceabilityReady'   in state)) state.traceabilityReady   = false
  if (!('designBaselineReady' in state)) state.designBaselineReady = false
  state.securityReauditNeeded = state.securityReauditNeeded ?? false
  state.qaFailureCount        = state.qaFailureCount ?? 0
  // v11 fields
  if (!('contextBudget' in state)) state.contextBudget = null
  // v12 fields
  if (!('interactionSpecReady' in state)) state.interactionSpecReady = false
  // v13 fields
  if (!('stateBaselineReady' in state)) state.stateBaselineReady = false
  // v13.1 fields
  if (!('techStack' in state)) state.techStack = { fe: 'nextjs', be: 'bun-hono' }
  // v14.0 fields — context now auto-tracked by hooks
  // v14.1 fields — readCount added to contextBudget
  if (state.contextBudget && !('readCount' in state.contextBudget)) {
    state.contextBudget.readCount = 0
  }
  // v14.2 fields — feature mode for incremental development
  if (!('mode' in state)) state.mode = 'greenfield'
  // v15.1 fields — autopilot mode for full automation
  if (!('autopilot' in state)) state.autopilot = false
  state.schemaVersion = SCHEMA_VERSION
  return state
}

// ─── State IO ─────────────────────────────────────────────────────────────────

function loadState() {
  if (!fs.existsSync(STATE_FILE)) {
    return {
      schemaVersion: SCHEMA_VERSION, currentState: 'IDEA',
      rollbackStack: [], history: [],
      parallelProgress: { FE: false, BE: false },
      qaFailureCount: 0, securityReauditNeeded: false, context: {},
      traceabilityReady: false, designBaselineReady: false,
      interactionSpecReady: false, stateBaselineReady: false,
      contextBudget: null,
      mode: 'greenfield',  // [v1.0.2 P1.4] 'greenfield' | 'feature'
      autopilot: false,     // [v1.0.1] 全流程自動模式
    }
  }
  return migrateState(JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')))
}

function saveState(state) {
  acquireLock()
  try {
    if (!fs.existsSync(STATE_DIR)) fs.mkdirSync(STATE_DIR, { recursive: true })
    state.schemaVersion = SCHEMA_VERSION
    state.updatedAt     = new Date().toISOString()
    const tmpFile = STATE_FILE + '.tmp'
    fs.writeFileSync(tmpFile, JSON.stringify(state, null, 2), { encoding: 'utf8' })
    fs.renameSync(tmpFile, STATE_FILE)
  } finally {
    releaseLock()
  }
}

// ─── Logging ──────────────────────────────────────────────────────────────────

function appendAgentLog(entry) {
  if (typeof entry === 'string') {
    try { entry = JSON.parse(entry) } catch { entry = { raw: entry } }
  }
  entry.timestamp = new Date().toISOString()
  if (!fs.existsSync(STATE_DIR)) fs.mkdirSync(STATE_DIR, { recursive: true })
  fs.appendFileSync(AGENT_LOG, JSON.stringify(entry) + '\n')
}

function appendErrorLog(error) {
  let errors = []
  if (fs.existsSync(ERROR_LOG)) { try { errors = JSON.parse(fs.readFileSync(ERROR_LOG, 'utf8')) } catch {} }
  errors.push({ timestamp: new Date().toISOString(), error: String(error) })
  if (errors.length > 200) errors = errors.slice(-100)
  fs.writeFileSync(ERROR_LOG, JSON.stringify(errors, null, 2))
}

// ─── Context Budget ───────────────────────────────────────────────────────────
//
// [v1.0] Context 追踪由 hook 基础设施自动执行，不依赖 Agent 主动调用
// [v1.0.1 P0.1] 新增 Read 操作追踪：Read 大文件是 context 真正的消耗大户
// [v1.0.1 P0.2] 批量保存优化：每 TRACK_BATCH_SIZE 次操作才写磁盘，减少 ~80% I/O
//
// 估算公式（每种操作的平均 token 消耗）：
//   bash  ≈ 1000 tokens（命令输出差异大，取均值）
//   write ≈  500 tokens（写文件通常比读小）
//   read  ≈  800 tokens（Read 大文件是最主要的 context 消耗）
// context window ≈ 200k tokens，实际可用约 180k

const ESTIMATED_TOTAL  = 180000
const BASH_ESTIMATE    = 1000   // tokens per bash command
const WRITE_ESTIMATE   =  500   // tokens per write/edit operation
const READ_ESTIMATE    =  800   // tokens per read operation  [v1.0.1 P0.1 新增]

/**
 * 估算 budget 已用 tokens
 * [v1.0.4] 優先使用 actualTokens（從真實字節數計算），回退到操作次數 × 固定常量
 * actualTokens 由 hookPostBash/hookPostRead 傳入 actualBytes 參數後累積
 */
function estimateTokens(budget) {
  // 若有實際字節統計，優先使用（精度比固定常量高 5-10 倍）
  if (budget.actualTokens > 0) return budget.actualTokens
  return (budget.bashCount  || 0) * BASH_ESTIMATE
       + (budget.writeCount || 0) * WRITE_ESTIMATE
       + (budget.readCount  || 0) * READ_ESTIMATE
}

/**
 * 检查 context 使用率，返回警告消息（如超阈值），或 null
 * [v1.0.1] 估算公式已包含 readCount
 */
function checkContextBudget(state) {
  const budget = state.contextBudget
  if (!budget) return null

  const { agentName, bashCount = 0, writeCount = 0, readCount = 0, actualTokens = 0 } = budget
  const criticalDocs = CONTEXT_BUDGET.CRITICAL_DOCS[agentName]
  if (!criticalDocs) return null

  const estimated = estimateTokens(budget)
  const ratio     = estimated / ESTIMATED_TOTAL
  // [v1.0.4] 顯示實際 vs 估算以幫助用戶理解精確度
  const tokenInfo = actualTokens > 0
    ? `實際 ~${Math.round(actualTokens / 1000)}k tokens（字節精算）`
    : `估算 ~${Math.round(estimated / 1000)}k tokens（操作次數 × 常量）`

  if (ratio >= CONTEXT_BUDGET.REREAD_THRESHOLD) {
    return [
      ``,
      `⚠️  [Context Guard] ${agentName} context ${Math.round(ratio * 100)}%  ${tokenInfo}`,
      `   操作：bash=${bashCount} write=${writeCount} read=${readCount}`,
      `   建議：完成當前子任務後寫 checkpoint，然後強制重讀：`,
      `   node scripts/workflow.js write-checkpoint '{"inProgress":"...","completedUnits":[...]}'`,
      `強制重讀核心文檔：`,
      ...criticalDocs.map((d, i) => `  ${i + 1}. Read ${d}`),
    ].join('\n')
  }

  if (ratio >= CONTEXT_BUDGET.WARN_THRESHOLD) {
    return [
      ``,
      `💡 [Context Guard] ${agentName} context ${Math.round(ratio * 100)}%  ${tokenInfo}`,
      `   操作：bash=${bashCount} write=${writeCount} read=${readCount}`,
      `   建議：儘快用 write-checkpoint 記錄進度，以備壓縮後恢復`,
    ].join('\n')
  }

  return null
}

/**
 * 自动递增 context 操作计数（由 hookPostBash/hookPostWrite/hookPostRead 调用）
 *
 * [v1.0.1 P0.2] 批量保存优化：
 *   - 正常情况下每 TRACK_BATCH_SIZE 次操作才写磁盘（减少 80% I/O 和锁竞争）
 *   - 一旦进入预警区间（ratio >= WARN_THRESHOLD），每次都持久化（确保准确性）
 *
 * [v1.0.1 P0.1] 新增 'read' 操作类型追踪
 */
/**
 * 自动递增 context 操作计数
 * [v1.0.4] 新增 actualBytes 參數：若提供則用 bytes÷4 作為精確 token 估算
 *   hookPostBash 傳入 output.length，hookPostRead 傳入 content.length
 *   未提供時（hookPostWrite）回退到固定常量
 */
function autoTrackContext(state, opType, actualBytes) {
  if (!state.contextBudget?.agentName) return state  // 无活跃 agent，跳过

  const budg = state.contextBudget
  if (opType === 'bash')  budg.bashCount  = (budg.bashCount  || 0) + 1
  if (opType === 'write') budg.writeCount = (budg.writeCount || 0) + 1
  if (opType === 'read')  budg.readCount  = (budg.readCount  || 0) + 1
  budg.lastUpdated = new Date().toISOString()

  // [v1.0.4] 實際字節→token 累積（4 bytes ≈ 1 token，業界標準近似）
  if (actualBytes > 0) {
    const tokensThisOp = Math.ceil(actualBytes / 4)
    budg.actualTokens = (budg.actualTokens || 0) + tokensThisOp
  } else {
    // 回退：按固定常量累積到 actualTokens
    const fallback = opType === 'bash' ? BASH_ESTIMATE
                   : opType === 'write' ? WRITE_ESTIMATE
                   : READ_ESTIMATE
    budg.actualTokens = (budg.actualTokens || 0) + fallback
  }

  // 决定是否持久化（P0.2 批量保存逻辑）
  const totalOps    = (budg.bashCount || 0) + (budg.writeCount || 0) + (budg.readCount || 0)
  const ratio       = estimateTokens(budg) / ESTIMATED_TOTAL
  const inWarning   = ratio >= CONTEXT_BUDGET.WARN_THRESHOLD
  const atBatchEdge = totalOps % CONTEXT_BUDGET.TRACK_BATCH_SIZE === 0

  if (inWarning || atBatchEdge) {
    saveState(state)
  }
  return state
}

/**
 * 手动记录 context 操作（保留供调试；正常流程由 hook 自动调用）
 */
function trackContext(agentName, opType) {
  const state = loadState()
  if (!state.contextBudget || state.contextBudget.agentName !== agentName) {
    state.contextBudget = { agentName, bashCount: 0, writeCount: 0, readCount: 0, startedAt: new Date().toISOString() }
  }
  const updated  = autoTrackContext(state, opType)
  const budget   = updated.contextBudget
  const estimated = estimateTokens(budget)
  const ratio     = estimated / ESTIMATED_TOTAL
  return {
    agentName,
    bashCount:       budget.bashCount  || 0,
    writeCount:      budget.writeCount || 0,
    readCount:       budget.readCount  || 0,
    estimatedTokens: estimated,
    usageRatio:      ratio,
    warning:  ratio >= CONTEXT_BUDGET.WARN_THRESHOLD,
    critical: ratio >= CONTEXT_BUDGET.REREAD_THRESHOLD,
  }
}

/**
 * Agent 开始工作时重置 context budget（建议在 Agent 上线时调用）
 * [v1.0.1] 新增 readCount 初始化
 */
function resetContextBudget(agentName) {
  const state = loadState()
  state.contextBudget = { agentName, bashCount: 0, writeCount: 0, readCount: 0, startedAt: new Date().toISOString() }
  saveState(state)
}

// ─── [v1.0.4] Session Checkpoint — 壓縮後執行狀態恢復 ──────────────────────────
//
// 解決「執行失憶」問題：context 壓縮後 Agent 知道「需求是什麼」但不知道「做到哪了」。
// Checkpoint 把執行狀態持久化到文件系統，壓縮後可立即恢復。
//
// 寫入時機：
//   - 完成一個頁面/功能單元後
//   - context 使用率達到 70% 預警時
//   - hookPostCompact 觸發前（由 checkContextBudget 提示調用）
//
// 格式：
//   agentName, workflowState, completedUnits, inProgress,
//   keyDecisions, knownIssues, filesCreated, updatedAt
//
function writeCheckpoint(checkpoint) {
  const entry = {
    agentName:      checkpoint.agentName      || 'unknown',
    workflowState:  checkpoint.workflowState  || loadState().currentState,
    completedUnits: checkpoint.completedUnits || [],
    inProgress:     checkpoint.inProgress     || null,
    keyDecisions:   checkpoint.keyDecisions   || [],
    knownIssues:    checkpoint.knownIssues    || [],
    filesCreated:   checkpoint.filesCreated   || [],
    updatedAt:      new Date().toISOString(),
  }
  try {
    if (!fs.existsSync(STATE_DIR)) fs.mkdirSync(STATE_DIR, { recursive: true })
    fs.writeFileSync(CHECKPOINT_FILE, JSON.stringify(entry, null, 2))
  } catch (e) { console.warn(`⚠️  writeCheckpoint 失敗：${e.message}`) }
}

function readCheckpoint() {
  try {
    if (!fs.existsSync(CHECKPOINT_FILE)) return null
    return JSON.parse(fs.readFileSync(CHECKPOINT_FILE, 'utf8'))
  } catch { return null }
}

function clearCheckpoint() {
  try { if (fs.existsSync(CHECKPOINT_FILE)) fs.unlinkSync(CHECKPOINT_FILE) } catch {}
}

// ─── [v1.0.4] Work Queue — 跨 Session 工作隊列 ─────────────────────────────────
//
// 把 Phase 的工作拆成可追蹤的「工作單元」（頁面/API組/功能塊），
// Agent 逐個認領並完成，確保：
//   1. 壓縮後知道哪些做完了、哪些沒做
//   2. 任何中斷（超時/壓縮/錯誤）都能從斷點繼續
//   3. 多個 sub-session 可以協作完成大型 Phase
//
// 工作單元狀態流：pending → in_progress → completed | failed
//
function initWorkQueue(phase, role, units) {
  const queue = {
    phase,
    role:      role || 'unknown',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    units: units.map((u, i) => ({
      id:          u.id || `unit-${i + 1}`,
      type:        u.type || 'general',       // page | api-group | component | general
      desc:        u.desc || u.description || `Work unit ${i + 1}`,
      status:      'pending',                  // pending | in_progress | completed | failed
      claimedAt:   null,
      completedAt: null,
      note:        null,
    })),
  }
  try {
    if (!fs.existsSync(STATE_DIR)) fs.mkdirSync(STATE_DIR, { recursive: true })
    fs.writeFileSync(WORKQUEUE_FILE, JSON.stringify(queue, null, 2))
  } catch (e) { console.warn(`⚠️  initWorkQueue 失敗：${e.message}`) }
  return queue
}

function readWorkQueue() {
  try {
    if (!fs.existsSync(WORKQUEUE_FILE)) return null
    return JSON.parse(fs.readFileSync(WORKQUEUE_FILE, 'utf8'))
  } catch { return null }
}

function _saveWorkQueue(queue) {
  queue.updatedAt = new Date().toISOString()
  fs.writeFileSync(WORKQUEUE_FILE, JSON.stringify(queue, null, 2))
}

function claimWork(unitId) {
  const queue = readWorkQueue()
  if (!queue) return { ok: false, error: 'workqueue 不存在，請先運行 init-workqueue' }
  const unit = queue.units.find(u => u.id === unitId)
  if (!unit) return { ok: false, error: `找不到 unit: ${unitId}` }
  if (unit.status === 'completed') return { ok: false, error: `${unitId} 已完成` }
  if (unit.status === 'in_progress') return { ok: true, unit, alreadyClaimed: true }
  unit.status    = 'in_progress'
  unit.claimedAt = new Date().toISOString()
  _saveWorkQueue(queue)
  return { ok: true, unit }
}

function completeWork(unitId, note) {
  const queue = readWorkQueue()
  if (!queue) return { ok: false, error: 'workqueue 不存在' }
  const unit = queue.units.find(u => u.id === unitId)
  if (!unit) return { ok: false, error: `找不到 unit: ${unitId}` }
  unit.status      = 'completed'
  unit.completedAt = new Date().toISOString()
  if (note) unit.note = note
  _saveWorkQueue(queue)
  const remaining = queue.units.filter(u => u.status === 'pending').length
  const done      = queue.units.filter(u => u.status === 'completed').length
  return { ok: true, unit, remaining, done, total: queue.units.length }
}

// ─── [v1.0.3 Harness E] Structured Trace ──────────────────────────────────────
//
// 統一的結構化審計日誌，每個 key 事件（advance/rollback/prereq_block/
// tool_permission_block/artifact_fingerprint_warn/agent_result）寫入 trace.jsonl。
// 格式版本化，可機器讀取，支持 trace-summary 命令聚合分析。
//
function appendTrace(event, stateSnapshot) {
  const entry = {
    v: 1,
    ts: Date.now(),
    iso: new Date().toISOString(),
    workflowState: stateSnapshot?.currentState || 'unknown',
    agentName:     stateSnapshot?.contextBudget?.agentName || event.agentName || 'unknown',
    eventType:     event.type,    // advance|rollback|prereq_block|tool_permission_block|artifact_fingerprint_warn|agent_result|init_feature
    payload:       event.payload  || {},
    durationMs:    event.durationMs,
  }
  try {
    if (!fs.existsSync(STATE_DIR)) fs.mkdirSync(STATE_DIR, { recursive: true })
    fs.appendFileSync(TRACE_LOG, JSON.stringify(entry) + '\n')
  } catch { /* trace 是 best-effort，絕不因日誌失敗阻斷流程 */ }
}

// ─── [v1.0.3 Harness A] Agent 結果協議 ─────────────────────────────────────────
//
// Agent 完成工作後調用 write-agent-result 寫入結果，hookStop 讀取並差異化路由。
// 格式：{ status, agentName, artifactsProduced, blockingReason, nextAction }
//   status: 'success' | 'partial' | 'failed' | 'blocked'
//   artifactsProduced: 本輪產出的文件路徑列表
//   blockingReason: 若 blocked，說明阻塞原因
//   nextAction: 建議 harness 的下一步（'advance' | 'check' | 'fix-blockers' | 'rerun'）
//
function writeAgentResult(result) {
  const entry = {
    status:            result.status            || 'unknown',
    agentName:         result.agentName         || 'unknown',
    artifactsProduced: result.artifactsProduced || [],
    blockingReason:    result.blockingReason    || null,
    nextAction:        result.nextAction        || 'check',
    writtenAt:         new Date().toISOString(),
  }
  try {
    if (!fs.existsSync(STATE_DIR)) fs.mkdirSync(STATE_DIR, { recursive: true })
    fs.writeFileSync(AGENT_RESULT_FILE, JSON.stringify(entry, null, 2))
  } catch (e) {
    console.warn(`⚠️  writeAgentResult 失敗：${e.message}`)
  }
}

function readAgentResult() {
  try {
    if (!fs.existsSync(AGENT_RESULT_FILE)) return null
    const result = JSON.parse(fs.readFileSync(AGENT_RESULT_FILE, 'utf8'))
    // 超過 15 分鐘的結果視為過期
    const ageMs = Date.now() - new Date(result.writtenAt).getTime()
    if (ageMs > 15 * 60 * 1000) return null
    return result
  } catch { return null }
}

// ─── [v1.0.3 Harness D] 産出物完整性指紋 ──────────────────────────────────────
//
// advance()/rollback() 完成後對 TRACKED_ARTIFACT_FILES 做 SHA256 快照，
// 存入 state.artifactFingerprints[relPath] = { hash, snapshotAt, state }。
// hookPreWrite 對比指紋，發現意外修改時輸出 harness 警告。
//
function snapshotArtifacts(state) {
  state.artifactFingerprints = state.artifactFingerprints || {}
  for (const relFile of TRACKED_ARTIFACT_FILES) {
    const full = path.join(ROOT, relFile)
    if (fs.existsSync(full)) {
      const hash = crypto
        .createHash('sha256')
        .update(fs.readFileSync(full))
        .digest('hex')
        .slice(0, 12)
      state.artifactFingerprints[relFile] = {
        hash,
        snapshotAt:    new Date().toISOString(),
        workflowState: state.currentState,
      }
    } else {
      // 文件不存在時清除舊指紋（可能是 rollback 清理後）
      delete state.artifactFingerprints[relFile]
    }
  }
  return state
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  ROOT, STATE_FILE, STATE_DIR, AGENT_LOG, ERROR_LOG, LOCK_FILE,
  TRACE_LOG, AGENT_RESULT_FILE,                                          // [v1.0.3]
  acquireLock, releaseLock, isProcessAlive, tryReadLockPid,
  migrateState, loadState, saveState, atomicUpdateState,
  appendAgentLog, appendErrorLog,
  checkContextBudget, autoTrackContext, trackContext, resetContextBudget, estimateTokens,
  ESTIMATED_TOTAL, BASH_ESTIMATE, WRITE_ESTIMATE, READ_ESTIMATE,
  appendTrace, writeAgentResult, readAgentResult, snapshotArtifacts,     // [v1.0.3 Harness A/D/E]
  writeCheckpoint, readCheckpoint, clearCheckpoint,                      // [v1.0.4 Context]
  initWorkQueue, readWorkQueue, claimWork, completeWork,                 // [v1.0.4 Context]
  CHECKPOINT_FILE, WORKQUEUE_FILE,
}
