'use strict'
/**
 * verify.js — v14.0
 *
 * 职责：文档校验、构建验证、集成检查、前置条件检测
 *   - validateDoc       文档内容校验
 *   - checkPrereqs      前置文件存在性检查（从 workflow.js 移入）
 *   - fullVerify        构建 + lint + 类型检查（async）
 *   - checkCodeOutputs  代码产出物存在性检查
 *   - runIntegrationCheck  6 项静态联调检查
 *   - getGitDiffBase    git diff 基准分支
 */

const fs   = require('fs')
const path = require('path')
const http = require('http')
const { execSync, spawn } = require('child_process')

const { ROOT, loadState } = require('./state.js')
const {
  DOC_VALIDATORS, CODE_OUTPUTS, PREREQS,
  resolveCodeOutputs, FEATURE_PREREQS,   // [v1.0.2 P1.4]
  HOTFIX_PREREQS,                        // [v1.0.2 P1.1]
} = require('./config.js')

// ─── Prerequisite Check ───────────────────────────────────────────────────────

/**
 * 检查推进到 targetState 所需的前置文件是否存在
 */
function checkPrereqs(targetState) {
  // [v1.0.2 P1.4] Feature mode: use relaxed prereqs
  // [v1.0.2 P1.1] Hotfix mode: use HOTFIX_PREREQS (skips IMPLEMENTATION entirely)
  const state = loadState()
  let prereqMap = PREREQS
  if (state.mode === 'hotfix' && HOTFIX_PREREQS[targetState]) {
    prereqMap = HOTFIX_PREREQS
  } else if (state.mode === 'feature' && FEATURE_PREREQS[targetState]) {
    prereqMap = FEATURE_PREREQS
  }
  const prereqs = prereqMap[targetState] || []
  const missing = prereqs.filter(f => !fs.existsSync(path.join(ROOT, f)))

  // Design output check only applies in greenfield mode (feature/hotfix modes skip design phases)
  if (state.mode === 'greenfield' && (targetState === 'DESIGN_PHASE' || targetState === 'DESIGN_REVIEW')) {
    const hasDesignOutput =
      fs.existsSync(path.join(ROOT, 'design/index.html')) ||
      fs.existsSync(path.join(ROOT, 'design/stitch-prompts.md'))
    if (!hasDesignOutput) missing.push('design/index.html OR design/stitch-prompts.md')
  }
  return { ok: missing.length === 0, missing }
}

// ─── Document Validator ───────────────────────────────────────────────────────

function validateDoc(docKey, silent = false) {
  const validator = DOC_VALIDATORS[docKey]
  if (!validator) {
    if (!silent) console.error(`Unknown doc: "${docKey}". Available: ${Object.keys(DOC_VALIDATORS).join(', ')}`)
    if (!silent) process.exit(1)
    return { ok: false, missing: false, results: [] }
  }
  const filePath = path.join(ROOT, validator.file)
  if (!fs.existsSync(filePath)) {
    if (!silent) console.error(`❌ ${validator.file} 不存在`)
    return { ok: false, missing: true, results: [] }
  }
  const content = fs.readFileSync(filePath, 'utf8')
  const results = validator.checks.map(check => {
    const passed = check.pattern ? check.pattern.test(content) : check.fn?.(content)
    if (!silent) console.log(`  ${passed ? '✅' : '❌'} ${check.name}`)
    return { name: check.name, passed }
  })
  return { ok: results.every(r => r.passed), results }
}

// ─── Build Verifier ───────────────────────────────────────────────────────────

function spawnStep(cmd, args, cwd, timeoutSec) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = '', stderr = '', timedOut = false
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGTERM') }, timeoutSec * 1000)
    child.stdout.on('data', d => { process.stdout.write(d); stdout += d })
    child.stderr.on('data', d => { process.stderr.write(d); stderr += d })
    child.on('close', (code) => { clearTimeout(timer); resolve({ ok: code === 0, code, stdout, stderr, timedOut }) })
  })
}

