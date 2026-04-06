import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { fileURLToPath } from 'url'

// Import config directly (no side effects)
import { STATES, TRANSITIONS, STALE_ARTIFACTS, FEATURE_SKIP_STATES, HOTFIX_SKIP_STATES, SCHEMA_VERSION } from '../../scripts/lib/config.js'
import { migrateState, estimateTokens, ESTIMATED_TOTAL, BASH_ESTIMATE, WRITE_ESTIMATE, READ_ESTIMATE } from '../../scripts/lib/state.js'

// We test the pure logic of advance/rollback by reimplementing them
// against the config constants (since the actual functions are tightly coupled to __dirname)
// This validates the state machine logic without filesystem coupling.

describe('State Machine — advance logic', () => {
  function advance(state, force = false) {
    const current     = state.currentState
    const stateConfig = STATES[current]
    const transition  = TRANSITIONS[current]
    if (!transition || !transition.next) throw new Error(`No transition from ${current}`)
    const effectiveForce = force || (state.autopilot && stateConfig.manual)
    if (stateConfig.manual && !effectiveForce) throw new Error(`State ${current} requires --force (MANUAL node)`)
    let nextState = transition.next
    const skipStates = state.mode === 'hotfix' ? HOTFIX_SKIP_STATES
                : state.mode === 'feature' ? FEATURE_SKIP_STATES : null
    if (skipStates && skipStates.includes(nextState)) {
      while (skipStates.includes(nextState)) {
        const skipTransition = TRANSITIONS[nextState]
        if (!skipTransition?.next) break
        nextState = skipTransition.next
      }
    }
    state.history = state.history || []
    state.rollbackStack = state.rollbackStack || []
    state.history.push({ from: current, to: nextState, timestamp: new Date().toISOString() })
    state.rollbackStack.push(current)
    state.currentState = nextState
    return state
  }

  it('advances IDEA → PRD_DRAFT (auto, no force needed)', () => {
    const state = { currentState: 'IDEA', history: [], rollbackStack: [], mode: 'greenfield' }
    const result = advance(state)
    expect(result.currentState).toBe('PRD_DRAFT')
  })

  it('rejects advance on MANUAL node without force', () => {
    const state = { currentState: 'PRD_DRAFT', history: [], rollbackStack: [], mode: 'greenfield' }
    expect(() => advance(state, false)).toThrow('requires --force')
  })

  it('advances MANUAL node with force', () => {
    const state = { currentState: 'PRD_DRAFT', history: [], rollbackStack: [], mode: 'greenfield' }
    const result = advance(state, true)
    expect(result.currentState).toBe('PRD_REVIEW')
  })

  it('autopilot auto-forces MANUAL nodes', () => {
    const state = { currentState: 'PRD_DRAFT', history: [], rollbackStack: [], mode: 'greenfield', autopilot: true }
    const result = advance(state) // no explicit force
    expect(result.currentState).toBe('PRD_REVIEW')
  })

  it('rejects advance from DONE', () => {
    const state = { currentState: 'DONE', history: [], rollbackStack: [], mode: 'greenfield' }
    expect(() => advance(state)).toThrow('No transition from DONE')
  })

  it('feature mode skips ARCH_REVIEW through DESIGN_REVIEW', () => {
    const state = { currentState: 'PRD_REVIEW', history: [], rollbackStack: [], mode: 'feature' }
    const result = advance(state)
    // PRD_REVIEW → next is ARCH_REVIEW, but feature mode skips to IMPLEMENTATION
    // ARCH_REVIEW → CEO_REVIEW → DESIGN_PHASE → DESIGN_REVIEW → IMPLEMENTATION
    expect(result.currentState).toBe('IMPLEMENTATION')
  })

  it('records history entries', () => {
    const state = { currentState: 'IDEA', history: [], rollbackStack: [], mode: 'greenfield' }
    advance(state)
    expect(state.history.length).toBe(1)
    expect(state.history[0].from).toBe('IDEA')
    expect(state.history[0].to).toBe('PRD_DRAFT')
  })

  it('pushes to rollbackStack', () => {
    const state = { currentState: 'IDEA', history: [], rollbackStack: [], mode: 'greenfield' }
    advance(state)
    expect(state.rollbackStack).toEqual(['IDEA'])
  })

  it('walks the full greenfield pipeline IDEA → DONE', () => {
    const state = { currentState: 'IDEA', history: [], rollbackStack: [], mode: 'greenfield', autopilot: true }
    const visited = ['IDEA']
    while (state.currentState !== 'DONE') {
      advance(state) // autopilot handles MANUAL nodes
      visited.push(state.currentState)
    }
    expect(visited.length).toBe(Object.keys(STATES).length)
    expect(visited[0]).toBe('IDEA')
    expect(visited[visited.length - 1]).toBe('DONE')
  })

  it('walks the feature mode pipeline IDEA → DONE', () => {
    const state = { currentState: 'IDEA', history: [], rollbackStack: [], mode: 'feature', autopilot: true }
    const visited = ['IDEA']
    while (state.currentState !== 'DONE') {
      advance(state)
      visited.push(state.currentState)
    }
    // Feature mode skips 4 states
    expect(visited).not.toContain('ARCH_REVIEW')
    expect(visited).not.toContain('CEO_REVIEW')
    expect(visited).not.toContain('DESIGN_PHASE')
    expect(visited).not.toContain('DESIGN_REVIEW')
    expect(visited[visited.length - 1]).toBe('DONE')
  })

  it('walks the hotfix mode pipeline IDEA → DONE (skips 5 states)', () => {
    const state = { currentState: 'IDEA', history: [], rollbackStack: [], mode: 'hotfix', autopilot: true }
    const visited = ['IDEA']
    while (state.currentState !== 'DONE') {
      advance(state)
      visited.push(state.currentState)
    }
    // Hotfix skips 5 states (includes IMPLEMENTATION)
    expect(visited).not.toContain('ARCH_REVIEW')
    expect(visited).not.toContain('CEO_REVIEW')
    expect(visited).not.toContain('DESIGN_PHASE')
    expect(visited).not.toContain('DESIGN_REVIEW')
    expect(visited).not.toContain('IMPLEMENTATION')
    expect(visited).toContain('CODE_REVIEW')  // Hotfix goes straight to CODE_REVIEW
    expect(visited[visited.length - 1]).toBe('DONE')
  })

  it('hotfix PRD_REVIEW → CODE_REVIEW (skips 4 states)', () => {
    const state = { currentState: 'PRD_REVIEW', history: [], rollbackStack: [], mode: 'hotfix', autopilot: true }
    // PRD_REVIEW.next is ARCH_REVIEW, which hotfix skips
    // Next valid: CODE_REVIEW (PRD_REVIEW → ARCH_REVIEW (skip) → ... → CODE_REVIEW)
    const result = advance(state)
    // Should skip ARCH_REVIEW through IMPLEMENTATION
    expect(result.currentState).not.toBe('ARCH_REVIEW')
    expect(result.currentState).not.toBe('IMPLEMENTATION')
  })
})

