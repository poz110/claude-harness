#!/usr/bin/env node
/**
 * workflow.js — v14.1
 *
 * v14.0 核心改造：完整解决 P0 + P1 架构问题
 *
 * P0 修复（Context 生命周期）：
 *   1. [P0.1] SessionStart hook + hookPostCompact — context 压缩后自动重注入关键文档
 *   2. [P0.2] Hook 自动追踪 context — 从"荣誉制度"改为基础设施强制执行
 *
 * P1 修复（代码结构 + 配置）：
 *   1. [P1.1] Agent Teams 路径 A 检测强化 + settings.json env 块支持
 *   2. [P1.2] 模型分级差异化 — Opus > Sonnet > Haiku 按任务复杂度分配
 *   3. [P1.3] workflow.js 拆分 — 从 1782 行拆分为 5 个 lib 模块
 *
 * 文件结构：
 *   scripts/lib/state.js      — IO + Context Budget + 迁移
 *   scripts/lib/verify.js    — 文档校验 + 构建/集成检查
 *   scripts/lib/hooks.js     — 所有 Hook 处理器（含 P0.2 自动追踪 + P0.1 压缩重注入）
 *   scripts/lib/install.js    — 全局安装 + init-project
 *   scripts/lib/config.js    — 单一真相来源（SCHEMA + 模型 + 技术栈 + Agent Teams）
 *
 * workflow.js（本文件）：
 *   精简为 CLI 路由器，只保留：
 *   - 状态机核心逻辑（advance / rollback / handleQaFailure / triggerSecurityReudit）
 *   - displayStatus（状态展示）
 *   - CLI 命令分发
 *
 * 代码行数：从 v13.1 的 1782 行减少到 ~500 行
 */

'use strict'

const fs    = require('fs')
const path  = require('path')

// ─── Load lib modules (职责分离）────────────────────────────────────────────

const {
  SCHEMA_VERSION, STATES, TRANSITIONS,
  ARTIFACT_STATE_MAP, STALE_ARTIFACTS,
  FE_PATH_PREFIX, BE_PATH_PREFIX,
  AGENT_TEAMS_CONFIG,
  FEATURE_SKIP_STATES,   // [v1.0 P1.4]
  HOTFIX_SKIP_STATES,    // [v1.0 P1.1]
  AGENT_MODEL_MAP, MODEL_COSTS, COST_PER_MILLION,  // [v1.0 P1.5]
  ARTIFACT_VALIDATORS_FOR_STATE, PREREQ_HINTS,     // [v1.5]
} = require('./lib/config.js')

const {
  loadState, saveState,
  checkContextBudget, autoTrackContext, trackContext, resetContextBudget,
  appendAgentLog, appendErrorLog,
  appendTrace, snapshotArtifacts, writeAgentResult, readAgentResult,  // [v1.0 Harness A/D/E]
  TRACE_LOG, AGENT_RESULT_FILE,
  estimateTokens,   // [v1.0 P1.5]
  ROOT,             // [v1.1] 统一路径，避免重复定义
} = require('./lib/state.js')

const {
  checkPrereqs, validateDoc,
  fullVerify, checkCodeOutputs, runIntegrationCheck, runSmokeTest,
  getGitDiffBase, countFiles, syncCheck,
} = require('./lib/verify.js')

const {
  archiveCurrentTask, startTask,
} = require('./lib/archive.js')

const {
  installGlobal, checkGlobal, updateGlobal, uninstallGlobal, initProject,
} = require('./lib/install.js')

// ─── State Machine Core ─────────────────────────────────────────────────────
//
// 保留在 workflow.js 的原因：
//   - advance/rollback 是状态机核心领域逻辑，属于 workflow 本身
//   - handleQaFailure / triggerSecurityReaudit 包含业务规则
//   - displayStatus 需要访问多个模块，留在此处便于维护
// ─────────────────────────────────────────────────────────────────────────────────

function advance(state, force = false) {
  const current     = state.currentState
  const stateConfig = STATES[current]
  const transition  = TRANSITIONS[current]

  if (!transition || !transition.next) throw new Error(`No transition from ${current}`)

  // [v1.0] Autopilot mode: auto-force MANUAL nodes
  const effectiveForce = force || (state.autopilot && stateConfig.manual)
  if (state.autopilot && stateConfig.manual && !force) {
    console.log(`🤖 [autopilot] 自動推進 MANUAL 節點: ${current}`)
  }
  if (stateConfig.manual && !effectiveForce) throw new Error(`State ${current} requires --force (MANUAL node)`)

  // [v1.0 P1.4] Feature mode: auto-skip ARCH_REVIEW/CEO_REVIEW/DESIGN_PHASE/DESIGN_REVIEW
  // [v1.0 P1.1] Hotfix mode: also skips IMPLEMENTATION (patches go directly to CODE_REVIEW)
  let nextState = transition.next
  const skipStates = state.mode === 'hotfix' ? HOTFIX_SKIP_STATES
              : state.mode === 'feature' ? FEATURE_SKIP_STATES : null
  if (skipStates && skipStates.includes(nextState)) {
    const modeName = state.mode === 'hotfix' ? 'hotfix mode' : 'feature mode'
    while (skipStates.includes(nextState)) {
      console.log(`⏭  [${modeName}] 自動跳過 ${nextState}`)
      const skipTransition = TRANSITIONS[nextState]
      if (!skipTransition?.next) break
      nextState = skipTransition.next
    }
    if (state.mode === 'hotfix') {
      // Hotfix skips IMPLEMENTATION → directly to CODE_REVIEW
      // PRD_REVIEW.next is ARCH_REVIEW, which hotfix skips → next is CODE_REVIEW
      console.log(`⏭  [hotfix mode] 直接進入 CODE_REVIEW 進行代碼審查`)
    }
  }

  const entry = {
    from: current, to: nextState,
    timestamp: new Date().toISOString(), agent: transition.agent,
    type: stateConfig.manual ? 'manual' : 'auto',
    ...(state.mode === 'feature' && nextState !== transition.next
      ? { featureSkipped: transition.next }
      : {}),
  }
  state.history.push(entry)
  if (state.history.length > 500) state.history = state.history.slice(-500)
  state.rollbackStack.push(current)
  if (state.rollbackStack.length > 100) state.rollbackStack = state.rollbackStack.slice(-100)
  state.currentState = nextState

  // [v1.0 P1.3] 用 STATES[next].parallel 标志驱动，而非硬编码 'DESIGN_REVIEW'
  if (STATES[nextState]?.parallel) {
    state.parallelProgress = { FE: false, BE: false }
    state.contextBudget = null
  }
  if (nextState === 'SECURITY_REVIEW') {
    state.securityReauditNeeded = false
  }
  return state
}

