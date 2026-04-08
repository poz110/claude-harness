'use strict'
/**
 * commands/agent-teams.js
 *
 * Agent Teams 命令：check-agent-teams, generate-team-dispatch, fallback-notify
 */

const { checkAgentTeamsEnabled } = require('../hooks.js')
const { installGlobal } = require('../install.js')

/**
 * Execute check-agent-teams command
 */
function cmdCheckAgentTeams() {
  const teamsEnabled = checkAgentTeamsEnabled()
  console.log(teamsEnabled
    ? `✅ Agent Teams 已启用（路径 A：原生 TeamCreate/TaskCreate/SendMessage）`
    : `📝 Agent Teams 未启用（路径 B：文件轮询降级模式 review-notes.md）`)
}

/**
 * Execute generate-team-dispatch command
 */
function cmdGenerateTeamDispatch() {
  console.log(`\n⚠️  Agent Teams dispatch 已废弃（v14.3+）`)
  console.log(`   DESIGN_REVIEW 现使用 fullstack-engineer 单 agent，无需并行团队调度。`)
  console.log(`   如需文件通知机制，可使用 fallback-notify 命令。\n`)
}

/**
 * Execute fallback-notify command
 */
function cmdFallbackNotify(args) {
  const [from, to, ...msgParts] = args
  const message = msgParts.join(' ')
  if (!from || !to || !message) {
    console.error('Usage: fallback-notify <from> <to> "<message>"')
    console.error('Example: fallback-notify be fe "api-spec 已更新至 v1.1。变更：新增 GET /users/me 端点。"')
    process.exit(1)
  }

  // fallbackNotify is in install.js
  if (typeof installGlobal.fallbackNotify === 'function') {
    installGlobal.fallbackNotify(from, to, message)
  } else {
    // fallbackNotify not available - graceful message
    console.log(`📝 [fallback-notify] ${from} → ${to}: ${message}`)
    console.log(`   (fallbackNotify not available, showing message instead)`)
  }
}

module.exports = {
  cmdCheckAgentTeams,
  cmdGenerateTeamDispatch,
  cmdFallbackNotify,
}