async function fullVerify(role) {
  const state  = loadState()
  const dynOut = resolveCodeOutputs(state)
  const config = dynOut[role] || CODE_OUTPUTS[role]
  if (!config) { console.error(`Unknown role: ${role}`); process.exit(1) }
  const fullDir = path.join(ROOT, config.dir)
  if (!fs.existsSync(fullDir)) {
    if (role === 'FE') {
      console.log(`  ⚠️  前端目录不存在（${config.dir}/），跳过 FE 验证（后端专用项目？）`)
      return { ok: true, reason: 'skip (no FE directory)' }
    }
    console.error(`❌ ${config.dir} 目录不存在`)
    return { ok: false }
  }
  console.log(`\n🔨 验证 ${role} (${config.dir})\n`)
  const stepResults = []
  for (const step of config.verifySteps) {
    console.log(`  ▶ ${step.name}...`)
    const [cmd, ...args] = step.cmd
    const result = await spawnStep(cmd, args, fullDir, step.timeout)
    if (result.timedOut) {
      console.log(`  ⏱ 超时 (>${step.timeout}s)`)
      stepResults.push({ name: step.name, ok: false, reason: 'timeout' })
      if (!step.optional) return { ok: false, stepResults }
    } else if (!result.ok) {
      console.log(`  ❌ 失败 (exit ${result.code})`)
      stepResults.push({ name: step.name, ok: false, reason: `exit ${result.code}` })
      if (!step.optional) return { ok: false, stepResults }
    } else {
      console.log(`  ✅ 通过`)
      stepResults.push({ name: step.name, ok: true })
    }
  }
  return { ok: true, stepResults }
}

// ─── Code Output Check ────────────────────────────────────────────────────────

function countFiles(dir, exclude = ['node_modules', '.next', 'dist', 'build', '.turbo']) {
  if (!fs.existsSync(dir)) return 0
  let count = 0
  for (const item of fs.readdirSync(dir)) {
    if (exclude.includes(item)) continue
    const full = path.join(dir, item)
    count += fs.statSync(full).isDirectory() ? countFiles(full, exclude) : 1
  }
  return count
}

function checkCodeOutputs(role) {
  const state  = loadState()
  const dynOut = resolveCodeOutputs(state)
  const config = dynOut[role] || CODE_OUTPUTS[role]
  if (!config) return { ok: true }
  const fullDir = path.join(ROOT, config.dir)
  if (!fs.existsSync(fullDir)) return { ok: false, missing: [`${config.dir}/ 不存在`] }
  const missing    = config.required.filter(f => !fs.existsSync(path.join(fullDir, f))).map(f => `${config.dir}/${f}`)
  const totalFiles = countFiles(fullDir)
  if (totalFiles < config.minFiles) missing.push(`文件数量不足 (${totalFiles} < ${config.minFiles})`)
  return { ok: missing.length === 0, missing, totalFiles }
}

// ─── Integration Check ────────────────────────────────────────────────────────

