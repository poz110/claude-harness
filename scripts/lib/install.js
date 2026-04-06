'use strict'
/**
 * install.js — v14.0
 *
 * 职责：全局安装 + 项目初始化（init-project）
 *   - installGlobal      复制 agents/skills 到 ~/.claude/
 *   - checkGlobal       验证全局安装
 *   - updateGlobal      增量更新
 *   - uninstallGlobal   清除全局安装
 *   - initProject       在新项目初始化 workflow
 *
 * 依赖：
 *   - state.js：loadState / saveState / appendAgentLog
 *   - config.js：SCHEMA_VERSION / AGENT_MODEL_MAP / GLOBAL_INSTALL_CONFIG
 *                / TECH_STACK_PRESETS / AGENT_TEAMS_CONFIG
 */

const fs   = require('fs')
const path = require('path')
const os    = require('os')

const {
  loadState, saveState, appendAgentLog, ROOT,
} = require('./state.js')

const {
  SCHEMA_VERSION,
  GLOBAL_INSTALL_CONFIG,
  TECH_STACK_PRESETS,
  AGENT_TEAMS_CONFIG,
} = require('./config.js')

const GLOBAL_DIR = path.join(os.homedir(), '.claude')

// ─── Install Global ──────────────────────────────────────────────────

/**
 * install-global — 把 .claude/agents/ 和 .claude/skills/ 复制到 ~/.claude/
 *
 * 安装后，新项目只需要：
 *   scripts/workflow.js（状态机引擎）
 *   scripts/lib/config.js（配置）
 *   .claude/settings.json（Hook 配置）
 *   state/（工作流状态）
 *
 * Agent 和 Skill 定义从 ~/.claude/ 全局加载。
 * [v13.1] Agent files: inject resolved model from AGENT_MODEL_MAP
 */
function installGlobal(opts = {}) {
  const { dryRun = false, force = false } = opts
  const localClaudeDir = path.join(ROOT, '.claude')
  const results = { installed: [], skipped: [], errors: [] }

  console.log(`\n🌐 ${dryRun ? '[DRY RUN] ' : ''}安装 Claude Workflow v${SCHEMA_VERSION} 到全局目录`)
  console.log(`   源：${localClaudeDir}`)
  console.log(`   目标：${GLOBAL_DIR}\n`)

  const allFiles = [
    ...GLOBAL_INSTALL_CONFIG.GLOBAL_AGENTS,
    ...GLOBAL_INSTALL_CONFIG.GLOBAL_SKILLS,
  ]

  // [v1.0.2 P1.3] 讀取共享基礎規則（_shared.md），安裝時注入每個 Agent 文件末尾
  const sharedMdPath = path.join(localClaudeDir, 'agents', '_shared.md')
  const sharedContent = fs.existsSync(sharedMdPath)
    ? '\n\n' + fs.readFileSync(sharedMdPath, 'utf8')
    : ''
  if (sharedContent) {
    console.log(`   📎 共享規則 _shared.md 已載入，將注入每個 Agent 文件末尾`)
  }

  for (const relFile of allFiles) {
    const src  = path.join(localClaudeDir, relFile)
    const dest = path.join(GLOBAL_DIR, relFile)
    const destDir = path.dirname(dest)

    if (!fs.existsSync(src)) {
      results.errors.push(`源文件不存在: ${relFile}`)
      console.log(`   ❌ ${relFile} (源文件不存在)`)
      continue
    }

    if (fs.existsSync(dest) && !force) {
      const srcMtime   = fs.statSync(src).mtime
      const destMtime  = fs.statSync(dest).mtime
      const sharedMtime = fs.existsSync(sharedMdPath) ? fs.statSync(sharedMdPath).mtime : null
      const isUpToDate = srcMtime <= destMtime && (!sharedMtime || sharedMtime <= destMtime)
      if (isUpToDate) {
        results.skipped.push(relFile)
        console.log(`   ⏭  ${relFile} (已是最新)`)
        continue
      }
    }

    if (!dryRun) {
      fs.mkdirSync(destDir, { recursive: true })
      // [v1.0.2 P1.3] Agent files: append _shared.md common rules
      // [v1.0.2] Model removed from agent files — inherits current session model dynamically
      if (relFile.startsWith('agents/') && relFile.endsWith('.md')) {
        const content = fs.readFileSync(src, 'utf8')
        fs.writeFileSync(dest, content + sharedContent)
      } else {
        fs.copyFileSync(src, dest)
      }
    }
    results.installed.push(relFile)
    console.log(`   ✅ ${relFile}${dryRun ? ' (dry run)' : ''}`)
  }

  // Write version marker
  if (!dryRun) {
    fs.writeFileSync(
      path.join(GLOBAL_DIR, '.workflow-version'),
      JSON.stringify({ version: SCHEMA_VERSION, installedAt: new Date().toISOString(), source: ROOT }, null, 2)
    )
  }

  console.log(`\n  安装完成：${results.installed.length} 个文件`)
  if (results.skipped.length > 0) console.log(`  跳过（已是最新）：${results.skipped.length} 个文件`)
  if (results.errors.length > 0) {
    console.log(`  错误：${results.errors.length} 个`)
    results.errors.forEach(e => console.log(`    - ${e}`))
  }

  console.log(`\n  新项目初始化方式：`)
  console.log(`    node ${path.relative(ROOT, __filename).replace('lib/', '')} init-project /path/to/new-project`)
  console.log(`\n  查看全局安装状态：`)
  console.log(`    node ${path.relative(ROOT, __filename).replace('lib/', '')} check-global\n`)

  return results
}