function rollback(state, targetState) {
  if (!STATES[targetState]) throw new Error(`Unknown state: ${targetState}`)
  const stateKeys  = Object.keys(STATES)
  const targetIdx  = stateKeys.indexOf(targetState)
  const currentIdx = stateKeys.indexOf(state.currentState)

  if (targetIdx >= currentIdx) throw new Error(`Cannot rollback forward: ${targetState} is at or after ${state.currentState}`)

  // [v1.0 P0.3] 计算需要清理的产物（但先不删除）
  const statesToClean = stateKeys.slice(targetIdx + 1, currentIdx + 1)
  let artifactsToClean = []
  for (const s of statesToClean) {
    for (const artifact of (STALE_ARTIFACTS[s] || [])) {
      const full = path.join(__dirname, '..', artifact)
      if (artifact.endsWith('/')) {
        if (fs.existsSync(full)) artifactsToClean.push({ path: full, artifact, isDir: true })
      } else if (fs.existsSync(full)) {
        artifactsToClean.push({ path: full, artifact, isDir: false })
      }
    }
  }

  const cleaned = artifactsToClean.map(a => a.artifact)

  // [v1.0 P0.3] 先更新状态（状态优先于文件清理）
  // 如果中间崩溃，最坏情况是遗留旧文件（可手动清理），
  // 而非文件已删但状态未更新（不一致且难以恢复）
  state.history.push({
    from: state.currentState, to: targetState,
    timestamp: new Date().toISOString(), agent: 'system',
    type: 'rollback', cleanedArtifacts: cleaned,
  })
  if (state.history.length > 500) state.history = state.history.slice(-500)
  state.currentState = targetState

  while (state.rollbackStack.length && state.rollbackStack[state.rollbackStack.length - 1] !== targetState) {
    state.rollbackStack.pop()
  }
  if (stateKeys.indexOf(targetState) <= stateKeys.indexOf('DESIGN_REVIEW')) {
    state.parallelProgress = { FE: false, BE: false }
    state.contextBudget = null  // Clear context budget on deep rollback
  }

  // [v1.0 P0.3] 状态已就绪后再执行文件清理
  for (const { path: full, isDir } of artifactsToClean) {
    try {
      if (isDir) fs.rmSync(full, { recursive: true, force: true })
      else fs.unlinkSync(full)
    } catch (err) {
      // 文件清理失败不阻塞回滚（状态已安全保存）
      console.warn(`⚠️  清理产物失败: ${full} — ${err.message}`)
    }
  }

  return { state, cleaned }
}

function handleQaFailure(state) {
  state.qaFailureCount = (state.qaFailureCount || 0) + 1
  appendAgentLog({ agent: 'orchestrator', action: 'qa-failure', count: state.qaFailureCount })

  if (state.qaFailureCount >= 2) {
    // feature/hotfix 模式下 ARCH_REVIEW 被跳過，回滾到那裡無意義
    // 改為回滾到 IMPLEMENTATION 並重置計數，讓 fullstack-engineer 重新修復
    if (state.mode === 'feature' || state.mode === 'hotfix') {
      console.log(`\n⚠️  QA 连续失败 ${state.qaFailureCount} 次（${state.mode} 模式），回滚至 IMPLEMENTATION 重新修復`)
      const { state: newState, cleaned } = rollback(state, 'IMPLEMENTATION')
      newState.qaFailureCount = 0
      return { state: newState, cleaned, escalated: false }
    }
    console.log(`\n⚠️  QA 连续失败 ${state.qaFailureCount} 次，升级回滚至 ARCH_REVIEW`)
    const { state: newState, cleaned } = rollback(state, 'ARCH_REVIEW')
    newState.qaFailureCount = 0
    return { state: newState, cleaned, escalated: true }
  }
  console.log(`\n QA 失败（第 ${state.qaFailureCount} 次），回滚至 IMPLEMENTATION`)
  const { state: newState, cleaned } = rollback(state, 'IMPLEMENTATION')
  return { state: newState, cleaned, escalated: false }
}

function triggerSecurityReaudit(state) {
  const secReport = path.join(ROOT, 'docs/security-report.md')
  if (fs.existsSync(secReport)) { fs.unlinkSync(secReport); console.log('🗑  Cleaned stale security-report.md') }
  state.history.push({ from: state.currentState, to: 'SECURITY_REVIEW', timestamp: new Date().toISOString(), agent: 'system', type: 'security-reaudit' })
  state.currentState = 'SECURITY_REVIEW'
  state.securityReauditNeeded = false
  console.log('🔒 Re-entering SECURITY_REVIEW for re-audit after fixes')
  return state
}

function displayStatus(state) {
  const current    = state.currentState
  const stateInfo  = STATES[current]
  const transition = TRANSITIONS[current]
  const stateKeys  = Object.keys(STATES)
  const step       = stateKeys.indexOf(current) + 1

  console.log(`\n${'─'.repeat(64)}`)
  console.log(`  Workflow v${SCHEMA_VERSION}   Step ${step}/${stateKeys.length}  [schema: ${state.schemaVersion || '?'}]`)

  // ── [v1.5] ASCII 进度条 + 时间线 ──────────────────────────────────────────
  const total = stateKeys.length
  const barWidth = 28
  const filled = Math.round((step / total) * barWidth)
  const bar = '\u2588'.repeat(filled) + '\u2591'.repeat(barWidth - filled)
  console.log(`  Progress: [${bar}] ${step}/${total}`)

  const skipStates = state.mode === 'hotfix' ? HOTFIX_SKIP_STATES
    : state.mode === 'feature' ? FEATURE_SKIP_STATES : []
  const passedCount = step - 1
  const remaining = total - step
  const skippedCount = skipStates.filter(s => stateKeys.indexOf(s) < stateKeys.indexOf(current)).length
  console.log(`  Timeline: ${passedCount} done${skippedCount > 0 ? ` / ${skippedCount} skipped` : ''} \u2192 [${current}] \u2192 ${remaining} remaining`)

  console.log(`${'─'.repeat(64)}`)
  // [v1.0] Autopilot mode badge (highest priority)
  if (state.autopilot) {
    console.log(`  🤖 AUTOPILOT MODE — 全流程自動（MANUAL 節點自動推進）`)
  }
  // [v1.0 P1.4] Feature mode badge
  if (state.mode === 'feature') {
    console.log(`  Mode    : ✨ FEATURE MODE — 自動跳過 ${FEATURE_SKIP_STATES.join('/')}`)
  }
  // [v1.0 P1.1] Hotfix mode badge
  if (state.mode === 'hotfix') {
    console.log(`  Mode    : 🔧 HOTFIX MODE — 自動跳過 ${HOTFIX_SKIP_STATES.join('/')}`)
  }
  if (state.taskId) {
    console.log(`  Task    : ${state.taskId}`)
  }
  console.log(`  State   : ${current}`)
  console.log(`  Desc    : ${stateInfo?.desc}`)
  // [v1.0] Show autopilot auto-advance for MANUAL nodes
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
    // [v1.0] Full-Stack Agent 单线实现，无并行协调开销
    console.log(`  Agent   : fullstack-engineer（API-first → BE → FE，同一 context 写全栈）`)
    console.log(`  Complete: node scripts/workflow.js advance`)
  }

  // [v1.0] Context budget display — [v1.0] 包含 readCount
  if (state.contextBudget) {
    const budget = state.contextBudget
    const { estimateTokens, ESTIMATED_TOTAL } = require('./lib/state.js')
    const { CONTEXT_BUDGET } = require('./lib/config.js')
    const ratio = estimateTokens(budget) / ESTIMATED_TOTAL
    const icon  = ratio >= CONTEXT_BUDGET.REREAD_THRESHOLD ? '🔴' : ratio >= CONTEXT_BUDGET.WARN_THRESHOLD ? '🟡' : '🟢'
    console.log(`  Context : ${icon} ${budget.agentName} ~${Math.round(ratio * 100)}% (bash:${budget.bashCount || 0} write:${budget.writeCount || 0} read:${budget.readCount || 0})`)
  }

  // ── [v1.5] 累计成本显示 ─────────────────────────────────────────────────
  if (fs.existsSync(TRACE_LOG)) {
    try {
      const traceLines = fs.readFileSync(TRACE_LOG, 'utf8').trim().split('\n').filter(Boolean)
      let totalCost = 0, totalTokens = 0
      for (const line of traceLines) {
        try {
          const e = JSON.parse(line)
          if (e.eventType === 'advance' && e.costEstimate?.estimatedCost) {
            totalCost += e.costEstimate.estimatedCost
            totalTokens += e.costEstimate.tokens || 0
          }
        } catch {}
      }
      if (totalCost > 0) {
        const tokensK = (totalTokens / 1000).toFixed(0)
        console.log(`  Cost    : ~$${totalCost.toFixed(4)} (${tokensK}K tokens)`)
      }
    } catch {}
  }

  if (state.qaFailureCount > 0) console.log(`  QA Fails: ${state.qaFailureCount} (≥2 → ARCH_REVIEW escalation)`)
  if (state.securityReauditNeeded) console.log(`  ⚠️  Security re-audit needed`)

  // [v1.0] Tech stack
  if (state.techStack) {
    console.log(`  Stack   : FE=${state.techStack.fe}  BE=${state.techStack.be}  (change: init-project with new stack)`)
  }

  // Design readiness flags
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

  const nextState = transition?.next
  if (nextState) {
    const prereqCheck = checkPrereqs(nextState)
    if (prereqCheck.ok) {
      console.log(stateInfo?.manual ? `\n  ⏸  → node scripts/workflow.js advance --force` : `\n  ✅ → node scripts/workflow.js advance`)
    } else {
      console.log(`\n  ⏳ Missing for ${nextState}: ${prereqCheck.missing.join(', ')}`)
    }
  }
  console.log(`${'─'.repeat(64)}\n`)
}

