'use strict'
/**
 * hooks.js — v14.4
 *
 * 职责：所有 Hook 处理器
 *   - hookPostWrite   文档校验 + FE/BE 并行检测（P0.3 原子写）+ api-spec 变更通知
 *   - hookPostBash    构建检测 + 自动 context 追踪（P0.2）
 *   - hookPostRead    Read 操作 context 追踪（P0.1 新增）
 *   - hookPreWrite    写入防护（禁止写 state 文件）
 *   - hookPreBash     危险命令拦截
 *   - hookStop        状态摘要 + context 检查 + Agent Teams 状态
 *   - hookPostCompact context 压缩后强制重注入核心文档
 *
 * v14.4 更新：
 *   - 使用 errors.js 标准化错误码
 *
 * v14.1 修复：
 *   P0.1: hookPostRead 追踪 Read 操作（Read 大文件是 context 消耗大户）
 *   P0.3: hookPostWrite FE/BE 并行进度更新改用 atomicUpdateState（消除竞态）
 *   P1.4: hookPostBash 构建检测改用 FE_PATH_PREFIX/BE_PATH_PREFIX 常量
 *   P1.5: 新增 CLI dispatch（settings.json 直接调用 node scripts/lib/hooks.js）
 *
 * 依赖：
 *   - state.js：loadState / saveState / atomicUpdateState / autoTrackContext / checkContextBudget
 *   - verify.js：checkPrereqs / validateDoc
 *   - config.js：ARTIFACT_STATE_MAP / STATES / TRANSITIONS / DANGEROUS_BASH_PATTERNS
 *                AGENT_TEAMS_CONFIG / FE_PATH_PREFIX / BE_PATH_PREFIX
 *   - errors.js：HookError
 */

const fs   = require('fs')
const path = require('path')

const {
  loadState, saveState, atomicUpdateState, autoTrackContext, checkContextBudget, appendAgentLog,
  ROOT, appendTrace, readAgentResult,          // [v1.0.3 Harness A/E]
  readCheckpoint, readWorkQueue,               // [v1.0.4 Context]
} = require('./state.js')

const {
  checkPrereqs, validateDoc,
} = require('./verify.js')

const {
  ARTIFACT_STATE_MAP, STATES, TRANSITIONS, DANGEROUS_BASH_PATTERNS,
  AGENT_TEAMS_CONFIG, FE_PATH_PREFIX, BE_PATH_PREFIX,
  AGENT_WRITE_PERMISSIONS,              // [v1.0] 全 Agent 写入权限白名单
} = require('./config.js')

// errors.js not needed — hooks use process.exit(2) directly for Claude Code hook protocol

// ─── Hook Input ───────────────────────────────────────────────────────────

