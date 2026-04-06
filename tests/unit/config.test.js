import { describe, it, expect } from 'vitest'
import {
  STATES, TRANSITIONS, PREREQS, STALE_ARTIFACTS,
  AGENT_WRITE_PERMISSIONS, AGENT_MODEL_MAP,
  FEATURE_SKIP_STATES, FEATURE_PREREQS,
  HOTFIX_SKIP_STATES, HOTFIX_PREREQS,  // [v1.0.2 P1.1]
  ARTIFACT_STATE_MAP, DANGEROUS_BASH_PATTERNS,
  DOC_VALIDATORS, CONTEXT_BUDGET,
  AUTOPILOT_MODES, AUTOPILOT_SKIP_INTERACTIONS,
  MODEL_COSTS, COST_PER_MILLION,         // [v1.0.2 P1.5]
} from '../../scripts/lib/config.js'

describe('config.js — State Machine Consistency', () => {
  const stateNames = Object.keys(STATES)

  it('every state in STATES has a TRANSITIONS entry', () => {
    for (const state of stateNames) {
      expect(TRANSITIONS).toHaveProperty(state)
    }
  })

  it('every TRANSITIONS entry references a valid next state or null', () => {
    for (const [state, t] of Object.entries(TRANSITIONS)) {
      expect(stateNames).toContain(state)
      if (t.next !== null) {
        expect(stateNames).toContain(t.next)
      }
    }
  })

  it('only DONE has next=null', () => {
    for (const [state, t] of Object.entries(TRANSITIONS)) {
      if (state === 'DONE') {
        expect(t.next).toBeNull()
      } else {
        expect(t.next).not.toBeNull()
      }
    }
  })

  it('every PREREQS key is a valid state name', () => {
    for (const state of Object.keys(PREREQS)) {
      expect(stateNames).toContain(state)
    }
  })

  it('every STALE_ARTIFACTS key is a valid state name', () => {
    for (const state of Object.keys(STALE_ARTIFACTS)) {
      expect(stateNames).toContain(state)
    }
  })

  it('every FEATURE_SKIP_STATES entry is a valid state name', () => {
    for (const state of FEATURE_SKIP_STATES) {
      expect(stateNames).toContain(state)
    }
  })

  it('every HOTFIX_SKIP_STATES entry is a valid state name', () => {
    for (const state of HOTFIX_SKIP_STATES) {
      expect(stateNames).toContain(state)
    }
  })

  it('every FEATURE_PREREQS key is a valid state name', () => {
    for (const state of Object.keys(FEATURE_PREREQS)) {
      expect(stateNames).toContain(state)
    }
  })

  it('every HOTFIX_PREREQS key is a valid state name', () => {
    for (const state of Object.keys(HOTFIX_PREREQS)) {
      expect(stateNames).toContain(state)
    }
  })

  it('ARTIFACT_STATE_MAP completedState values are valid state names', () => {
    for (const [, info] of Object.entries(ARTIFACT_STATE_MAP)) {
      expect(stateNames).toContain(info.completedState)
    }
  })

  it('ARTIFACT_STATE_MAP validatorKey references exist in DOC_VALIDATORS', () => {
    const validatorKeys = Object.keys(DOC_VALIDATORS)
    for (const [file, info] of Object.entries(ARTIFACT_STATE_MAP)) {
      if (info.validatorKey !== null) {
        expect(validatorKeys, `${file} references unknown validator: ${info.validatorKey}`).toContain(info.validatorKey)
      }
    }
  })

  it('state machine forms a connected linear chain from IDEA to DONE', () => {
    let current = 'IDEA'
    const visited = new Set()
    while (current !== null) {
      expect(visited.has(current)).toBe(false) // no cycles
      visited.add(current)
      current = TRANSITIONS[current]?.next
    }
    expect(visited.size).toBe(stateNames.length)
    expect(visited.has('IDEA')).toBe(true)
    expect(visited.has('DONE')).toBe(true)
  })

  it('MANUAL states match expected list', () => {
    const manualStates = stateNames.filter(s => STATES[s].manual)
    expect(manualStates).toEqual(
      expect.arrayContaining(['PRD_DRAFT', 'CEO_REVIEW', 'DESIGN_PHASE', 'QA_PHASE', 'DEPLOY_PREP'])
    )
    expect(manualStates.length).toBe(5)
  })
})

