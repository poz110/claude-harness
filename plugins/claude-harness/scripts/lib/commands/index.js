'use strict'
/**
 * commands/index.js
 *
 * 统一导出所有命令模块
 */

const navigation = require('./navigation.js')
const checks      = require('./checks.js')
const context     = require('./context.js')
const agentTeams  = require('./agent-teams.js')
const init        = require('./init.js')
const install     = require('./install.js')
const trace       = require('./trace.js')
const misc        = require('./misc.js')
const archive     = require('./archive.js')

module.exports = {
  ...navigation,
  ...checks,
  ...context,
  ...agentTeams,
  ...init,
  ...install,
  ...trace,
  ...misc,
  ...archive,
}