function readHookInput() {
  try {
    const raw = fs.readFileSync('/dev/stdin', 'utf8')
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

// ─── PostWrite Hook ───────────────────────────────────────────────────────

function hookPostWrite() {
  const event   = readHookInput()
  const filePath = event?.tool_input?.path || ''
  const relPath  = path.relative(ROOT, path.isAbsolute(filePath) ? filePath : path.join(ROOT, filePath))
  const state    = loadState()
  const messages = []

  // 1. Auto-validate documents
  const artifactInfo = ARTIFACT_STATE_MAP[relPath]
  if (artifactInfo?.validatorKey) {
    const result = validateDoc(artifactInfo.validatorKey, true)
    if (!result.missing) {
      if (result.ok) {
        messages.push(`✅ [auto-validate] ${relPath}: 文档验证通过`)
        appendAgentLog({ agent: 'hook', action: 'auto-validate', file: relPath, validator: artifactInfo.validatorKey, result: 'PASS' })
      } else {
        const failed = result.results.filter(r => !r.passed).map(r => r.name)
        messages.push(`⚠️  [auto-validate] ${relPath}: ${failed.length} 项验证未通过`)
        messages.push(`   未通过：${failed.join(', ')}`)
        messages.push(`   运行 \`node scripts/workflow.js validate-doc ${artifactInfo.validatorKey}\` 查看详情`)
        appendAgentLog({ agent: 'hook', action: 'auto-validate', file: relPath, validator: artifactInfo.validatorKey, result: 'FAIL', failed })
      }
    }
  }

  // 2. [v11.1] api-spec 变更通知（两路分离）
  if (relPath === 'docs/api-spec.md' && state.currentState === 'DESIGN_REVIEW') {
    if (checkAgentTeamsEnabled()) {
      // 路径 A：提示 BE 使用原生 SendMessage，不写文件
      messages.push(`📡 [v11.1 Agent Teams] api-spec.md 已更新。`)
      messages.push(`   BE teammate 应立即调用原生 SendMessage 通知 FE teammate：`)
      messages.push(`   SendMessage({ "to": "<fe-teammate-name>", "text": "api-spec 已更新至 vX.X，变更：...", "summary": "api-spec vX.X 就绪" })`)
      messages.push(`   参考完整模板：node scripts/workflow.js generate-team-dispatch`)
    } else {
      // 路径 B：提示 BE 追加到 review-notes.md（降级模式）
      messages.push(`📝 [v11.1 文件轮询] api-spec.md 已更新。`)
      messages.push(`   BE 应向 .claude/review-notes.md 追加变更通知（供 FE 下次读取）：`)
      messages.push(`   node scripts/workflow.js fallback-notify be fe "api-spec 已更新至 vX.X。变更：..."`)
    }
  }

  // 3. [v1.0] P0.2：自动 context 追踪（写入操作）
  if (state.contextBudget?.agentName) {
    state = autoTrackContext(state, 'write')
    const contextStatus = checkContextBudget(state)
    if (contextStatus) messages.push(contextStatus)
  }

  // 4. Check prereqs for next state
  const freshState = loadState()
  const nextState = TRANSITIONS[freshState.currentState]?.next
  if (nextState) {
    const prereqCheck = checkPrereqs(nextState)
    const stateConfig = STATES[freshState.currentState]
    if (prereqCheck.ok) {
      messages.push(``)
      messages.push(stateConfig?.manual
        ? `🎯 [auto-check] 所有前置条件已满足，等待用户确认（MANUAL 节点）\n   确认后运行：node scripts/workflow.js advance --force`
        : `🎯 [auto-check] 当前状态 ${freshState.currentState} 的所有前置条件已满足！\n   下一步：node scripts/workflow.js advance`)
    }
  }

  if (messages.length > 0) console.log(messages.join('\n'))
  process.exit(0)
}

// ─── PostBash Hook ───────────────────────────────────────────────────────

function hookPostBash() {
  const event  = readHookInput()
  const cmd    = event?.tool_input?.command || ''
  const output = event?.tool_response?.content || ''
  const state  = loadState()
  const messages = []

  // [v1.0] P0.2：自动 context 追踪（Bash 操作）
  // [v1.0.4] 傳入實際輸出字節數，精度比固定常量高 5-10 倍
  if (state.contextBudget?.agentName) {
    const actualBytes = Buffer.byteLength(output, 'utf8')
    state = autoTrackContext(state, 'bash', actualBytes)
    const contextStatus = checkContextBudget(state)
    if (contextStatus) messages.push(contextStatus)
  }

  const isBuildSuccess = (
    (cmd.includes('npm run build') || cmd.includes('bun run build')) &&
    !output.toLowerCase().includes('error') &&
    !output.toLowerCase().includes('failed')
  )

  if (isBuildSuccess && state.currentState === 'DESIGN_REVIEW') {
    // [v1.0.1 P1.4] 使用 FE_PATH_PREFIX / BE_PATH_PREFIX 常量，支持自定义 monorepo 路径
    const role = cmd.includes(FE_PATH_PREFIX) || cmd.includes('next build') ? 'FE'
               : cmd.includes(BE_PATH_PREFIX) || cmd.includes('bun build') ? 'BE' : null
    if (role) {
      messages.push(`🔨 [auto-detect] ${role} 构建完成，建议运行：node scripts/workflow.js integration-check`)
    }
  }

  if (cmd.includes('integration-check') && output.includes('联调检查通过')) {
    messages.push(`✅ [auto-detect] 联调检查已通过，FE+BE 均完成时可推进：`)
    messages.push(`   node scripts/workflow.js check-parallel-done && node scripts/workflow.js advance`)
  }

  appendAgentLog({
    agent: 'hook', action: 'bash-exec',
    cmd: cmd.slice(0, 100), state: state.currentState,
    ts: new Date().toISOString(),
  })

  if (messages.length > 0) console.log(messages.join('\n'))
  process.exit(0)
}

// ─── PostRead Hook (P0.1) ────────────────────────────────────────────────────
//
// [v1.0.1] Read 操作是 context 消耗的主要来源（大文件一次 Read 可达数千 tokens），
// 但旧版完全没有追踪。此 hook 在 Agent 每次 Read 后自动计入 context budget。

function hookPostRead() {
  const event  = readHookInput()
  const state  = loadState()
  const messages = []

  if (state.contextBudget?.agentName) {
    // [v1.0] 传入实际读取内容的字节数（如果 hook 输入中有的话）
    const content = event?.tool_response?.content || ''
    const actualBytes = Buffer.byteLength(content, 'utf8')
    const newState = autoTrackContext(state, 'read', actualBytes > 0 ? actualBytes : undefined)
    const contextStatus = checkContextBudget(newState)
    if (contextStatus) messages.push(contextStatus)
  }

  if (messages.length > 0) console.log(messages.join('\n'))
  process.exit(0)
}

// ─── PostCompact Hook ─────────────────────────────────────────
//
// [v1.0] 解决 Context 压缩失忆问题
//
// 问题：Claude Code 压缩 context 后，早期加载的文档会从准确记忆退化为模糊印象，
//      Agent 可能继续基于错误的需求理解工作。
//
// 解决方案：通过 SessionStart hook + matcher: "compact" 在压缩后立即输出重读指令，
//      强制 Agent 在继续工作前重读关键文档。
//
// 使用方式：
//   1. 在 .claude/settings.json 配置 SessionStart hook（见下方 settings.json 更新）
//   2. 触发压缩时，hook 自动检测到并输出重读指令
//   3. 无需 Agent 主动操作，由基础设施保证行为一致性。

function hookPostCompact() {
  const event = readHookInput()
  const state = loadState()
  const lines = []

  // 只在 context 压缩事件时触发（matcher: "compact"）
  const isCompact = event?.match_data?.includes('compact') === true

  if (!isCompact) {
    // 非压缩事件，跳过
    process.exit(0)
  }

  lines.push(``)
  lines.push(`┄┄┄ [v1.0 Context Guard] Context 已压缩，重新注入关键文档 ┄┄┄`)
  lines.push(``)

  // 检查是否有活跃 Agent 在追踪
  const budget = state.contextBudget
  if (budget?.agentName) {
    const criticalDocs = checkContextBudget(state)
    if (criticalDocs) {
      lines.push(criticalDocs)
      lines.push(``)
      lines.push(`⚠️  压缩后必须先重读文档，再继续当前任务。`)
    } else {
      lines.push(`ℹ️  Agent ${budget.agentName} 已跟踪，压缩事件已记录。`)
    }
  } else {
    lines.push(`ℹ️  无活跃 context 追踪，建议先运行 reset-context 设置 Agent。`)
    lines.push(`   示例：node scripts/workflow.js reset-context fe`)
  }

  lines.push(``)
  lines.push(`当前状态：${state.currentState}`)
  lines.push(`Agent Teams：${checkAgentTeamsEnabled() ? '✅ 启用' : '📝 降级模式'}`)
  lines.push(`┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄`)

  console.log(lines.join('\n'))
  process.exit(0)
}

// ─── PreWrite Hook ───────────────────────────────────────────────────────

function hookPreWrite() {
  const event    = readHookInput()
  const filePath = event?.tool_input?.path || ''
  const relPath  = path.relative(ROOT, path.isAbsolute(filePath) ? filePath : path.join(ROOT, filePath))
  const state    = loadState()

  // ── 1. 禁止直接写 state 文件 ─────────────────────────────────────────────
  if (relPath === 'state/workflow-state.json') {
    console.error(`❌ [hook-guard] 禁止直接写入 ${relPath}，请使用 workflow.js 命令`)
    process.exit(2)  // exit(2) = 阻止操作
  }

  if (state.currentState === 'DONE' && relPath.startsWith('docs/')) {
    console.warn(`⚠️  [hook-guard] 工作流已处于 DONE 状态，docs/ 文件应通过新 workflow 修改`)
  }

  // ── 2. [v1.0] 全 Agent 写入权限校验 ───────────────────────────────────────
  // [v1.0.2 P0.2] 修复：agentName 为 null 时受保护路径仍需检查
  const agentName = state.contextBudget?.agentName
  if (agentName && AGENT_WRITE_PERMISSIONS[agentName]) {
    const perm = AGENT_WRITE_PERMISSIONS[agentName]
    const allowed = perm.allowedPaths.length === 0
      ? false  // 空白名单 = 禁止所有写入（只读 Agent）
      : perm.allowedPaths.some(p => relPath === p || relPath.startsWith(p))
    if (!allowed) {
      appendTrace({
        type: 'tool_permission_block',
        payload: { agentName, relPath, allowedPaths: perm.allowedPaths },
      }, state)
      console.error(`❌ [hook-guard] ${agentName} 不允许写入 ${relPath}`)
      console.error(`   允许路径：${perm.allowedPaths.join(', ') || '(无 — 只读 Agent)'}`)
      console.error(`   原因：${perm.reason}`)
      process.exit(2)  // exit(2) = 阻止写入
    }
  } else if (!agentName) {
    // [v1.0.2 P0.2] agentName 未设置时，对受保护路径发出警告
    // 收集所有已注册 Agent 的受保护路径
    const allProtectedPrefixes = new Set()
    for (const [, perm] of Object.entries(AGENT_WRITE_PERMISSIONS)) {
      for (const p of perm.allowedPaths) {
        allProtectedPrefixes.add(p)
      }
    }
    const isProtected = [...allProtectedPrefixes].some(p => relPath === p || relPath.startsWith(p))
    if (isProtected) {
      appendTrace({
        type: 'tool_permission_block',
        payload: { agentName: 'unknown', relPath, reason: 'agentName not set, writing to protected path' },
      }, state)
      console.warn(`⚠️  [hook-guard] 未设置 agentName 但正在写入受保护路径: ${relPath}`)
      console.warn(`   建议先运行: node scripts/workflow.js reset-context <agent-name>`)
    }
  }

  // ── 3. 产出物完整性警告（跨状态修改，不阻止但记录）─────────────────────
  const fingerprints = state.artifactFingerprints || {}
  if (fingerprints[relPath]) {
    const fp = fingerprints[relPath]
    if (fp.workflowState !== state.currentState) {
      appendTrace({
        type: 'artifact_fingerprint_warn',
        payload: { relPath, fingerprintState: fp.workflowState, currentState: state.currentState, agentName },
      }, state)
      console.warn(`⚠️  [harness:fingerprint] ${relPath} 的指纹建立于 ${fp.workflowState} 阶段`)
      console.warn(`   当前状态：${state.currentState}，跨状态修改已记录到 trace`)
    }
  }

  process.exit(0)  // 允许写入
}

// ─── PreBash Hook ─────────────────────────────────────────────────────

function hookPreBash() {
  const event = readHookInput()
  const cmd   = event?.tool_input?.command || ''

  for (const rule of DANGEROUS_BASH_PATTERNS) {
    if (rule.pattern.test(cmd) && rule.check()) {
      console.error(`❌ [hook-guard] ${rule.message}`)
      console.error(`   拦截的命令: ${cmd.slice(0, 80)}`)
      process.exit(2)
    }
  }

  process.exit(0)
}

// ─── Stop Hook ─────────────────────────────────────────────────────────────

function hookStop() {
  const state     = loadState()
  const current   = state.currentState
  const stateInfo = STATES[current]
  const nextState = TRANSITIONS[current]?.next
  const lines     = []

  lines.push(``)
  lines.push(`┄┄┄ 工作流状态摘要 [v1.0.3] ┄┄┄`)
  lines.push(`当前：${current} — ${stateInfo?.desc}`)
  if (state.mode === 'feature') lines.push(`模式：✨ FEATURE MODE`)

  // ── [v1.0.3 Harness A] 讀取 Agent 結果協議，差異化路由 ─────────────────────
  const agentResult = readAgentResult()
  if (agentResult) {
    const statusIcon = {
      success: '✅', partial: '⚡', failed: '❌', blocked: '🚧', unknown: '❓',
    }[agentResult.status] || '❓'

    lines.push(``)
    lines.push(`${statusIcon} Agent 結果：${agentResult.status.toUpperCase()} [${agentResult.agentName}]`)

    if (agentResult.artifactsProduced?.length > 0) {
      lines.push(`   産出物：${agentResult.artifactsProduced.join(', ')}`)
    }

    if (agentResult.status === 'blocked' && agentResult.blockingReason) {
      lines.push(`   阻塞原因：${agentResult.blockingReason}`)
      lines.push(`   建議：解決上述阻塞後重新運行 Agent`)
    } else if (agentResult.status === 'failed') {
      lines.push(`   建議：檢查 state/agent-log.jsonl 查看詳細錯誤`)
    } else if (agentResult.status === 'success' && agentResult.nextAction === 'advance') {
      lines.push(`   harness 建議：node scripts/workflow.js advance`)
    } else if (agentResult.status === 'partial') {
      lines.push(`   建議：確認未完成部分後繼續，或重新運行 Agent`)
    }

    // 發射 trace 事件
    appendTrace({ type: 'agent_result', payload: agentResult }, state)
  }

  lines.push(``)

  // ── 前置條件狀態 ──────────────────────────────────────────────────────────
  if (nextState) {
    const prereqCheck = checkPrereqs(nextState)
    if (prereqCheck.ok) {
      lines.push(stateInfo?.manual
        ? `状态：✅ 前置条件满足，等待用户确认（MANUAL）\n操作：node scripts/workflow.js advance --force`
        : `状态：✅ 前置条件满足，可以推进\n操作：node scripts/workflow.js advance`)
    } else {
      lines.push(`状态：⏳ 缺少産出物：${prereqCheck.missing.join(', ')}`)
    }
  }

  // ── Agent Teams 状态（DESIGN_REVIEW 阶段）───────────────────────────────
  // [v1.0.2 P1.2] 已移除并行 FE/BE 进度追踪（v14.3 合并为 fullstack-engineer）
  if (current === 'DESIGN_REVIEW') {
    const hasTeams = checkAgentTeamsEnabled()
    if (hasTeams) {
      lines.push(`通信：✅ Agent Teams 原生模式`)
      lines.push(`      查看调度模板：node scripts/workflow.js generate-team-dispatch`)
    } else {
      lines.push(`通信：📝 文件轮询降级模式（review-notes.md）`)
      lines.push(`      启用 Agent Teams：export ${AGENT_TEAMS_CONFIG.ENV_FLAG}=1`)
    }
  }

  if (state.qaFailureCount > 0) {
    lines.push(`QA失败：${state.qaFailureCount}次（≥2次升级回滚）`)
  }

  // ── Context Budget 警告 ────────────────────────────────────────────────────
  const contextWarning = checkContextBudget(state)
  if (contextWarning) lines.push(contextWarning)

  lines.push(`┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄`)

  console.log(lines.join('\n'))
  process.exit(0)
}

// ─── Helper: checkAgentTeamsEnabled ─────────────────────────────────────

/**
 * 检测 Agent Teams 是否启用
 * 官方环境变量为 CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS（值为 "1"）
 * [v1.0] P1.1 改进：同时检查 teams 目录是否存在作为辅助验证
 */
function checkAgentTeamsEnabled() {
  // 检查环境变量（settings.json 可传入）
  const val = process.env[AGENT_TEAMS_CONFIG.ENV_FLAG]
  if (val === '1' || val === 'true') return true

  // 检查 teams 目录是否存在（辅助验证）
  const teamsDir = path.join(require('os').homedir(), '.claude', 'teams', AGENT_TEAMS_CONFIG.NATIVE_TEAM_NAME)
  if (fs.existsSync(teamsDir)) {
    // 目录存在但环境变量未设置，提示用户
    console.warn(`⚠️  检测到 ~/.claude/teams/${AGENT_TEAMS_CONFIG.NATIVE_TEAM_NAME}/ 存在`)
    console.warn(`   但 ${AGENT_TEAMS_CONFIG.ENV_FLAG} 未设置为 1`)
    console.warn(`   建议在 .claude/settings.json 中添加：`)
    console.warn(`     { "env": { "${AGENT_TEAMS_CONFIG.ENV_FLAG}": "1" } }`)
  }

  return false
}

// ─── Session Meta-Rules Injection ────────────────────────────────────────────
//
// [v1.0.2] SessionStart hook：注入元规则到每个 Session 开始时
// 教会 Agent "先查技能，再行动" + Iron Laws 提醒
// 输出 JSON additionalContext 格式，Claude Code 会注入到 context 中

function hookSessionMetaRules() {
  const metaRules = `
════════════════════════════════════════════════════════════
  ⚡ WORKFLOW META-RULES（每个 Session 开始时生效）
════════════════════════════════════════════════════════════

【元规则】先查技能，再行动
  在执行任何非平凡操作前，检查 .claude/skills/ 是否有适用技能。
  优先级：用户指令 > 技能 > Agent 默认行为

【Iron Laws — 不可违反】
  IL-01  前置文档不存在 → 禁止推进到下一阶段
  IL-02  API spec 不存在 → 禁止写任何路由/组件
  IL-03  hookPreWrite 未授权 → 禁止写文件（系统强制）
  IL-04  Reviewer 不修改代码，只报告问题
  IL-05  测试必须用真浏览器（Playwright），mock 不计入覆盖率
  IL-06  每个 Agent 完成时必须执行 write-agent-result
  IL-07  MANUAL 节点无 --force 或 autopilot=true → 等待用户确认
  IL-08  生产环境禁止 drizzle-kit push
  IL-09  PRD Must 功能缺失 = FAIL（不可降级为 WARN）
  IL-10  新技能上线前必须有 failure-evidence.md

════════════════════════════════════════════════════════════
`.trim()

  // 输出 Claude Code SessionStart additionalContext 格式
  const output = {
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: metaRules,
    },
  }
  console.log(JSON.stringify(output))
  process.exit(0)
}

// ─── Exports ──────────────────────────────────────────────────────────

module.exports = {
  hookPostWrite,
  hookPostBash,
  hookPostRead,
  hookPreWrite,
  hookPreBash,
  hookStop,
  hookPostCompact,
  hookSessionMetaRules,
  checkAgentTeamsEnabled,
}

// ─── CLI Dispatch (P1.5) ──────────────────────────────────────────────────────
//
// [v1.0.1] settings.json 直接调用 `node scripts/lib/hooks.js <hook-name>`，
// 而不经过 workflow.js，避免加载整个状态机模块（更快）。
// 此 dispatch 块仅在作为主脚本运行时触发，require() 导入时不执行。

if (require.main === module) {
  const cmd = process.argv[2]
  const dispatch = {
    'hook-post-write':   hookPostWrite,
    'hook-post-bash':    hookPostBash,
    'hook-post-read':    hookPostRead,
    'hook-pre-write':    hookPreWrite,
    'hook-pre-bash':     hookPreBash,
    'hook-stop':               hookStop,
    'hook-post-compact':       hookPostCompact,
    'hook-session-meta-rules': hookSessionMetaRules,
  }
  const fn = dispatch[cmd]
  if (fn) fn()
  else process.exit(0)  // 未知命令静默退出，不阻断 Claude Code
}
