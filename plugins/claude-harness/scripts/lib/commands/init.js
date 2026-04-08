'use strict'
/**
 * commands/init.js
 *
 * 初始化命令：init-autopilot, stop-autopilot, init-feature, init-hotfix
 */

const fs = require('fs')
const path = require('path')

const {
  SCHEMA_VERSION,
  FEATURE_SKIP_STATES,
  HOTFIX_SKIP_STATES,
} = require('../config.js')

const {
  loadState, saveState,
  ROOT,
} = require('../state.js')

/**
 * Execute init-autopilot command
 */
function cmdInitAutopilot(args) {
  const state = loadState()
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
}

/**
 * Execute stop-autopilot command
 */
function cmdStopAutopilot() {
  const state = loadState()
  state.autopilot = false
  state.history.push({
    from: state.currentState, to: state.currentState,
    timestamp: new Date().toISOString(), agent: 'system', type: 'stop-autopilot',
  })
  saveState(state)
  console.log('\n⏹  Autopilot 模式已停止')
  console.log('   後續 MANUAL 節點需要用戶確認')
}

/**
 * Execute init-feature command
 */
function cmdInitFeature() {
  const state = loadState()
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
}

/**
 * Execute init-hotfix command
 */
function cmdInitHotfix(args) {
  const state = loadState()
  const STATE_DIR = path.join(ROOT, 'state')
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
}

module.exports = {
  cmdInitAutopilot,
  cmdStopAutopilot,
  cmdInitFeature,
  cmdInitHotfix,
}