/**
 * check-global — 验证全局安装状态
 */
function checkGlobal() {
  console.log(`\n🔍 全局安装状态检查\n   目录：${GLOBAL_DIR}\n`)

  if (!fs.existsSync(GLOBAL_DIR)) {
    console.log(`❌ ~/.claude/ 不存在，请先运行：node scripts/workflow.js install-global`)
    return { ok: false }
  }

  const versionFile = path.join(GLOBAL_DIR, '.workflow-version')
  if (fs.existsSync(versionFile)) {
    const vInfo = JSON.parse(fs.readFileSync(versionFile, 'utf8'))
    console.log(`📦 已安装版本：v${vInfo.version}  (${vInfo.installedAt?.slice(0,10)})`)
    console.log(`   安装来源：${vInfo.source}\n`)
  } else {
    console.log(`⚠️  未找到版本信息（可能是手动安装）\n`)
  }

  const allFiles = [
    ...GLOBAL_INSTALL_CONFIG.GLOBAL_AGENTS,
    ...GLOBAL_INSTALL_CONFIG.GLOBAL_SKILLS,
  ]
  let missing = 0
  for (const relFile of allFiles) {
    const dest = path.join(GLOBAL_DIR, relFile)
    const exists = fs.existsSync(dest)
    if (!exists) {
      console.log(`   ❌ 缺失：${relFile}`)
      missing++
    }
  }

  if (missing === 0) {
    console.log(`✅ 所有 ${allFiles.length} 个文件均已安装\n`)
    return { ok: true, version: SCHEMA_VERSION }
  } else {
    console.log(`\n⚠️  ${missing} 个文件缺失，重新安装：node scripts/workflow.js install-global --force\n`)
    return { ok: false, missing }
  }
}

/**
 * update-global — 增量更新全局安装（只更新比全局新的文件）
 */
function updateGlobal() {
  console.log(`\n🔄 增量更新全局安装...`)
  return installGlobal({ force: false })
}

/**
 * uninstall-global — 清除全局安装
 */
function uninstallGlobal() {
  const versionFile = path.join(GLOBAL_DIR, '.workflow-version')
  if (!fs.existsSync(versionFile)) {
    console.log(`⚠️  未找到全局安装标记，跳过卸载`)
    return
  }

  const allFiles = [
    ...GLOBAL_INSTALL_CONFIG.GLOBAL_AGENTS,
    ...GLOBAL_INSTALL_CONFIG.GLOBAL_SKILLS,
    '.workflow-version',
  ]

  let removed = 0
  for (const relFile of allFiles) {
    const dest = path.join(GLOBAL_DIR, relFile)
    if (fs.existsSync(dest)) {
      fs.unlinkSync(dest)
      removed++
    }
  }

  // 清理空目录
  try {
    for (const dir of ['agents', 'skills/arch-review', 'skills/code-review-arch',
      'skills/env-check', 'skills/generate-design', 'skills/generate-prd',
      'skills/implement-api', 'skills/implement-feature', 'skills/owasp-scan',
      'skills/prepare-tests', 'skills/setup-cicd', 'skills/stitch-design',
      'skills/traceability-matrix', 'skills']) {
      const d = path.join(GLOBAL_DIR, dir)
      if (fs.existsSync(d)) {
        const contents = fs.readdirSync(d)
        if (contents.length === 0) fs.rmdirSync(d)
      }
    }
  } catch {}

  console.log(`✅ 已卸载 ${removed} 个文件`)
}