describe('config.js — Agent Write Permissions', () => {
  // AGENT_MODEL_MAP contains both tier keys (TIER_HEAVY, TIER_STANDARD, etc.)
  // and agent→tier mappings. Only check actual agent names.
  const TIER_KEYS = new Set(['TIER_HEAVY', 'TIER_STANDARD', 'TIER_FAST', 'TIER_AUDIT'])

  it('every agent in AGENT_MODEL_MAP has a AGENT_WRITE_PERMISSIONS entry', () => {
    for (const agent of Object.keys(AGENT_MODEL_MAP)) {
      if (TIER_KEYS.has(agent)) continue  // skip tier keys
      expect(AGENT_WRITE_PERMISSIONS, `Missing permissions for agent: ${agent}`).toHaveProperty(agent)
    }
  })

  it('general-assistant has empty allowedPaths (read-only)', () => {
    expect(AGENT_WRITE_PERMISSIONS['general-assistant'].allowedPaths).toEqual([])
  })

  it('code-reviewer can only write docs/code-review.md', () => {
    expect(AGENT_WRITE_PERMISSIONS['code-reviewer'].allowedPaths).toEqual(['docs/code-review.md'])
  })

  it('every permission entry has allowedPaths array and reason string', () => {
    for (const [agent, perm] of Object.entries(AGENT_WRITE_PERMISSIONS)) {
      expect(Array.isArray(perm.allowedPaths), `${agent}.allowedPaths should be array`).toBe(true)
      expect(typeof perm.reason, `${agent}.reason should be string`).toBe('string')
    }
  })
})

describe('config.js — Model Cost Table [v1.0.2 P1.5]', () => {
  it('COST_PER_MILLION has entries for all tiers', () => {
    expect(COST_PER_MILLION).toHaveProperty('TIER_HEAVY')
    expect(COST_PER_MILLION).toHaveProperty('TIER_STANDARD')
    expect(COST_PER_MILLION).toHaveProperty('TIER_FAST')
    expect(COST_PER_MILLION).toHaveProperty('TIER_AUDIT')
  })

  it('COST_PER_MILLION values are positive numbers', () => {
    for (const [tier, cost] of Object.entries(COST_PER_MILLION)) {
      expect(cost, `${tier} cost should be positive`).toBeGreaterThan(0)
    }
  })

  it('MODEL_COSTS has cost for each model', () => {
    expect(MODEL_COSTS['claude-sonnet-4-6']).toBeGreaterThan(0)
    expect(MODEL_COSTS['claude-haiku-4-5-20251001']).toBeGreaterThan(0)
    expect(MODEL_COSTS['claude-opus-4-6']).toBeGreaterThan(0)
  })

  it('heavier tiers cost more than lighter tiers', () => {
    expect(COST_PER_MILLION.TIER_HEAVY).toBeGreaterThan(COST_PER_MILLION.TIER_FAST)
    expect(COST_PER_MILLION.TIER_STANDARD).toBeGreaterThan(COST_PER_MILLION.TIER_AUDIT)
  })
})

describe('config.js — Dangerous Bash Patterns', () => {
  it('has patterns for drizzle push, rm state, and state overwrite', () => {
    expect(DANGEROUS_BASH_PATTERNS.length).toBeGreaterThanOrEqual(3)
    const patterns = DANGEROUS_BASH_PATTERNS.map(r => r.pattern.source)
    expect(patterns.some(p => p.includes('drizzle'))).toBe(true)
    expect(patterns.some(p => p.includes('rm'))).toBe(true)
    expect(patterns.some(p => p.includes('workflow-state'))).toBe(true)
  })

  it('every rule has pattern, check function, and message', () => {
    for (const rule of DANGEROUS_BASH_PATTERNS) {
      expect(rule.pattern).toBeInstanceOf(RegExp)
      expect(typeof rule.check).toBe('function')
      expect(typeof rule.message).toBe('string')
    }
  })
})

describe('config.js — Context Budget Config', () => {
  it('has valid thresholds', () => {
    expect(CONTEXT_BUDGET.WARN_THRESHOLD).toBeGreaterThan(0)
    expect(CONTEXT_BUDGET.WARN_THRESHOLD).toBeLessThan(1)
    expect(CONTEXT_BUDGET.REREAD_THRESHOLD).toBeGreaterThan(CONTEXT_BUDGET.WARN_THRESHOLD)
    expect(CONTEXT_BUDGET.REREAD_THRESHOLD).toBeLessThan(1)
  })

  it('CRITICAL_DOCS has entries for known agent roles', () => {
    expect(CONTEXT_BUDGET.CRITICAL_DOCS).toHaveProperty('fe')
    expect(CONTEXT_BUDGET.CRITICAL_DOCS).toHaveProperty('be')
    expect(CONTEXT_BUDGET.CRITICAL_DOCS).toHaveProperty('reviewer')
    expect(CONTEXT_BUDGET.CRITICAL_DOCS).toHaveProperty('qa')
  })
})

describe('config.js — DOC_VALIDATORS', () => {
  it('every validator has file and checks array', () => {
    for (const [key, v] of Object.entries(DOC_VALIDATORS)) {
      expect(typeof v.file, `${key}.file should be string`).toBe('string')
      expect(Array.isArray(v.checks), `${key}.checks should be array`).toBe(true)
      expect(v.checks.length, `${key} should have at least 1 check`).toBeGreaterThan(0)
    }
  })

  it('every check has name and either pattern or fn', () => {
    for (const [key, v] of Object.entries(DOC_VALIDATORS)) {
      for (const check of v.checks) {
        expect(typeof check.name, `${key} check missing name`).toBe('string')
        const hasPattern = check.pattern instanceof RegExp
        const hasFn = typeof check.fn === 'function'
        expect(hasPattern || hasFn, `${key}.${check.name} needs pattern or fn`).toBe(true)
      }
    }
  })
})