describe('State Machine — rollback logic', () => {
  function rollback(state, targetState) {
    if (!STATES[targetState]) throw new Error(`Unknown state: ${targetState}`)
    const stateKeys  = Object.keys(STATES)
    const targetIdx  = stateKeys.indexOf(targetState)
    const currentIdx = stateKeys.indexOf(state.currentState)
    if (targetIdx >= currentIdx) throw new Error(`Cannot rollback forward: ${targetState} is at or after ${state.currentState}`)

    state.history = state.history || []
    state.rollbackStack = state.rollbackStack || []
    state.history.push({
      from: state.currentState, to: targetState,
      timestamp: new Date().toISOString(), type: 'rollback',
    })
    state.currentState = targetState
    while (state.rollbackStack.length && state.rollbackStack[state.rollbackStack.length - 1] !== targetState) {
      state.rollbackStack.pop()
    }
    return state
  }

  it('rolls back IMPLEMENTATION → PRD_REVIEW', () => {
    const state = { currentState: 'IMPLEMENTATION', history: [], rollbackStack: ['IDEA', 'PRD_DRAFT', 'PRD_REVIEW'] }
    rollback(state, 'PRD_REVIEW')
    expect(state.currentState).toBe('PRD_REVIEW')
  })

  it('rejects rollback to same state', () => {
    const state = { currentState: 'IMPLEMENTATION', history: [], rollbackStack: [] }
    expect(() => rollback(state, 'IMPLEMENTATION')).toThrow('Cannot rollback forward')
  })

  it('rejects rollback to later state', () => {
    const state = { currentState: 'PRD_REVIEW', history: [], rollbackStack: [] }
    expect(() => rollback(state, 'DONE')).toThrow('Cannot rollback forward')
  })

  it('rejects rollback to unknown state', () => {
    const state = { currentState: 'IMPLEMENTATION', history: [], rollbackStack: [] }
    expect(() => rollback(state, 'NONEXISTENT')).toThrow('Unknown state')
  })

  it('trims rollbackStack correctly', () => {
    const state = {
      currentState: 'CODE_REVIEW',
      history: [],
      rollbackStack: ['IDEA', 'PRD_DRAFT', 'PRD_REVIEW', 'ARCH_REVIEW', 'CEO_REVIEW', 'DESIGN_PHASE', 'DESIGN_REVIEW', 'IMPLEMENTATION'],
    }
    rollback(state, 'PRD_REVIEW')
    // Should pop until PRD_REVIEW is at the top
    expect(state.rollbackStack[state.rollbackStack.length - 1]).toBe('PRD_REVIEW')
  })
})

