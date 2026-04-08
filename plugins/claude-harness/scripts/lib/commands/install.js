'use strict'
/**
 * commands/install.js
 *
 * 全局安装命令：init, install-global, check-global, update-global, uninstall-global, init-project
 */

const {
  installGlobal, checkGlobal, updateGlobal, uninstallGlobal, initProject,
} = require('../install.js')

/**
 * Execute init command
 */
function cmdInit() {
  installGlobal({ force: false })
  console.log('\n✅ claude-harness installed!')
  console.log('   Next: node scripts/workflow.js status')
}

/**
 * Execute install-global command
 */
function cmdInstallGlobal(args) {
  const force  = args.includes('--force')
  const dryRun = args.includes('--dry-run')
  installGlobal({ force, dryRun })
}

/**
 * Execute check-global command
 */
function cmdCheckGlobal() {
  checkGlobal()
}

/**
 * Execute update-global command
 */
function cmdUpdateGlobal() {
  updateGlobal()
}

/**
 * Execute uninstall-global command
 */
function cmdUninstallGlobal() {
  uninstallGlobal()
}

/**
 * Execute init-project command
 */
function cmdInitProject(args) {
  const targetDir = args[0]
  initProject(targetDir)
}

module.exports = {
  cmdInit,
  cmdInstallGlobal,
  cmdCheckGlobal,
  cmdUpdateGlobal,
  cmdUninstallGlobal,
  cmdInitProject,
}