// ─── Design Baseline (保留自 v13）──────────────────────────────────────

function generateDesignBaseline() {
  const designDir   = path.join(ROOT, 'design')
  const statesDir   = path.join(ROOT, 'design', 'states')
  const baselineDir = path.join(ROOT, 'design', 'baseline')
  if (!fs.existsSync(designDir)) { console.error('❌ design/ directory not found — run Designer first'); process.exit(1) }
  if (!fs.existsSync(baselineDir)) fs.mkdirSync(baselineDir, { recursive: true })

  // Scan for default page designs (desktop.html / mobile.html)
  const pageFiles = []
  function findPageHtml(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const e of entries) {
      if (e.isDirectory() && e.name !== 'baseline' && e.name !== 'states') findPageHtml(path.join(dir, e.name))
      else if (e.isFile() && (e.name === 'desktop.html' || e.name === 'mobile.html')) pageFiles.push(path.join(dir, e.name))
    }
  }
  findPageHtml(designDir)

  // Scan for state designs in design/states/{page}__{state-id}.html
  const stateFiles = []
  if (fs.existsSync(statesDir)) {
    for (const e of fs.readdirSync(statesDir, { withFileTypes: true })) {
      if (e.isFile() && e.name.endsWith('.html') && e.name.includes('__')) {
        stateFiles.push(path.join(statesDir, e.name))
      }
    }
  }

  if (pageFiles.length === 0 && stateFiles.length === 0) {
    console.log('⚠️  No design screens found — design/ may only have stitch-prompts.md')
    console.log('   Run Designer /generate-stitch-designs and /state-baseline first')
    return
  }

  // Parse state metadata from filename {page}__{state-id}.html
  const stateEntries = stateFiles.map(f => {
    const name = path.basename(f, '.html')         // e.g. dashboard__sidebar-collapsed
    const [page, ...rest] = name.split('__')
    const stateId = rest.join('__')                // Handle state-ids containing __
    return { file: path.relative(ROOT, f), page, stateId, type: 'state' }
  })

  const pageEntries = pageFiles.map(f => {
    const rel = path.relative(ROOT, f)             // e.g. design/dashboard/desktop.html
    const parts = rel.split(path.sep)              // ['design','dashboard','desktop.html']
    const page = parts[1] || 'unknown'
    const view = path.basename(f, '.html')         // desktop | mobile
    return { file: rel, page, stateId: view, type: 'page' }
  })

  // Write manifest
  const manifest = {
    schemaVersion: '14.0',
    generated: new Date().toISOString(),
    files: [...pageEntries, ...stateEntries].map(e => e.file),
    screens: [
      ...pageEntries.map(e => ({ ...e, baseline: true })),
      ...stateEntries.map(e => ({ ...e, baseline: true })),
    ],
  }
  fs.writeFileSync(path.join(baselineDir, 'manifest.json'), JSON.stringify(manifest, null, 2))

  console.log(`✅ Baseline manifest written`)
  console.log(`   Pages  : ${pageEntries.length} screens (desktop/mobile)`)
  console.log(`   States : ${stateEntries.length} interaction-state screens`)
  console.log(`   Total  : ${manifest.files.length} baseline files`)
  if (stateEntries.length === 0) {
    console.log(`\n⚠️  No state screens found in design/states/`)
    console.log(`   Run Designer /state-baseline to generate interaction-state baselines`)
    console.log(`   Without state baselines, only default page layout is tested (not interactions)`)
  }
  console.log(`\n   Next: npx playwright test tests/visual/design-baseline.spec.ts --update-snapshots`)

  // Update state flags
  const bState = loadState()
  bState.designBaselineReady = pageEntries.length > 0
  bState.stateBaselineReady  = stateEntries.length > 0
  saveState(bState)
  appendAgentLog({ agent: 'system', action: 'design-baseline', pages: pageEntries.length, states: stateEntries.length })
}

function verifySecurityFix() {
  const reportFile = path.join(ROOT, 'docs/security-report.md')
  const fixesFile  = path.join(ROOT, 'docs/security-fixes.md')
  if (!fs.existsSync(reportFile)) { console.error('❌ docs/security-report.md not found'); process.exit(1) }
  if (!fs.existsSync(fixesFile))  { console.error('❌ docs/security-fixes.md not found'); process.exit(1) }
  const report = fs.readFileSync(reportFile, 'utf8')
  const fixes  = fs.readFileSync(fixesFile, 'utf8')
  const reportIds = [...report.matchAll(/(?:SEC|OWASP)-\d+/g)].map(m => m[0])
  const unaddressed = reportIds.filter(id => !fixes.includes(id))
  if (unaddressed.length > 0) {
    console.error(`❌ security-fixes.md missing entries for: ${unaddressed.join(', ')}`)
    process.exit(1)
  }
  console.log(`✅ All ${reportIds.length} finding(s) addressed in security-fixes.md`)
  appendAgentLog({ agent: 'system', action: 'security-verify-fix', findings: reportIds.length })
}

// ─── Main CLI Router ────────────────────────────────────────────────────────