/**
 * init-project <targetDir> — 在新项目中初始化 workflow（使用全局 Agent/Skill）
 * [v13.1] 交互式询问技术栈，动态写入 CODE_OUTPUTS 配置
 * [v1.0]   模型分级摘要输出 + P1.1 Agent Teams 改进说明
 */
function initProject(targetDir) {
  if (!targetDir) { console.error('Usage: init-project <targetDir>'); process.exit(1) }

  const absTarget = path.isAbsolute(targetDir) ? targetDir : path.join(process.cwd(), targetDir)

  if (!fs.existsSync(path.join(GLOBAL_DIR, '.workflow-version'))) {
    console.error('❌ 请先运行 node scripts/workflow.js install-global')
    process.exit(1)
  }

  console.log(`\n🚀 初始化新项目：${absTarget}\n`)

  // ── [v13.1] 交互式技术栈选择 ─────────────────────────────────────
  const feOptions = Object.entries(TECH_STACK_PRESETS).filter(([, v]) => v.fe)
  const beOptions = Object.entries(TECH_STACK_PRESETS).filter(([, v]) => v.be)

  console.log('  选择前端技术栈：')
  feOptions.forEach(([k, v], i) => console.log(`    ${i + 1}) ${k.padEnd(14)} ${v.label}`))
  const feDefault = 1
  const feInput   = readlineSync(`  前端 [1-${feOptions.length}]，默认 ${feDefault}]: `) || String(feDefault)
  const feIdx     = Math.max(0, Math.min(feOptions.length - 1, parseInt(feInput, 10) - 1 || 0))
  const [feKey]   = feOptions[feIdx]

  console.log('\n  选择后端技术栈：')
  beOptions.forEach(([k, v], i) => console.log(`    ${i + 1}) ${k.padEnd(14)} ${v.label}`))
  const beDefault = 1
  const beInput   = readlineSync(`  后端 [1-${beOptions.length}]，默认 ${beDefault}]: `) || String(beDefault)
  const beIdx     = Math.max(0, Math.min(beOptions.length - 1, parseInt(beInput, 10) - 1 || 0))
  const [beKey]   = beOptions[beIdx]

  const selectedFE = TECH_STACK_PRESETS[feKey]
  const selectedBE = TECH_STACK_PRESETS[beKey]
  const feDir      = selectedFE.fe.dir
  const beDir      = selectedBE.be.dir

  console.log(`\n  ✅ 技术栈选择：`)
  console.log(`     FE: ${feKey} (${selectedFE.label}) → ${feDir}/`)
  console.log(`     BE: ${beKey} (${selectedBE.label}) → ${beDir}/\n`)

  // ── 创建目录结构 ──────────────────────────────────────────────────────────
  for (const dir of ['scripts/lib', 'state', 'docs', 'design', '.claude']) {
    fs.mkdirSync(path.join(absTarget, dir), { recursive: true })
  }

  // ── 复制状态机引擎 ────────────────────────────────────────────────────────
  const workflowSource = path.join(ROOT, 'scripts', 'workflow.js')
  fs.copyFileSync(workflowSource, path.join(absTarget, 'scripts/workflow.js'))
  console.log(`✅ scripts/workflow.js`)

  // [v13.1] 写入项目专属 config.js，CODE_OUTPUTS 已根据技术栈选择注入
  const baseConfig  = fs.readFileSync(path.join(__dirname, 'config.js'), 'utf8')
  const patchedFE   = JSON.stringify(selectedFE.fe, null, 2).replace(/^/gm, '  ')
  const patchedBE   = JSON.stringify(selectedBE.be, null, 2).replace(/^/gm, '  ')
  const configPatch = `\n// [v13.1] Tech stack selected at init-project: FE=${feKey}, BE=${beKey}\n` +
    `// To change: delete this project and run init-project again, or edit CODE_OUTPUTS manually.\n` +
    `const _SELECTED_FE_KEY = '${feKey}'\nconst _SELECTED_BE_KEY = '${beKey}'\n`
  // Patch CODE_OUTPUTS block in config.js with selected stack
  const patchedConfig = baseConfig.replace(
    /const CODE_OUTPUTS = \{[\s\S]*?\}/,
    `const CODE_OUTPUTS = {\n  FE: ${patchedFE.trim()},\n  BE: ${patchedBE.trim()},\n}`
  ).replace(
    /\/\/ ─── \[v13\.1\] Tech Stack Presets/,
    configPatch + '// ─── [v13.1] Tech Stack Presets'
  ).replace(
    /  FE_PATH_PREFIX: 'apps\/web\/',\n  BE_PATH_PREFIX: 'apps\/server\/',/,
    `  FE_PATH_PREFIX: '${feDir}/',\n  BE_PATH_PREFIX: '${beDir}/',`
  )
  fs.writeFileSync(path.join(absTarget, 'scripts/lib/config.js'), patchedConfig)
  console.log(`✅ scripts/lib/config.js (patched for ${feKey}/${beKey})`)

  // ── 复制 settings.json ────────────────────────────────────────────────────
  const settingsSrc = path.join(ROOT, '.claude', 'settings.json')
  if (fs.existsSync(settingsSrc)) {
    fs.copyFileSync(settingsSrc, path.join(absTarget, '.claude/settings.json'))
    console.log(`✅ .claude/settings.json`)
  }

  // ── 初始化 workflow state（含技术栈选择记录）────────────────────────────
  const freshState = {
    schemaVersion: SCHEMA_VERSION, currentState: 'IDEA',
    rollbackStack: [], history: [],
    parallelProgress: { FE: false, BE: false },
    qaFailureCount: 0, securityReauditNeeded: false, context: {},
    traceabilityReady: false, designBaselineReady: false,
    interactionSpecReady: false, stateBaselineReady: false,
    techStack: { fe: feKey, be: beKey },          // [v13.1] 记录技术栈选择
    contextBudget: null,
    mode: 'greenfield',                           // [v1.0.2 P1.4] 'greenfield' | 'feature'
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    _note: `v${SCHEMA_VERSION}: initialized with FE=${feKey}, BE=${beKey}`,
  }
  const statePath = path.join(absTarget, 'state/workflow-state.json')
  const stateDir  = path.join(absTarget, 'state')
  if (!fs.existsSync(stateDir)) fs.mkdirSync(stateDir, { recursive: true })
  fs.writeFileSync(statePath, JSON.stringify(freshState, null, 2))
  fs.writeFileSync(path.join(absTarget, 'state/agent-log.jsonl'), '')
  fs.writeFileSync(path.join(absTarget, 'state/error-log.json'), '[]')
  console.log(`✅ state/ 初始化完成`)

  // ── [v1.0.2] 模型配置：动态继承 ──────────────────────────────────
  console.log(`\n  模型配置：所有 Agent 动态继承当前会话模型，无需手动配置。`)

  // ── [v1.0] P1.1 Agent Teams 配置说明 ────────────────────────────────
  console.log(`\n  Agent Teams 通信模式：`)
  console.log(`     路径 A（原生 TeamCreate/TaskCreate/SendMessage）：实验功能，`)
  console.log(`       需要 Claude Code v2.1.32+ 和 Opus 4.6 模型。`)
  console.log(`     路径 B（文件轮询 .claude/review-notes.md）：默认向后兼容模式。`)
  console.log(`\n  启用路径 A 的两种方式：`)
  console.log(`     1. .claude/settings.json 中添加：`)
  console.log(`        { "env": { "${AGENT_TEAMS_CONFIG.ENV_FLAG}": "1" } }`)
  console.log(`     2. 命令行设置：export ${AGENT_TEAMS_CONFIG.ENV_FLAG}=1`)
  console.log(`\n  查看路径 A 完整调度模板：`)
  console.log(`     node ${path.relative(ROOT, workflowSource).replace('lib/', '')} generate-team-dispatch`)

  console.log(`\n  Agent 和 Skill 定义从全局目录加载：${GLOBAL_DIR}`)
  console.log(`  新项目启动：`)
  console.log(`    cd ${absTarget}`)
  console.log(`    node scripts/workflow.js status\n`)
}

/** 同步单行 readline（仅用于 init-project 交互）*/
function readlineSync(prompt) {
  process.stdout.write(prompt)
  const buf = Buffer.alloc(1024)
  let input = ''
  try {
    const fd = fs.openSync('/dev/tty', 'r')
    const n  = fs.readSync(fd, buf, 0, buf.length, null)
    fs.closeSync(fd)
    input = buf.slice(0, n).toString().trim()
  } catch {
    // fallback for non-TTY (CI / pipe): read from stdin synchronously
    try {
      const n = fs.readSync(0, buf, 0, buf.length, null)
      input = buf.slice(0, n).toString().trim()
    } catch { input = '' }
  }
  return input
}

// ─── Exports ──────────────────────────────────────────────────────────

module.exports = {
  installGlobal,
  checkGlobal,
  updateGlobal,
  uninstallGlobal,
  initProject,
}
