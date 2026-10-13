/**
 * tests/unit/cli-surface.test.js
 *
 * CLI 表面一致性回归测试：
 *   1. help 文本中记录的每个命令都必须有对应的 case handler
 *      （防止 update-progress 这类“文档有、实现无”的腐烂）
 *   2. 关键命令确实存在 handler（冒烟断言）
 *   3. scripts/ 与 plugins/claude-harness/scripts/ 镜像一致
 */
import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.join(__dirname, '../..')
const SRC = fs.readFileSync(path.join(REPO_ROOT, 'scripts/workflow.js'), 'utf8')

/** 从 default 分支的 help 模板字符串中提取记录的命令名 */
function documentedCommands() {
  const m = SRC.match(/default:\s*\n\s*console\.log\(`([\s\S]*?)`\)/)
  if (!m) throw new Error('help template literal not found in workflow.js')
  const cmds = new Set()
  for (const line of m[1].split('\n')) {
    // 命令行形如：  "  status                          Current state + ..."
    // 排除散文行（含 → 映射说明、node scripts/... 示例等）
    if (line.includes('→') || line.includes('scripts/')) continue
    const mm = line.match(/^ {2}([a-z][a-z0-9]*(?:-[a-z0-9]+)*)(?:\s|$)/)
    if (mm) cmds.add(mm[1])
  }
  return [...cmds]
}

describe('CLI surface — documented commands have handlers', () => {
  const cmds = documentedCommands()

  it('help text lists at least 30 commands', () => {
    expect(cmds.length).toBeGreaterThanOrEqual(30)
  })

  it.each(cmds)('"%s" has a case handler', (cmd) => {
    expect(SRC).toContain(`case '${cmd}':`)
  })

  it.each(['update-progress', 'fallback-notify', 'write-agent-result', 'qa-failure', 'security-reaudit'])(
    'critical command "%s" is implemented', (cmd) => {
      expect(SRC).toContain(`case '${cmd}':`)
    })
})

describe('Plugin mirror — scripts/ ↔ plugins/claude-harness/scripts/', () => {
  const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex')

  function collect(dir) {
    const out = {}
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) Object.assign(out, collect(full))
      else if (entry.name.endsWith('.js') || entry.name.endsWith('.sh')) {
        out[path.relative(dir, full)] = sha(full)
      }
    }
    return out
  }

  it('all mirrored script files are byte-identical', () => {
    const rootFiles = collect(path.join(REPO_ROOT, 'scripts'))
    delete rootFiles['bump-version.js'] // 仅存在于根目录，按 CLAUDE.md 规则无需同步
    const pluginFiles = collect(path.join(REPO_ROOT, 'plugins/claude-harness/scripts'))

    const drift = []
    for (const [rel, hash] of Object.entries(rootFiles)) {
      if (!(rel in pluginFiles)) drift.push(`missing in plugin: ${rel}`)
      else if (pluginFiles[rel] !== hash) drift.push(`content drift: ${rel}`)
    }
    for (const rel of Object.keys(pluginFiles)) {
      if (!(rel in rootFiles)) drift.push(`extra in plugin: ${rel}`)
    }
    expect(drift).toEqual([])
  })
})