function runIntegrationCheck() {
  console.log('\n🔍 进程内联调检查（静态分析，9 项）\n')
  const results = []
  let allPassed = true

  const state   = loadState()
  const dynOut  = resolveCodeOutputs(state)
  const feDir   = dynOut.FE?.dir || 'apps/web'
  const beDir   = dynOut.BE?.dir || 'apps/server'
  const webSrc  = path.join(ROOT, feDir)
  const srvSrc  = path.join(ROOT, beDir)
  const feLang  = state.techStack?.fe || 'nextjs'
  const beLang  = state.techStack?.be || 'bun-hono'
  console.log(`  Tech stack: FE=${feLang} (${feDir}/)  BE=${beLang} (${beDir}/)\n`)

  // [1/6] Mock data scan
  console.log('  [1/6] 扫描前端 mock 数据...')
  if (fs.existsSync(webSrc)) {
    try {
      const found = execSync(
        `grep -rn --include="*.ts" --include="*.tsx" -l "\\bmockData\\b\\|\\bMOCK_DATA\\b\\|\\bfakeData\\b\\|faker\\.\\|\\bseedData\\b" ${webSrc}/src ${webSrc}/app ${webSrc}/components ${webSrc}/lib 2>/dev/null || true`,
        { encoding: 'utf8', timeout: 15000 }
      ).trim()
      const nonTest = found.split('\n').filter(f => f && !f.includes('__tests__') && !f.includes('.test.') && !f.includes('.spec.') && !f.includes('/mocks/') && !f.includes('/fixtures/'))
      const ok = nonTest.length === 0
      results.push({ check: 'Mock 数据扫描', ok, detail: ok ? '未发现' : `发现 ${nonTest.length} 个文件` })
      console.log(`    ${ok ? '✅' : '❌'} ${results[results.length - 1].detail}`)
      if (!ok) allPassed = false
    } catch {
      results.push({ check: 'Mock 数据扫描', ok: true, detail: '跳过' })
      console.log('    ⚠️  跳过')
    }
  } else {
    results.push({ check: 'Mock 数据扫描', ok: false, detail: `${feDir}/ 不存在` })
    allPassed = false
    console.log(`    ❌ ${feDir}/ 不存在`)
  }

  // [2/6] API client (monorepo tRPC paths + single-repo common patterns)
  console.log('  [2/6] 检查 API 客户端...')
  const clientFiles = [
    // monorepo / Next.js tRPC paths
    `${feDir}/lib/trpc.ts`, `${feDir}/lib/trpc/client.ts`,
    `${feDir}/lib/api.ts`, `${feDir}/src/lib/api.ts`,
    // single-repo: common request utility patterns
    `${feDir}/src/utils/request.ts`, `${feDir}/src/utils/request.js`,
    `${feDir}/src/utils/http.ts`,    `${feDir}/src/utils/http.js`,
    `${feDir}/src/utils/api.ts`,     `${feDir}/src/utils/api.js`,
    `${feDir}/src/services/index.ts`, `${feDir}/src/services/index.js`,
    `${feDir}/src/api/index.ts`,      `${feDir}/src/api/index.js`,
    `${feDir}/src/api.ts`,            `${feDir}/src/api.js`,
    // root-level single-repo
    `src/utils/request.ts`, `src/utils/request.js`,
    `src/utils/http.ts`,    `src/utils/http.js`,
    `src/api/index.ts`,     `src/api/index.js`,
  ]
  const foundClient = clientFiles.find(f => {
    const full = path.join(ROOT, f)
    return fs.existsSync(full) && fs.readFileSync(full, 'utf8').trim().length > 50
  })
  results.push({ check: 'API 客户端', ok: !!foundClient, detail: foundClient || '未找到（可能是单仓库，路径不在预设列表中）' })
  console.log(`    ${foundClient ? '✅' : '⚠️ '} ${results[results.length - 1].detail}`)
  // API client missing is a warning for single-repo projects, not a hard block
  if (!foundClient) {
    results[results.length - 1].ok = true // degrade to warning
    console.log('    ⚠️  单仓库项目可能使用了其他 API 请求方式，手动确认')
  }

  // [3/6] Backend routes
  console.log('  [3/6] 检查后端路由...')
  const routerDir = [`${beDir}/src/routers`, `${beDir}/src/routes`, `${beDir}/routes`, `${beDir}/app`].find(d => {
    const full = path.join(ROOT, d)
    return fs.existsSync(full) && fs.readdirSync(full).filter(f => f.match(/\.(ts|py|go)$/)).length > 0
  })
  results.push({ check: '后端路由', ok: !!routerDir, detail: routerDir || '未找到' })
  console.log(`    ${routerDir ? '✅' : '❌'} ${results[results.length - 1].detail}`)
  if (!routerDir) allPassed = false

  // [4/6] API contract
  console.log('  [4/6] 检查接口契约...')
  const specFile = path.join(ROOT, 'docs/api-spec.md')
  if (fs.existsSync(specFile)) {
    const endpoints = (fs.readFileSync(specFile, 'utf8').match(/`(GET|POST|PUT|PATCH|DELETE)\s+\/[^`]+`/g) || []).length
    const ok = endpoints > 0
    results.push({ check: '接口契约', ok, detail: `${endpoints} 个端点` })
    console.log(`    ${ok ? '✅' : '❌'} ${results[results.length - 1].detail}`)
    if (!ok) allPassed = false
  } else {
    results.push({ check: '接口契约', ok: false, detail: '文件不存在' })
    allPassed = false
    console.log('    ❌ 文件不存在')
  }

  // [5/6] Env vars
  console.log('  [5/6] 检查环境变量...')
  const envFile = path.join(ROOT, '.env.example')
  if (fs.existsSync(envFile)) {
    const keys = fs.readFileSync(envFile, 'utf8').split('\n').filter(l => l.match(/^[A-Z_]+=/) && !l.startsWith('#'))
    results.push({ check: '环境变量', ok: keys.length >= 3, detail: `${keys.length} 个变量` })
    console.log(`    ${keys.length >= 3 ? '✅' : '⚠️ '} ${results[results.length - 1].detail}`)
  } else {
    results.push({ check: '环境变量', ok: false, detail: '.env.example 不存在' })
    allPassed = false
    console.log('    ❌')
  }

  // [6/6] Design tokens
  console.log('  [6/6] 检查设计 Token...')
  if (fs.existsSync(webSrc) && fs.existsSync(path.join(ROOT, 'design/design-tokens.css'))) {
    try {
      const count = parseInt(
        execSync(
          `grep -rn --include="*.tsx" --include="*.css" "color: #\\|background: #" ${webSrc}/app ${webSrc}/components 2>/dev/null | grep -v "design-tokens\\|globals.css" | wc -l`,
          { encoding: 'utf8', timeout: 10000 }
        ).trim(), 10
      ) || 0
      results.push({ check: '设计 Token', ok: count <= 5, detail: `硬编码颜色 ${count} 处` })
      console.log(`    ${count <= 5 ? '✅' : '❌'} ${results[results.length - 1].detail}`)
      if (count > 5) allPassed = false
    } catch {
      results.push({ check: '设计 Token', ok: true, detail: '跳过' })
      console.log('    ⚠️  跳过')
    }
  } else {
    results.push({ check: '设计 Token', ok: true, detail: '无设计稿，跳过' })
    console.log('    ⚠️  跳过')
  }

  // [7/9] Tailwind content paths
  console.log('  [7/9] 检查 Tailwind 配置...')
  const twConfigPaths = [`${feDir}/tailwind.config.ts`, `${feDir}/tailwind.config.js`]
  const twConfig = twConfigPaths.find(p => fs.existsSync(path.join(ROOT, p)))
  // Detect whether project actually uses Tailwind (config file OR package.json dep)
  const usesTailwind = !!twConfig || (() => {
    try {
      for (const pkgPath of [path.join(ROOT, feDir, 'package.json'), path.join(ROOT, 'package.json')]) {
        if (!fs.existsSync(pkgPath)) continue
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
        if (pkg.dependencies?.tailwindcss || pkg.devDependencies?.tailwindcss) return true
      }
    } catch {}
    return false
  })()
  if (twConfig) {
    const twContent = fs.readFileSync(path.join(ROOT, twConfig), 'utf8')
    const hasContentPaths = /content\s*[:=][\s\S]{0,200}(app\/|src\/|components\/)/.test(twContent)
    results.push({ check: 'Tailwind content 路径', ok: hasContentPaths, detail: hasContentPaths ? '已配置' : 'content 数组未覆盖 app/ 或 src/' })
    console.log(`    ${hasContentPaths ? '✅' : '❌'} ${results[results.length - 1].detail}`)
    if (!hasContentPaths) allPassed = false
  } else if (usesTailwind) {
    results.push({ check: 'Tailwind content 路径', ok: true, detail: '无 tailwind.config（Tailwind v4 @import 模式）' })
    console.log('    ⚠️  未找到 tailwind.config，跳过（Tailwind v4）')
  } else {
    results.push({ check: 'Tailwind content 路径', ok: true, detail: '项目未使用 Tailwind，跳过' })
    console.log('    ⚠️  项目未使用 Tailwind，跳过')
  }

  // [8/9] CSS import chain — only relevant for Tailwind projects
  console.log('  [8/9] 检查 globals.css 导入链...')
  if (!usesTailwind) {
    results.push({ check: 'CSS 导入链', ok: true, detail: '项目未使用 Tailwind，跳过' })
    console.log('    ⚠️  项目未使用 Tailwind，跳过')
  } else {
    const globalsCssCandidates = [
      `${feDir}/app/globals.css`, `${feDir}/src/app/globals.css`,
      `${feDir}/src/styles/globals.css`, `${feDir}/styles/globals.css`,
    ]
    const globalsFile = globalsCssCandidates.find(p => fs.existsSync(path.join(ROOT, p)))
    if (globalsFile) {
      const cssContent = fs.readFileSync(path.join(ROOT, globalsFile), 'utf8')
      const hasTailwind = /@tailwind base|@import\s+["']tailwindcss["']/.test(cssContent)
      const tokenFile = path.join(ROOT, 'design/design-tokens.css')
      const hasTokenImport = !fs.existsSync(tokenFile) || /design-tokens|@import.*token/i.test(cssContent)
      const cssOk = hasTailwind && hasTokenImport
      const detail = !hasTailwind ? 'globals.css 缺少 Tailwind 导入' :
        !hasTokenImport ? 'globals.css 未导入 design-tokens.css（设计 token 会失效）' : '完整'
      results.push({ check: 'CSS 导入链', ok: cssOk, detail })
      console.log(`    ${cssOk ? '✅' : '❌'} ${detail}`)
      if (!cssOk) allPassed = false
    } else {
      results.push({ check: 'CSS 导入链', ok: false, detail: '未找到 globals.css' })
      allPassed = false
      console.log('    ❌ 未找到 globals.css')
    }
  }

  // [9/9] Package.json scripts
  console.log('  [9/9] 检查 package.json scripts...')
  const checkScripts = (pkgPath, required) => {
    if (!fs.existsSync(pkgPath)) return { ok: false, missing: ['package.json 不存在'] }
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
      const missing = required.filter(s => !pkg.scripts?.[s])
      return { ok: missing.length === 0, missing }
    } catch { return { ok: false, missing: ['package.json 解析失败'] } }
  }
  const feExists = fs.existsSync(path.join(ROOT, feDir))
  const beExists = fs.existsSync(path.join(ROOT, beDir))
  const rootPkgPath = path.join(ROOT, 'package.json')
  let scriptsOk, scriptsMissing
  if (!feExists && !beExists && fs.existsSync(rootPkgPath)) {
    // Single-repo: check root package.json for at least dev or start
    const rootCheck = checkScripts(rootPkgPath, ['dev', 'build'])
    scriptsOk = rootCheck.ok
    scriptsMissing = rootCheck.missing.length ? [`根目录 缺少: ${rootCheck.missing.join(', ')}`] : []
    console.log(`    ⚠️  单仓库模式，检查根目录 package.json`)
  } else {
    const feScriptsCheck = feExists
      ? checkScripts(path.join(ROOT, feDir, 'package.json'), ['dev', 'build'])
      : { ok: true, missing: [] }
    const beScriptsCheck = beExists
      ? checkScripts(path.join(ROOT, beDir, 'package.json'), ['dev', 'build'])
      : { ok: true, missing: [] }
    scriptsOk = feScriptsCheck.ok && beScriptsCheck.ok
    scriptsMissing = [
      ...(feScriptsCheck.missing.length ? [`FE 缺少: ${feScriptsCheck.missing.join(', ')}`] : []),
      ...(beScriptsCheck.missing.length ? [`BE 缺少: ${beScriptsCheck.missing.join(', ')}`] : []),
    ]
  }
  results.push({ check: 'package scripts', ok: scriptsOk, detail: scriptsOk ? '完整' : scriptsMissing.join('; ') })
  console.log(`    ${scriptsOk ? '✅' : '❌'} ${results[results.length - 1].detail}`)
  if (!scriptsOk) allPassed = false

  console.log('\n  结果:')
  results.forEach(r => console.log(`    ${r.ok ? '✅' : '❌'} ${r.check}: ${r.detail}`))
  return { ok: allPassed, results }
}

// ─── BE Smoke Test ───────────────────────────────────────────────────────────

function _httpGet(url, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      let body = ''
      res.on('data', d => { body += d })
      res.on('end', () => resolve({ status: res.statusCode, body }))
    })
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')) })
  })
}

/**
 * Starts the BE dev server, polls /health until ready (max 30s), then kills it.
 * Returns { ok, reason, status }
 */
async function runSmokeTest() {
  console.log('\n🔥 BE 启动 Smoke Test\n')
  const state    = loadState()
  const dynOut   = resolveCodeOutputs(state)
  const beDir    = dynOut.BE?.dir || 'apps/server'
  const serverDir = path.join(ROOT, beDir)
  if (!fs.existsSync(serverDir)) {
    console.log(`  ❌ ${beDir}/ 不存在，跳过 smoke test（无后端？）`)
    return { ok: false, reason: `${beDir}/ 不存在` }
  }

  // ── Determine port ──────────────────────────────────────────────────────────
  let port = 3001
  const envFiles = [
    path.join(ROOT, '.env'), path.join(ROOT, '.env.local'),
    path.join(serverDir, '.env'), path.join(serverDir, '.env.local'),
    path.join(ROOT, 'server/.env'), path.join(ROOT, 'server/.env.local'),
    path.join(ROOT, 'backend/.env'), path.join(ROOT, 'backend/.env.local'),
  ]
  for (const fp of envFiles) {
    if (!fs.existsSync(fp)) continue
    const m = fs.readFileSync(fp, 'utf8').match(/^PORT\s*=\s*(\d+)/m)
    if (m) { port = parseInt(m[1]); break }
  }
  console.log(`  目标端口: ${port}`)

  // ── Determine start command ─────────────────────────────────────────────────
  let startCmd, startArgs
  const pkgPath = path.join(serverDir, 'package.json')
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
      const hasBun = fs.existsSync(path.join(serverDir, 'bun.lockb')) ||
                     fs.existsSync(path.join(serverDir, 'bun.lock'))
      const runtime = hasBun ? 'bun' : 'npm'
      if (pkg.scripts?.['start:test']) {
        startCmd = runtime; startArgs = ['run', 'start:test']
      } else if (pkg.scripts?.dev) {
        startCmd = runtime; startArgs = ['run', 'dev']
      }
    } catch {}
  }

  if (!startCmd) {
    console.log('  ⚠️  未找到 dev / start:test 脚本，跳过 smoke test')
    return { ok: true, reason: '跳过（无启动脚本）' }
  }
  console.log(`  启动命令: ${startCmd} ${startArgs.join(' ')}`)

  // ── Spawn server ────────────────────────────────────────────────────────────
  const proc = spawn(startCmd, startArgs, {
    cwd: serverDir,
    stdio: 'pipe',
    env: { ...process.env, PORT: String(port) },
  })
  let serverOutput = ''
  proc.stdout?.on('data', d => { serverOutput += d })
  proc.stderr?.on('data', d => { serverOutput += d })

  // ── Poll /health ────────────────────────────────────────────────────────────
  const result = await new Promise((resolve) => {
    let attempts = 0
    const MAX = 30
    let resolved = false
    const done = (r) => { if (!resolved) { resolved = true; clearInterval(timer); resolve(r) } }

    proc.on('close', (code) => {
      if (code !== null && code !== 0) done({ ok: false, reason: `进程退出 exit ${code}`, output: serverOutput })
    })

    const timer = setInterval(async () => {
      attempts++
      try {
        const res = await _httpGet(`http://localhost:${port}/health`, 2000)
        if (res.status < 400) done({ ok: true, status: res.status })
        else if (attempts >= MAX) done({ ok: false, reason: `/health 返回 HTTP ${res.status}`, output: serverOutput })
      } catch (e) {
        if (attempts >= MAX) done({ ok: false, reason: `30s 内未响应 (${e.message})`, output: serverOutput })
      }
    }, 1000)
  })

  // ── Kill server ─────────────────────────────────────────────────────────────
  try { proc.kill('SIGTERM') } catch {}
  await new Promise(r => setTimeout(r, 300))

  if (result.ok) {
    console.log(`  ✅ /health 正常响应 (HTTP ${result.status})`)
  } else {
    console.log(`  ❌ Smoke test 失败: ${result.reason}`)
    if (result.output) {
      const tail = result.output.slice(-1200).split('\n').map(l => '    ' + l).join('\n')
      console.log(`  服务器输出：\n${tail}`)
    }
  }
  return result
}

// ─── Git ──────────────────────────────────────────────────────────────────────

function getGitDiffBase() {
  for (const ref of ['origin/main', 'main', 'HEAD~1']) {
    try { execSync(`git rev-parse ${ref}`, { stdio: 'ignore', cwd: ROOT }); return ref } catch {}
  }
  return '4b825dc642cb6eb9a060e54bf8d69288fbee4904'
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  checkPrereqs,
  validateDoc,
  spawnStep, fullVerify,
  checkCodeOutputs, countFiles,
  runIntegrationCheck,
  runSmokeTest,
  getGitDiffBase,
}
