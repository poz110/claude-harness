'use strict'
/**
 * commands/checks.js
 *
 * 校验命令：check, validate-doc, check-code, verify-code, integration-check, smoke-test
 */

const {
  checkPrereqs, validateDoc,
  fullVerify, checkCodeOutputs, runIntegrationCheck, runSmokeTest,
  syncCheck,
} = require('../verify.js')

const { loadState } = require('../state.js')
const { TRANSITIONS } = require('../config.js')

/**
 * Execute check command
 */
function cmdCheck(args) {
  const state = loadState()
  const target = args[0] || TRANSITIONS[state.currentState]?.next
  if (!target) { console.log('No next state'); return }
  const result = checkPrereqs(target)
  if (result.ok) { console.log(`✅ All prerequisites met for ${target}`) }
  else {
    console.log(`❌ Missing for ${target}:`)
    result.missing.forEach(f => console.log(`   - ${f}`))
    process.exit(1)
  }
}

/**
 * Execute validate-doc command
 */
function cmdValidateDoc(args) {
  const docKey = args[0]
  console.log(`\n📋 Validating: ${docKey}\n`)
  const result = validateDoc(docKey)
  console.log(result.ok ? '\n✅ 文档验证通过' : '\n❌ 文档验证失败')
  if (!result.ok) process.exit(1)
}

/**
 * Execute check-code command
 */
function cmdCheckCode(args) {
  const role   = args[0]?.toUpperCase()
  const result = checkCodeOutputs(role)
  if (result.ok) { console.log(`✅ ${role} outputs verified (${result.totalFiles} files)`) }
  else {
    console.log(`❌ ${role} missing:`)
    result.missing.forEach(f => console.log(`   - ${f}`))
    process.exit(1)
  }
}

/**
 * Execute verify-code command
 */
async function cmdVerifyCode(args) {
  const role   = args[0]?.toUpperCase()
  const result = await fullVerify(role)
  console.log(result.ok ? `\n✅ ${role} verification passed` : `\n❌ ${role} verification FAILED`)
  if (!result.ok) process.exit(1)
}

/**
 * Execute integration-check command
 */
function cmdIntegrationCheck() {
  const result = runIntegrationCheck()
  console.log(result.ok ? '\n✅ 联调检查通过' : '\n❌ 联调检查失败')
  if (!result.ok) process.exit(1)
}

/**
 * Execute smoke-test command
 */
async function cmdSmokeTest() {
  const result = await runSmokeTest()
  console.log(result.ok ? '\n✅ Smoke test 通过' : '\n❌ Smoke test 失败')
  if (!result.ok) process.exit(1)
}

/**
 * Execute sync-check command
 */
function cmdSyncCheck() {
  console.log('\n🔍 文件镜像一致性检查\n')
  const result = syncCheck()
  if (result.ok) {
    console.log('✅ 文件镜像完全一致（scripts/ ↔ plugins/, agents/, skills/）')
  } else {
    console.log(`❌ 发现 ${result.diffs.length} 处不一致:\n`)
    for (const d of result.diffs) {
      const icon = d.status === 'modified' ? '📝' : d.status === 'src-only' ? '➕' : d.status === 'dst-only' ? '➖' : '⚠️'
      console.log(`   ${icon} [${d.status}] ${d.file}`)
    }
    console.log('\n   同步命令:')
    console.log('   rsync -av --delete scripts/ plugins/claude-harness/scripts/ --exclude bump-version.js')
    console.log('   rsync -av .claude/agents/ plugins/claude-harness/agents/')
    console.log('   rsync -av .claude/skills/ plugins/claude-harness/skills/')
    process.exit(1)
  }
}

module.exports = {
  cmdCheck,
  cmdValidateDoc,
  cmdCheckCode,
  cmdVerifyCode,
  cmdIntegrationCheck,
  cmdSmokeTest,
  cmdSyncCheck,
}
