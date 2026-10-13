/**
 * tests/unit/state-io.test.js
 *
 * 针对真实 IO 层的回归测试（HARNESS_ROOT 隔离到临时目录）：
 *   - 损坏的 workflow-state.json：隔离备份 + 抛 E302，绝不静默重置
 *   - 旧纪元 schema 版本（v10–v15.x）→ 当前 1.x 的迁移
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'

describe('State IO — corrupted state file', () => {
  let tmpRoot

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-state-io-'))
    fs.mkdirSync(path.join(tmpRoot, 'state'), { recursive: true })
    process.env.HARNESS_ROOT = tmpRoot
    vi.resetModules()
  })

  afterEach(() => {
    delete process.env.HARNESS_ROOT
    fs.rmSync(tmpRoot, { recursive: true, force: true })
  })

  it('quarantines a corrupted state file and throws E302', async () => {
    const stateFile = path.join(tmpRoot, 'state', 'workflow-state.json')
    fs.writeFileSync(stateFile, '{ "currentState": "IDEA", broken')
    const { loadState } = await import('../../scripts/lib/state.js')

    let err
    try { loadState() } catch (e) { err = e }
    expect(err).toBeDefined()
    expect(err.code).toBe('E302')

    // 原文件被移走，损坏内容保留在 .corrupt-<ts> 备份中
    expect(fs.existsSync(stateFile)).toBe(false)
    const backups = fs.readdirSync(path.join(tmpRoot, 'state'))
      .filter(f => f.startsWith('workflow-state.json.corrupt-'))
    expect(backups).toHaveLength(1)
    expect(fs.readFileSync(path.join(tmpRoot, 'state', backups[0]), 'utf8'))
      .toContain('broken')
  })

  it('returns the default state when no state file exists', async () => {
    const { loadState } = await import('../../scripts/lib/state.js')
    const state = loadState()
    expect(state.currentState).toBe('IDEA')
    expect(state.schemaVersion).toBe('1.1')
  })
})

describe('State migration — legacy era versions', () => {
  it('migrates v15.1-era state to current schema', async () => {
    const { migrateState } = await import('../../scripts/lib/state.js')
    const { SCHEMA_VERSION } = await import('../../scripts/lib/config.js')
    const old = { schemaVersion: '15.1', currentState: 'IDEA' }
    const migrated = migrateState(old)
    expect(migrated.schemaVersion).toBe(SCHEMA_VERSION)
    expect(migrated).toHaveProperty('taskId')
    expect(migrated).toHaveProperty('autopilot')
  })

  it('migrates v10.0-era state to current schema', async () => {
    const { migrateState } = await import('../../scripts/lib/state.js')
    const { SCHEMA_VERSION } = await import('../../scripts/lib/config.js')
    const old = { schemaVersion: '10.0', currentState: 'PRD_DRAFT' }
    const migrated = migrateState(old)
    expect(migrated.schemaVersion).toBe(SCHEMA_VERSION)
    expect(migrated.currentState).toBe('PRD_DRAFT')
  })

  it('does not downgrade a newer same-era schema', async () => {
    const { migrateState } = await import('../../scripts/lib/state.js')
    // 同纪元（major < 10）且版本更新时保持原样，不迁移不降级
    const newer = { schemaVersion: '2.0', currentState: 'IDEA', customField: 'keep-me' }
    const result = migrateState(newer)
    expect(result.schemaVersion).toBe('2.0')
    expect(result.customField).toBe('keep-me')
  })
})