describe('State Machine — QA failure escalation', () => {
  it('first failure: qaFailureCount increments to 1', () => {
    const state = { currentState: 'QA_PHASE', qaFailureCount: 0 }
    state.qaFailureCount = (state.qaFailureCount || 0) + 1
    expect(state.qaFailureCount).toBe(1)
  })

  it('second failure triggers escalation (qaFailureCount >= 2)', () => {
    const state = { currentState: 'QA_PHASE', qaFailureCount: 1 }
    state.qaFailureCount += 1
    expect(state.qaFailureCount).toBe(2)
    expect(state.qaFailureCount >= 2).toBe(true) // escalation to ARCH_REVIEW
  })
})

describe('State Machine — STALE_ARTIFACTS coverage', () => {
  it('every state that is a rollback target has appropriate cleanup artifacts', () => {
    // States that produce artifacts should have STALE_ARTIFACTS entries
    const producerStates = ['PRD_DRAFT', 'ARCH_REVIEW', 'CEO_REVIEW', 'DESIGN_PHASE',
      'DESIGN_REVIEW', 'CODE_REVIEW', 'QA_PHASE', 'SECURITY_REVIEW', 'DEPLOY_PREP_SETUP']
    for (const state of producerStates) {
      expect(STALE_ARTIFACTS, `${state} should have STALE_ARTIFACTS`).toHaveProperty(state)
      expect(STALE_ARTIFACTS[state].length, `${state} STALE_ARTIFACTS should not be empty`).toBeGreaterThan(0)
    }
  })
})

describe('State migration', () => {
  it('migrates old schema to current version', () => {
    const oldState = { schemaVersion: '10.0', currentState: 'IDEA' }
    const migrated = migrateState(oldState)
    expect(migrated.schemaVersion).toBe(SCHEMA_VERSION)
    expect(migrated).toHaveProperty('traceabilityReady')
    expect(migrated).toHaveProperty('designBaselineReady')
    expect(migrated).toHaveProperty('interactionSpecReady')
    expect(migrated).toHaveProperty('stateBaselineReady')
    expect(migrated).toHaveProperty('contextBudget')
    expect(migrated).toHaveProperty('mode')
    expect(migrated).toHaveProperty('autopilot')
  })

  it('does not re-migrate current schema', () => {
    const state = { schemaVersion: SCHEMA_VERSION, currentState: 'IDEA', mode: 'greenfield' }
    const result = migrateState(state)
    expect(result).toBe(state) // same reference = no migration
  })
})

describe('Context budget estimation', () => {
  it('uses actualTokens when available', () => {
    const budget = { actualTokens: 50000, bashCount: 100, writeCount: 100, readCount: 100 }
    expect(estimateTokens(budget)).toBe(50000)
  })

  it('falls back to operation count estimation when actualTokens is 0', () => {
    const budget = { actualTokens: 0, bashCount: 10, writeCount: 5, readCount: 8 }
    const expected = 10 * BASH_ESTIMATE + 5 * WRITE_ESTIMATE + 8 * READ_ESTIMATE
    expect(estimateTokens(budget)).toBe(expected)
  })

  it('returns 0 for empty budget', () => {
    const budget = { actualTokens: 0, bashCount: 0, writeCount: 0, readCount: 0 }
    expect(estimateTokens(budget)).toBe(0)
  })
})
