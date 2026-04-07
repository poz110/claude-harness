'use strict'
/**
 * commands/misc.js
 *
 * 杂项命令：log-agent, git-diff-base, migrate-state
 */

const { appendAgentLog } = require('../state.js')
const { getGitDiffBase } = require('../verify.js')
const { SCHEMA_VERSION } = require('../config.js')
const { loadState, saveState } = require('../state.js')

/**
 * Execute log-agent command
 */
function cmdLogAgent(args) {
  appendAgentLog(args.join(' '))
  console.log('✅ Logged')
}

/**
 * Execute git-diff-base command
 */
function cmdGitDiffBase() {
  console.log(getGitDiffBase())
}

/**
 * Execute migrate-state command
 */
function cmdMigrateState() {
  const state = loadState()
  saveState(state)
  console.log(`✅ Migrated to schema v${SCHEMA_VERSION}`)
}

module.exports = {
  cmdLogAgent,
  cmdGitDiffBase,
  cmdMigrateState,
}