async function main() {
  const [, , cmd, ...args] = process.argv
  let state = loadState()

  try {
    switch (cmd) {

      // ── Hook commands (委托给 lib/hooks.js）────────────────────────────
      case 'hook-post-write':
      case 'hook-post-bash':
      case 'hook-post-read':
      case 'hook-pre-write':
      case 'hook-pre-bash':
      case 'hook-stop':
      case 'hook-post-compact': {
        const hooks = require('./lib/hooks.js')
        const handler = hooks[`hook${cmd.replace('hook-', '').replace(/-(\w)/g, (m, c) => c.toUpperCase())}`]
        if (handler) handler()
        else console.error(`Unknown hook: ${cmd}`)
        break
      }

      // ── Status & navigation ──────────────────────────────────────────────
      case 'status':
        displayStatus(state)
        break

      case 'states':
        console.log('\nAll states:\n')
        Object.entries(STATES).forEach(([k, v]) => {
          const t = TRANSITIONS[k]
          console.log(`  ${v.manual ? '⏸ ' : '🔄'} ${k.padEnd(22)} → ${t?.next?.padEnd(22) || 'END'.padEnd(22)} [${t?.agent}]`)
        })
        console.log()
        break

      case 'advance': {
        const force = args.includes('--force') || args.includes('-f')

        // ── [v1.0 Harness B] 物理阻斷：AUTO 狀態前置條件不滿足時禁止推進 ──────
        // MANUAL 狀態不做強制校驗（用戶確認本身就是 gate）
        const isManual = STATES[state.currentState]?.manual
        if (!isManual) {
          const nextTarget = TRANSITIONS[state.currentState]?.next
          if (nextTarget) {
            // [v1.5.1] In skip modes, check prereqs for actual destination, not skipped states
            const _skipStates = state.mode === 'hotfix' ? HOTFIX_SKIP_STATES
                              : state.mode === 'feature' ? FEATURE_SKIP_STATES : null
            let checkTarget = nextTarget
            if (_skipStates && _skipStates.includes(nextTarget)) {
              let t = nextTarget
              while (_skipStates.includes(t)) {
                const _next = TRANSITIONS[t]?.next
                if (!_next) break
                t = _next
              }
              checkTarget = t
            }
            const prereqCheck = checkPrereqs(checkTarget)
            if (!prereqCheck.ok) {
              appendTrace({
                type: 'prereq_block',
                payload: { from: state.currentState, to: checkTarget, missing: prereqCheck.missing },
              }, state)
              console.error(`\n🚫 [harness gate] 無法推進：前置條件未滿足`)
              console.error(`   ${state.currentState} → ${checkTarget}`)
              prereqCheck.missing.forEach(f => {
                console.error(`   缺失：${f}`)
                const hint = PREREQ_HINTS[f]
                if (hint) {
                  console.error(`          → 产出者: ${hint.producer} (在 ${hint.state} 阶段)`)
                  console.error(`          → 修复: ${hint.fix}`)
                }
              })
              console.error(`\n   請先完成以上文件，完成後重新運行 advance`)
              console.error(`   （如需強制跳過，僅 MANUAL 節點支持 --force）`)
              process.exit(1)
            }
          }
        }

        // ── [v1.5] 硬文档验证门禁：文件存在但内容不合格时阻断 ────────────────
        const validators = ARTIFACT_VALIDATORS_FOR_STATE[state.currentState] || []
        if (validators.length > 0) {
          const failures = []
          for (const vKey of validators) {
            const vResult = validateDoc(vKey, true)
            if (!vResult.ok && !vResult.missing) {
              const failed = vResult.results.filter(r => !r.passed).map(r => r.name)
              failures.push({ doc: vKey, failed })
            }
          }
          if (failures.length > 0) {
            appendTrace({
              type: 'doc_validation_block',
              payload: { state: state.currentState, failures },
            }, state)
            console.error(`\n🚫 [harness gate] 文档内容验证未通过`)
            console.error(`   当前状态: ${state.currentState}`)
            failures.forEach(f => {
              console.error(`   📋 ${f.doc}:`)
              f.failed.forEach(name => console.error(`     ❌ ${name}`))
            })
            console.error(`\n   修复文档后重新运行 advance`)
            console.error(`   手动检查: node scripts/workflow.js validate-doc <key>`)
            process.exit(1)
          }
        }

        const prevState      = state.currentState
        const prevStateEnteredMs = Date.now()  // [v1.0 P1.4] 计时起点
        state = advance(state, force)

        // ── [v1.1] 首次 advance（IDEA → PRD_DRAFT）分配 taskId ───────────────
        if (prevState === 'IDEA' && !state.taskId) {
          state = startTask(state)
        }

        // ── [v1.0] PRD_DRAFT → PRD_REVIEW 時清理需求注入文件 ──────────────────
        if (prevState === 'PRD_DRAFT' && state.currentState === 'PRD_REVIEW') {
          const requirementPath = path.join(ROOT, 'state/autopilot-requirement.md')
          if (fs.existsSync(requirementPath)) {
            fs.unlinkSync(requirementPath)
            console.log('🧹 已清理需求注入文件：state/autopilot-requirement.md')
          }
          state.requirementInjected = false
        }

        // ── [v1.0 Harness D] 狀態推進後更新産出物完整性指紋 ──────────────────
        state = snapshotArtifacts(state)

        // ── [v1.0 P1.4] 記錄 advance 到 trace（帶耗時）────────────────────────────
        const durationMs = Date.now() - prevStateEnteredMs

        // ── [v1.0 P1.5] 估算 token 成本 ─────────────────────────────────────────
        let costEstimate = null
        if (state.contextBudget?.actualTokens > 0) {
          const tierOrModel = AGENT_MODEL_MAP[state.contextBudget.agentName]
          const costPerMillion = COST_PER_MILLION[tierOrModel] || MODEL_COSTS[tierOrModel] || 9.0
          const tokens = state.contextBudget.actualTokens
          costEstimate = {
            agentName: state.contextBudget.agentName,
            tokens,
            costPerMillion,
            estimatedCost: (tokens / 1_000_000) * costPerMillion,
          }
        }

        appendTrace({
          type: 'advance',
          payload: { from: prevState, to: state.currentState, mode: state.mode },
          durationMs,
          costEstimate,
        }, state)

        saveState(state)
        console.log(`✅ Advanced to: ${state.currentState}`)

        // ── [v1.1] 到达 DONE 时自动归档 ─────────────────────────────────────
        if (state.currentState === 'DONE') {
          const archResult = archiveCurrentTask(state)
          if (archResult && !archResult.skipped) {
            console.log(`📦 任务已归档: ${archResult.taskId}`)
          }
        }

        displayStatus(state)
        break
      }

      case 'rollback': {
        const target = args[0]
        if (!target) { console.error('Usage: rollback <STATE>'); process.exit(1) }
        const prevState = state.currentState
        const { state: newState, cleaned } = rollback(state, target)

        // [v1.0 Harness D] 回滾後重新計算指紋（被清理的文件指紋也一併清除）
        const rolledBack = snapshotArtifacts(newState)

        // [v1.0 Harness E] 記錄 rollback 到 trace
        appendTrace({
          type: 'rollback',
          payload: { from: prevState, to: target, cleaned },
        }, rolledBack)

        saveState(rolledBack)
        console.log(`⏪ Rolled back to: ${target}`)
        if (cleaned.length > 0) console.log(`🗑  Cleaned: ${cleaned.join(', ')}`)
        displayStatus(rolledBack)
        break
      }

      case 'reset': {
        // ── [v1.1] 归档当前任务后再清空 ─────────────────────────────────────
        const archResult = archiveCurrentTask(state)
        if (archResult && !archResult.skipped) {
          console.log(`📦 已归档: ${archResult.taskId}`)
        }
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
          taskId: null,
          taskStartedAt: null,
          createdAt: new Date().toISOString(),
        }
        saveState(fresh)
        console.log('♻️  Reset to IDEA (greenfield mode)')
        break
      }

      // init — 全局安装 claude-harness 到 ~/.claude/
      case 'init': {
        installGlobal({ force: false })
        console.log('\n✅ claude-harness installed!')
        console.log('   Next: node scripts/workflow.js status')
        break
      }

      // [v1.0] Autopilot mode — 全流程自動，無需人為干預確認
      // [v1.0] 支持需求描述參數注入 + hotfix 模式
      case 'init-autopilot': {
        const STATE_DIR = path.join(ROOT, 'state')

        // 解析參數：[mode] [requirement...]
        let mode = 'greenfield'
        let requirement = null

        if (args.length > 0) {
          if (args[0] === 'greenfield' || args[0] === 'feature' || args[0] === 'hotfix') {
            mode = args[0]
            requirement = args.slice(1).join(' ')
          } else {
            // 第一個參數不是模式，則整個作為需求描述
            requirement = args.join(' ')
          }
        }

        // 如果有需求描述，寫入注入文件
        if (requirement && requirement.trim()) {
          if (!fs.existsSync(STATE_DIR)) fs.mkdirSync(STATE_DIR, { recursive: true })
          const requirementPath = path.join(STATE_DIR, 'autopilot-requirement.md')
          const content = `# Autopilot 初始需求

> 由 autopilot 命令注入，供 product-manager agent 讀取

**模式**: ${mode}
**創建時間**: ${new Date().toISOString()}
**需求描述**:

${requirement.trim()}

---
*此文件由 /autopilot 自動生成，請勿手動修改*
`
          fs.writeFileSync(requirementPath, content)
          console.log(`✅ 需求已注入：state/autopilot-requirement.md`)
        }

        state.autopilot = true
        if (mode === 'feature') {
          const hasArch = fs.existsSync(path.join(ROOT, 'docs/arch-decision.md'))
          if (!hasArch) {
            console.error('\n❌ docs/arch-decision.md 不存在')
            console.error('   autopilot feature 模式需要現有項目已完成 Architect 階段')
            console.error('   如果是全新項目，請使用：node scripts/workflow.js init-autopilot greenfield "<需求描述>"')
            process.exit(1)
          }
          state.mode = 'feature'
        } else if (mode === 'hotfix') {
          state.mode = 'hotfix'
        } else {
          state.mode = 'greenfield'
        }
        state.requirementInjected = !!requirement
        state.history.push({
          from: state.currentState, to: state.currentState,
          timestamp: new Date().toISOString(), agent: 'system', type: 'init-autopilot',
          note: `Autopilot mode enabled (${state.mode})${requirement ? ' + requirement injected' : ''}`,
        })
        saveState(state)
        console.log('\n🤖 Autopilot 模式已啟動')
        console.log(`   模式：${state.mode}`)
        console.log('   MANUAL 節點將自動推進，無需人為確認')
        if (state.mode === 'feature') {
          console.log(`   自動跳過：${FEATURE_SKIP_STATES.join(' → ')}`)
        }
        if (state.mode === 'hotfix') {
          console.log(`   自動跳過：${HOTFIX_SKIP_STATES.join(' → ')}`)
        }
        console.log('\n   下一步：node scripts/workflow.js advance')
        console.log('   停止：node scripts/workflow.js stop-autopilot')
        displayStatus(state)
        break
      }

      case 'stop-autopilot': {
        state.autopilot = false
        state.history.push({
          from: state.currentState, to: state.currentState,
          timestamp: new Date().toISOString(), agent: 'system', type: 'stop-autopilot',
        })
        saveState(state)
        console.log('\n⏹  Autopilot 模式已停止')
        console.log('   後續 MANUAL 節點需要用戶確認')
        displayStatus(state)
        break
      }

      // [v1.0 P1.4] Feature mode — 在現有項目上添加新功能，跳過 Arch/Design 階段
      case 'init-feature': {
        const hasArch = fs.existsSync(path.join(ROOT, 'docs/arch-decision.md'))
        if (!hasArch) {
          console.error('\n❌ docs/arch-decision.md 不存在')
          console.error('   feature 模式需要現有項目已完成 Architect 階段（arch-decision.md）')
          console.error('   如果是全新項目，請使用完整流程：node scripts/workflow.js advance')
          process.exit(1)
        }
        state.mode = 'feature'
        state.currentState = 'IDEA'
        state.qaFailureCount = 0
        state.parallelProgress = { FE: false, BE: false }
        state.contextBudget = null
        state.history.push({
          from: state.currentState, to: 'IDEA',
          timestamp: new Date().toISOString(), agent: 'system', type: 'init-feature',
          note: 'Feature mode: auto-skips ARCH_REVIEW, CEO_REVIEW, DESIGN_PHASE, DESIGN_REVIEW',
        })
        saveState(state)
        console.log('\n✅ Feature 模式已啟動')
        console.log('   現有產出物已保留（arch-decision.md、design/ 等）')
        console.log(`   自動跳過：${FEATURE_SKIP_STATES.join(' → ')}`)
        console.log('   實際路徑：IDEA → PRD_DRAFT* → PRD_REVIEW → IMPLEMENTATION → CODE_REVIEW → QA_PHASE* → DONE')
        console.log('\n   PM 將生成 Feature PRD（範圍更窄，只描述本次新增/修改功能）')
        console.log('   下一步：node scripts/workflow.js advance')
        displayStatus(state)
        break
      }

      // [v1.0 P1.1] Hotfix 模式 — 緊急修復，跳過設計/實現階段
      // [v1.0] 支持需求描述參數注入
      case 'init-hotfix': {
        const STATE_DIR = path.join(ROOT, 'state')

        // 解析參數：[requirement...]
        const requirement = args.join(' ').trim() || null

        // 如果有需求描述，寫入注入文件
        if (requirement) {
          const requirementPath = path.join(STATE_DIR, 'autopilot-requirement.md')
          const content = `# Autopilot 初始需求

> 由 hotfix 命令注入，供 product-manager agent 讀取

**模式**: hotfix
**創建時間**: ${new Date().toISOString()}
**需求描述**:

${requirement}

---
*此文件由 /hotfix 自動生成，請勿手動修改*
`
          if (!fs.existsSync(STATE_DIR)) fs.mkdirSync(STATE_DIR, { recursive: true })
          fs.writeFileSync(requirementPath, content)
          state.requirementInjected = true
        }

        state.mode = 'hotfix'
        state.autopilot = true   // hotfix 默認啟用 autopilot（快速通過 MANUAL 節點）
        state.currentState = 'IDEA'
        state.qaFailureCount = 0
        state.parallelProgress = { FE: false, BE: false }
        state.contextBudget = null
        state.history.push({
          from: state.currentState, to: 'IDEA',
          timestamp: new Date().toISOString(), agent: 'system', type: 'init-hotfix',
          note: `Hotfix mode: auto-skips ${HOTFIX_SKIP_STATES.join(', ')}`,
        })
        saveState(state)
        console.log('\n✅ Hotfix 模式已啟動')
        console.log(`   自動跳過：${HOTFIX_SKIP_STATES.join(' → ')}`)
        console.log('   實際路徑：IDEA → PRD_DRAFT* → PRD_REVIEW → CODE_REVIEW → QA_PHASE* → SECURITY_REVIEW → DEPLOY_PREP* → DONE')
        console.log('\n   🤖 Autopilot 已啟用（自動推進 MANUAL 節點）')
        if (requirement) {
          console.log(`   📝 需求已注入：${requirement.slice(0, 60)}${requirement.length > 60 ? '...' : ''}`)
        }
        console.log('\n   下一步：node scripts/workflow.js advance')
        displayStatus(state)
        break
      }

      case 'history': {
        const hist = state.history || []
        console.log(`\nWorkflow history (${hist.length} entries):\n`)
        hist.forEach((h, i) => {
          const icon = h.type === 'rollback' ? '⏪' : h.type === 'security-reaudit' ? '🔒' : h.type === 'manual' ? '⏸' : '→'
          console.log(`  ${String(i+1).padStart(3)}. ${h.from?.padEnd(22)} ${icon} ${h.to?.padEnd(22)} [${h.agent}] ${h.timestamp?.slice(0,10)}`)
          if (h.cleanedArtifacts?.length > 0) console.log(`        🗑  cleaned: ${h.cleanedArtifacts.join(', ')}`)
        })
        console.log()
        break
      }

      // ── Checks & validation ──────────────────────────────────────────────
      case 'check': {
        const target = args[0] || TRANSITIONS[state.currentState]?.next
        if (!target) { console.log('No next state'); break }
        const result = checkPrereqs(target)
        if (result.ok) { console.log(`✅ All prerequisites met for ${target}`) }
        else { console.log(`❌ Missing for ${target}:`); result.missing.forEach(f => console.log(`   - ${f}`)); process.exit(1) }
        break
      }

      case 'validate-doc': {
        const docKey = args[0]
        console.log(`\n📋 Validating: ${docKey}\n`)
        const result = validateDoc(docKey)
        console.log(result.ok ? '\n✅ 文档验证通过' : '\n❌ 文档验证失败')
        if (!result.ok) process.exit(1)
        break
      }

      case 'sync-check': {
        console.log('\n🔍 文件镜像一致性检查\n')
        const syncResult = syncCheck()
        if (syncResult.ok) {
          console.log('✅ 文件镜像完全一致（scripts/ ↔ plugins/, agents/, skills/）')
        } else {
          console.log(`❌ 发现 ${syncResult.diffs.length} 处不一致:\n`)
          for (const d of syncResult.diffs) {
            const icon = d.status === 'modified' ? '📝' : d.status === 'src-only' ? '➕' : d.status === 'dst-only' ? '➖' : '⚠️'
            console.log(`   ${icon} [${d.status}] ${d.file}`)
          }
          console.log('\n   同步命令（根据实际修改方向选择）:')
          console.log('   根→插件: rsync -av --delete scripts/ plugins/claude-harness/scripts/ --exclude bump-version.js')
          console.log('            rsync -av .claude/agents/ plugins/claude-harness/agents/')
          console.log('            rsync -av .claude/skills/ plugins/claude-harness/skills/')
          console.log('   插件→根: rsync -av --delete plugins/claude-harness/scripts/ scripts/ --exclude bump-version.js')
          console.log('            rsync -av plugins/claude-harness/agents/ .claude/agents/')
          console.log('            rsync -av plugins/claude-harness/skills/ .claude/skills/')
          process.exit(1)
        }
        break
      }

      // ── [v1.1] Task archive commands ────────────────────────────────────────
      case 'task-list':    { const { cmdTaskList }    = require('./lib/commands/archive.js'); cmdTaskList(args);    break }
      case 'task-show':    { const { cmdTaskShow }    = require('./lib/commands/archive.js'); cmdTaskShow(args);    break }
      case 'task-cat':     { const { cmdTaskCat }     = require('./lib/commands/archive.js'); cmdTaskCat(args);     break }
      case 'task-diff':    { const { cmdTaskDiff }    = require('./lib/commands/archive.js'); cmdTaskDiff(args);    break }
      case 'task-restore': { const { cmdTaskRestore } = require('./lib/commands/archive.js'); cmdTaskRestore(args); break }
      case 'task-cost':    { const { cmdTaskCost }    = require('./lib/commands/archive.js'); cmdTaskCost(args);    break }

      case 'check-code': {
        const role   = args[0]?.toUpperCase()
        const result = checkCodeOutputs(role)
        if (result.ok) { console.log(`✅ ${role} outputs verified (${result.totalFiles} files)`) }
        else { console.log(`❌ ${role} missing:`); result.missing.forEach(f => console.log(`   - ${f}`)); process.exit(1) }
        break
      }

      case 'verify-code': {
        const role   = args[0]?.toUpperCase()
        const result = await fullVerify(role)
        console.log(result.ok ? `\n✅ ${role} verification passed` : `\n❌ ${role} verification FAILED`)
        if (!result.ok) process.exit(1)
        break
      }

      case 'integration-check': {
        const result = runIntegrationCheck()
        console.log(result.ok ? '\n✅ 联调检查通过' : '\n❌ 联调检查失败')
        if (!result.ok) process.exit(1)
        break
      }

      case 'smoke-test': {
        const result = await runSmokeTest()
        console.log(result.ok ? '\n✅ Smoke test 通过' : '\n❌ Smoke test 失败')
        if (!result.ok) process.exit(1)
        break
      }

      case 'check-parallel-done': {
        // [v1.0 deprecated] DESIGN_REVIEW 已改为 fullstack-engineer 单 Agent，无需并行完成检测
        // fullstack agent 完成后直接调用 `node scripts/workflow.js advance`
        console.log('⚠️  [deprecated] check-parallel-done 已废弃（DESIGN_REVIEW 现为单 fullstack-engineer）')
        console.log('   fullstack agent 完成后请直接调用：node scripts/workflow.js advance')
        // 为向后兼容，保持退出码 0
        break
      }

      case 'qa-failure': {
        const { state: newState, cleaned, escalated } = handleQaFailure(state)
        saveState(newState)
        if (cleaned.length > 0) console.log(`🗑  Cleaned: ${cleaned.join(', ')}`)
        if (escalated) console.log('⚠️  Escalated to ARCH_REVIEW')
        displayStatus(newState)
        break
      }

      case 'design-baseline': {
        generateDesignBaseline()
        break
      }

      case 'security-verify-fix': {
        verifySecurityFix()
        break
      }

      case 'security-reaudit': {
        state = triggerSecurityReaudit(state)
        saveState(state)
        displayStatus(state)
        break
      }

      // ── Context lifecycle ────────────────────────────────────────────────────
      case 'track-context': {
        const agentName = args[0]
        const opType    = args[1] // 'bash' | 'write'
        if (!agentName || !opType) { console.error('Usage: track-context <agent> <bash|write>'); process.exit(1) }
        const result = trackContext(agentName, opType)
        const icon   = result.critical ? '🔴' : result.warning ? '🟡' : '🟢'
        console.log(`${icon} Context[${agentName}]: ~${Math.round(result.usageRatio * 100)}% (bash:${result.bashCount} write:${result.writeCount} ~${result.estimatedTokens} tokens)`)
        if (result.critical) {
          console.log(`\n⚠️  超过强制重读阈值！重读核心文档：`)
          const CONTEXT_BUDGET = require('./lib/config.js').CONTEXT_BUDGET
          const docs = CONTEXT_BUDGET.CRITICAL_DOCS[agentName] || []
          docs.forEach((d, i) => console.log(`  ${i + 1}. Read ${d}`))
        }
        break
      }

      case 'reset-context': {
        const agentName = args[0]
        if (!agentName) { console.error('Usage: reset-context <agent>'); process.exit(1) }
        resetContextBudget(agentName)
        console.log(`✅ Context budget reset for ${agentName}`)
        break
      }

      case 'context-status': {
        const budget = state.contextBudget
        if (!budget) { console.log('ℹ️  Context tracking not active (no agent running or already reset)'); break }
        const estimated = budget.bashCount * 1000 + budget.writeCount * 500
        const ratio = estimated / 180000
        const CONTEXT_BUDGET = require('./lib/config.js').CONTEXT_BUDGET
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
        break
      }

      // ── Agent Teams commands ──────────────────────────────────────────────
      case 'check-agent-teams': {
        const { checkAgentTeamsEnabled } = require('./lib/hooks.js')
        const teamsEnabled = checkAgentTeamsEnabled()
        console.log(teamsEnabled
          ? `✅ Agent Teams 已启用（路径 A：原生 TeamCreate/TaskCreate/SendMessage）`
          : `📝 Agent Teams 未启用（路径 B：文件轮询降级模式 review-notes.md）`)
        break
      }

      case 'generate-team-dispatch': {
        console.log(`\n⚠️  Agent Teams dispatch 已废弃（v14.3+）`)
        console.log(`   DESIGN_REVIEW 现使用 fullstack-engineer 单 agent，无需并行团队调度。`)
        console.log(`   如需文件通知机制，可使用 fallback-notify 命令。\n`)
        break
      }

      case 'fallback-notify': {
        // 调用 lib/install.js 中的 fallbackNotify（如果存在）
        const install = require('./lib/install.js')
        if (install.fallbackNotify) {
          const [from, to, ...msgParts] = args
          const message = msgParts.join(' ')
          if (!from || !to || !message) {
            console.error('Usage: fallback-notify <from> <to> "<message>"')
            console.error('Example: fallback-notify be fe "api-spec 已更新至 v1.1。变更：新增 GET /users/me 端点。"')
            process.exit(1)
          }
          install.fallbackNotify(from, to, message)
        } else {
          console.error('fallback-notify 已移至 lib/install.js，请使用命令：node scripts/lib/hooks.js hook-post-write')
          console.error('Agent Teams 启用时此命令会报错')
          process.exit(1)
        }
        break
      }

      // ── Global install commands ─────────────────────────────────────────────
      case 'install-global': {
        const force  = args.includes('--force')
        const dryRun = args.includes('--dry-run')
        installGlobal({ force, dryRun })
        break
      }

      case 'check-global':
        checkGlobal()
        break

      case 'update-global':
        updateGlobal()
        break

      case 'uninstall-global':
        uninstallGlobal()
        break

      case 'init-project': {
        const targetDir = args[0]
        initProject(targetDir)
        break
      }

      // ── [v1.0 Harness A] Agent 結果協議 ──────────────────────────────────────
      case 'write-agent-result': {
        // 用法：node scripts/workflow.js write-agent-result '{"status":"success","artifactsProduced":["docs/api-spec.md"],"nextAction":"advance"}'
        // status: success | partial | failed | blocked
        // nextAction: advance | check | fix-blockers | rerun
        const resultJson = args[0]
        if (!resultJson) {
          console.error('Usage: write-agent-result \'{"status":"success","artifactsProduced":[...],"nextAction":"advance"}\'')
          process.exit(1)
        }
        try {
          const result = JSON.parse(resultJson)
          result.agentName = result.agentName || state.contextBudget?.agentName || 'unknown'
          writeAgentResult(result)
          appendTrace({ type: 'agent_result', payload: result }, state)
          console.log(`✅ Agent 結果已記錄：${result.status} [${result.agentName}]`)
          if (result.artifactsProduced?.length > 0) {
            console.log(`   産出物：${result.artifactsProduced.join(', ')}`)
          }
          if (result.status === 'success' && result.nextAction === 'advance') {
            console.log(`   建議下一步：node scripts/workflow.js advance`)
          } else if (result.status === 'blocked') {
            console.log(`   阻塞原因：${result.blockingReason || '未說明'}`)
          }
        } catch (e) {
          console.error(`❌ JSON 解析失敗：${e.message}`)
          process.exit(1)
        }
        break
      }

      // ── [v1.0 Harness E] Structured Trace 摘要 ───────────────────────────
      case 'trace-summary': {
        if (!fs.existsSync(TRACE_LOG)) {
          console.log('\n📊 trace.jsonl 為空，運行 advance/rollback 等操作後再查看\n')
          break
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
        break
      }

      // ── [v1.0 P1.4] Per-phase timing summary ────────────────────────────────
      case 'trace-timing': {
        if (!fs.existsSync(TRACE_LOG)) {
          console.log('\n⏱  trace.jsonl 為空，運行 advance 後再查看耗時\n')
          break
        }
        const rawLines = fs.readFileSync(TRACE_LOG, 'utf8').trim().split('\n').filter(Boolean)
        const events = rawLines
          .map(l => { try { return JSON.parse(l) } catch { return null } })
          .filter(Boolean)
          .filter(e => e.eventType === 'advance' && e.durationMs)

        if (events.length === 0) {
          console.log('\n⏱  無 advance 耗時數據（需升級到 v15.2）\n')
          break
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
        break
      }

      // ── [v1.0 P1.5] Per-phase cost summary ────────────────────────────────
      case 'trace-cost': {
        if (!fs.existsSync(TRACE_LOG)) {
          console.log('\n💰 trace.jsonl 為空，運行 advance 後再查看成本\n')
          break
        }
        const rawLines = fs.readFileSync(TRACE_LOG, 'utf8').trim().split('\n').filter(Boolean)
        const events = rawLines
          .map(l => { try { return JSON.parse(l) } catch { return null } })
          .filter(Boolean)
          .filter(e => e.eventType === 'advance' && e.costEstimate)

        if (events.length === 0) {
          console.log('\n💰 無成本估算數據（需升級到 v15.2）\n')
          break
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
        break
      }

      // ── Context store ───────────────────────────────────────────────────────
      case 'set-context': {
        const [key, ...valueParts] = args
        state.context = state.context || {}
        state.context[key] = valueParts.join(' ')
        saveState(state)
        console.log(`✅ context.${key} = "${state.context[key]}"`)
        break
      }

      case 'get-context': {
        const key = args[0]
        console.log(key ? (state.context?.[key] ?? '(not set)') : JSON.stringify(state.context || {}, null, 2))
        break
      }

      // ── Logging & misc ────────────────────────────────────────────────────────
      case 'log-agent': {
        appendAgentLog(args.join(' '))
        console.log('✅ Logged')
        break
      }

      case 'git-diff-base':
        console.log(getGitDiffBase())
        break

      case 'migrate-state':
        saveState(state)
        console.log(`✅ Migrated to schema v${SCHEMA_VERSION}`)
        break

      default:
        console.log(`
Claude Workflow — State Machine CLI v${SCHEMA_VERSION}

[v1.0] P0/P1 架构优化已完成：
  P0.1: SessionStart hook + hookPostCompact — context 压缩后自动重注入关键文档
  P0.2: Hook 自动追踪 context — 从"荣誉制度"改为基础设施强制执行
  P1.1: Agent Teams 路径 A 检测强化 + settings.json env 块支持
  P1.2: 模型分级差异化 — Opus > Sonnet > Haiku 按任务复杂度分配
  P1.3: workflow.js 拆分 — 从 1782 行拆分为 5 个 lib 模块

HOOK COMMANDS (auto-triggered by .claude/settings.json):
  hook-post-write   PostToolUse[Write/Edit]: validate docs, detect FE/BE progress, notify Agent Teams
  hook-post-bash    PostToolUse[Bash]: detect build completion, log activity, auto-track context [v1.0]
  hook-pre-write    PreToolUse[Write]: block writes to state files
  hook-pre-bash     PreToolUse[Bash]: block dangerous commands
  hook-stop         Stop: workflow summary + context budget check + comm mode status
  hook-post-compact SessionStart[matcher:"compact"]: P0.1 — context 压缩后强制重注入

WORKFLOW NAVIGATION:
  status                          Current state + prereqs + context budget
  states                          List all states
  advance [--force]               Advance (--force for MANUAL nodes)
  rollback <STATE>                Roll back + clean artifacts
  reset                           Reset to IDEA
  history                         Full history

CHECKS & VALIDATION:
  check [STATE]                   Verify prereqs
  validate-doc <prd|arch|security-baseline|design-spec|interaction-spec|api-spec|traceability|test-report|deploy-plan|ceo-review>
  check-code <FE|BE>              Check code outputs exist
  verify-code <FE|BE>             Build + lint + typecheck (live output)
  check-parallel-done             [deprecated] 旧并行模式，fullstack agent 直接 advance
  integration-check               Static: mock, API client, routes, env, tokens

STATE MUTATIONS:
  update-progress <role> [bool]   [deprecated] 旧并行模式标记，fullstack agent 无需调用
  qa-failure                      QA failure + auto-rollback (2× → ARCH_REVIEW)
  security-reaudit                Re-enter SECURITY_REVIEW after fixes
  security-verify-fix             Verify all Finding IDs have fix records
  design-baseline                 Generate design baseline screenshot manifest

[v1.0] CONTEXT LIFECYCLE (已优化，P0.2）:
  track-context <agent> <bash|write>   Track context consumption (now auto-tracked by hooks)
  reset-context <agent>                Reset budget (call when agent starts fresh)
  context-status                       Show current context health

[v1.0] AGENT TEAMS — P1.1 改进：
  check-agent-teams               Detect current path (A=native / B=fallback)
  generate-team-dispatch          [deprecated] Use fullstack-engineer instead
  fallback-notify <from> <to> <message>  Append to review-notes.md (path B only)

[v1.0] MODEL CONFIG (P1.2 — 差异化已应用）：
  [v1.0] 模型配置：scripts/lib/config.js → AGENT_MODEL_MAP

  TIER_HEAVY    PM/Architect/Designer — 深度推理（默认 Sonnet，可升级 Opus）
  TIER_STANDARD  FE/BE/QA/DevOps/Reviewer — 主力实现（默认 Sonnet）
  TIER_FAST     Orchestrator/General — 快速路由/修复（默认 Haiku，成本优化）
  TIER_AUDIT    Security Auditor — 只读审计（默认 Haiku，成本优化）

  配置原则：
  - 成本优先级：haiku < sonnet < opus
  - 性能优先级：opus > sonnet > haiku
  - 建议配置（根据预算/质量要求选择）

  agent → tier 映射：
    product-manager        : TIER_HEAVY
    software-architect  : TIER_HEAVY
    ux-designer         : TIER_HEAVY
    plan-ceo-review      : TIER_FAST     [v1.0] 新增
    frontend-engineer    : TIER_STANDARD
    backend-engineer     : TIER_STANDARD
    code-reviewer       : TIER_STANDARD
    qa-engineer         : TIER_STANDARD
    devops-engineer      : TIER_STANDARD
    workflow-orchestrator: TIER_FAST
    general-assistant   : TIER_FAST
    security-auditor   : TIER_AUDIT

[v1.0] 修改 AGENT_MODEL_MAP 后执行：
  node scripts/workflow.js install-global --force

[v1.0] 代码结构优化（P1.3）：
  scripts/lib/state.js      — IO + Context Budget + 迁移（~300 行）
  scripts/lib/verify.js    — 文档校验 + 构建/集成检查（~400 行）
  scripts/lib/hooks.js     — 所有 Hook 处理器（~400 行）
  scripts/lib/install.js    — 全局安装 + init-project（~300 行）
  scripts/lib/config.js    — 单一真相来源（~700 行）
  scripts/workflow.js      — 精简 CLI 路由器（~500 行，从 1782 行减少）

[GLOBAL INSTALL]:
  init                            Install claude-harness to ~/.claude/ (shortcut for install-global)
  install-global [--force] [--dry-run]  Install agents+skills to ~/.claude/
  check-global                    Verify global install status
  update-global                   Incremental update of global install
  uninstall-global                Remove global install
  init-project <dir>              Init new project — interactive tech stack selection [v13.1]
  init-feature                    Start feature mode on existing project — skips arch/design phases [v1.0]
  init-hotfix                     Start hotfix mode — skips arch/design/impl phases, goes straight to code review [v1.0 P1.1]

[v1.0] AUTOPILOT — 全流程自動模式：
  init-autopilot [greenfield|feature|hotfix] "<需求描述>"  啟用 autopilot 模式 + 需求注入 [v1.0 hotfix]
  stop-autopilot                                  停止 autopilot 模式
  /autopilot <需求描述>                           調用 autopilot 技能開始全流程自動執行

  示例：
    /autopilot 構建一個用戶認證系統，支持郵箱註冊、登錄
    node scripts/workflow.js init-autopilot greenfield "構建待辦事項應用"
    node scripts/workflow.js init-autopilot feature "添加頭像上傳功能"

[HARNESS v14.3]:
  write-agent-result <json>       Record agent result protocol (A): status/artifactsProduced/nextAction
  trace-summary                   Show structured trace audit log (E): event breakdown + recent events
  trace-timing                    Show per-phase timing summary from trace log [v1.0 P1.4]
  trace-cost                     Show per-phase cost estimate summary [v1.0 P1.5]

MISC:
  log-agent <json>                Append to agent-log.jsonl
  git-diff-base                   Correct git diff base (with fallback)
  migrate-state                   Upgrade state.json schema to v${SCHEMA_VERSION}
`)
    }
  } catch (err) {
    appendErrorLog(err)
    console.error(`❌ ${err.message}`)
    process.exit(1)
  }
}

if (require.main === module) main().catch(err => { console.error(err); process.exit(1) })
