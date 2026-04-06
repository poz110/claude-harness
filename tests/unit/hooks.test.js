import { describe, it, expect } from 'vitest'
import { AGENT_WRITE_PERMISSIONS, DANGEROUS_BASH_PATTERNS } from '../../scripts/lib/config.js'
import { ROOT } from '../../scripts/lib/state.js'

// Since hooks.js uses process.exit() and reads from stdin, we test the permission
// logic by reimplementing the core check functions rather than calling hookPreWrite directly.

/**
 * Simulates the hookPreWrite permission check logic (extracted from hooks.js).
 * Returns { allowed: boolean, reason?: string, warned?: boolean }
 */
function checkWritePermission(relPath, agentName) {
  // Rule 1: Block state file
  if (relPath === 'state/workflow-state.json') {
    return { allowed: false, reason: 'direct state file write blocked' }
  }

  // Rule 2: Agent whitelist
  if (agentName && AGENT_WRITE_PERMISSIONS[agentName]) {
    const perm = AGENT_WRITE_PERMISSIONS[agentName]
    const allowed = perm.allowedPaths.length === 0
      ? false
      : perm.allowedPaths.some(p => relPath === p || relPath.startsWith(p))
    if (!allowed) {
      return { allowed: false, reason: `${agentName} not permitted to write ${relPath}` }
    }
    return { allowed: true }
  }

  // Rule 3 (P0.2 fix): agentName is null — warn on protected paths
  if (!agentName) {
    const allProtectedPrefixes = new Set()
    for (const [, perm] of Object.entries(AGENT_WRITE_PERMISSIONS)) {
      for (const p of perm.allowedPaths) {
        allProtectedPrefixes.add(p)
      }
    }
    const isProtected = [...allProtectedPrefixes].some(p => relPath === p || relPath.startsWith(p))
    if (isProtected) {
      return { allowed: true, warned: true, reason: 'agentName not set, writing to protected path' }
    }
  }

  return { allowed: true }
}

describe('hookPreWrite — State File Protection', () => {
  it('blocks direct writes to state/workflow-state.json', () => {
    const result = checkWritePermission('state/workflow-state.json', 'fullstack-engineer')
    expect(result.allowed).toBe(false)
  })

  it('blocks even with null agentName', () => {
    const result = checkWritePermission('state/workflow-state.json', null)
    expect(result.allowed).toBe(false)
  })
})

describe('hookPreWrite — Agent Write Permissions', () => {
  it('allows product-manager to write docs/prd.md', () => {
    const result = checkWritePermission('docs/prd.md', 'product-manager')
    expect(result.allowed).toBe(true)
  })

  it('blocks product-manager from writing docs/arch-decision.md', () => {
    const result = checkWritePermission('docs/arch-decision.md', 'product-manager')
    expect(result.allowed).toBe(false)
  })

  it('allows fullstack-engineer to write apps/web/src/page.tsx', () => {
    const result = checkWritePermission('apps/web/src/page.tsx', 'fullstack-engineer')
    expect(result.allowed).toBe(true)
  })

  it('allows fullstack-engineer to write docs/api-spec.md', () => {
    const result = checkWritePermission('docs/api-spec.md', 'fullstack-engineer')
    expect(result.allowed).toBe(true)
  })

  it('blocks fullstack-engineer from writing docs/prd.md', () => {
    const result = checkWritePermission('docs/prd.md', 'fullstack-engineer')
    expect(result.allowed).toBe(false)
  })

  it('blocks general-assistant from writing any file', () => {
    const paths = ['docs/prd.md', 'apps/web/x.ts', 'README.md', 'state/x.json']
    for (const p of paths) {
      const result = checkWritePermission(p, 'general-assistant')
      expect(result.allowed, `general-assistant should not write ${p}`).toBe(false)
    }
  })

  it('blocks code-reviewer from writing code files', () => {
    const result = checkWritePermission('apps/web/src/page.tsx', 'code-reviewer')
    expect(result.allowed).toBe(false)
  })

  it('allows code-reviewer to write docs/code-review.md', () => {
    const result = checkWritePermission('docs/code-review.md', 'code-reviewer')
    expect(result.allowed).toBe(true)
  })

  it('allows software-architect to write docs/arch-decision.md', () => {
    const result = checkWritePermission('docs/arch-decision.md', 'software-architect')
    expect(result.allowed).toBe(true)
  })

  it('allows software-architect to write docs/traceability-matrix.md', () => {
    const result = checkWritePermission('docs/traceability-matrix.md', 'software-architect')
    expect(result.allowed).toBe(true)
  })

  it('blocks software-architect from writing code', () => {
    const result = checkWritePermission('apps/server/src/index.ts', 'software-architect')
    expect(result.allowed).toBe(false)
  })

  it('allows ux-designer to write design/ directory files', () => {
    const result = checkWritePermission('design/home/desktop.html', 'ux-designer')
    expect(result.allowed).toBe(true)
  })

  it('allows devops-engineer to write .github/ files', () => {
    const result = checkWritePermission('.github/workflows/ci.yml', 'devops-engineer')
    expect(result.allowed).toBe(true)
  })

  it('allows devops-engineer to write Dockerfile', () => {
    const result = checkWritePermission('Dockerfile', 'devops-engineer')
    expect(result.allowed).toBe(true)
  })
})

describe('hookPreWrite — P0.2 Fix: Null agentName Protection', () => {
  it('warns when agentName is null and writing to docs/prd.md (protected path)', () => {
    const result = checkWritePermission('docs/prd.md', null)
    expect(result.allowed).toBe(true) // allowed but warned
    expect(result.warned).toBe(true)
  })

  it('warns when agentName is null and writing to apps/ (protected path)', () => {
    const result = checkWritePermission('apps/web/src/page.tsx', null)
    expect(result.allowed).toBe(true)
    expect(result.warned).toBe(true)
  })

  it('warns when agentName is null and writing to state/ (protected path)', () => {
    const result = checkWritePermission('state/something.json', null)
    expect(result.allowed).toBe(true)
    expect(result.warned).toBe(true)
  })

  it('does not warn for unprotected paths with null agentName', () => {
    const result = checkWritePermission('README.md', null)
    expect(result.allowed).toBe(true)
    expect(result.warned).toBeUndefined()
  })

  it('does not warn for unknown agent not in permissions list', () => {
    const result = checkWritePermission('docs/prd.md', 'some-random-agent')
    expect(result.allowed).toBe(true)
    expect(result.warned).toBeUndefined()
  })
})

describe('hookPreWrite — Permission Coverage', () => {
  it('all registered agents have at least one allowed path or are explicitly read-only', () => {
    for (const [agent, perm] of Object.entries(AGENT_WRITE_PERMISSIONS)) {
      // Every agent should either have paths or be intentionally empty (read-only)
      expect(Array.isArray(perm.allowedPaths)).toBe(true)
    }
  })

  it('no two non-deprecated agents share the exact same write path for docs/', () => {
    // Exception: traceability-matrix.md is shared (architect + fullstack) — that's intentional
    const docPaths = {}
    const deprecatedAgents = ['frontend-engineer', 'backend-engineer']
    for (const [agent, perm] of Object.entries(AGENT_WRITE_PERMISSIONS)) {
      if (deprecatedAgents.includes(agent)) continue
      for (const p of perm.allowedPaths) {
        if (p.startsWith('docs/') && !p.endsWith('/')) {
          if (!docPaths[p]) docPaths[p] = []
          docPaths[p].push(agent)
        }
      }
    }
    // Check: only traceability-matrix.md should have multiple owners
    for (const [docPath, agents] of Object.entries(docPaths)) {
      if (docPath === 'docs/traceability-matrix.md') continue
      expect(agents.length, `${docPath} is owned by multiple agents: ${agents.join(', ')}`).toBe(1)
    }
  })
})

describe('Dangerous Bash Patterns', () => {
  it('matches drizzle-kit push', () => {
    const rule = DANGEROUS_BASH_PATTERNS.find(r => r.pattern.test('drizzle-kit push'))
    expect(rule).toBeDefined()
  })

  it('matches rm -rf state/', () => {
    const rule = DANGEROUS_BASH_PATTERNS.find(r => r.pattern.test('rm -rf state/'))
    expect(rule).toBeDefined()
    expect(rule.check()).toBe(true) // always blocked
  })

  it('matches state file overwrite', () => {
    const rule = DANGEROUS_BASH_PATTERNS.find(r => r.pattern.test('> state/workflow-state.json'))
    expect(rule).toBeDefined()
    expect(rule.check()).toBe(true)
  })

  it('does not match safe commands', () => {
    const safeCmds = ['npm run build', 'git status', 'cat docs/prd.md', 'node scripts/workflow.js status']
    for (const cmd of safeCmds) {
      const matched = DANGEROUS_BASH_PATTERNS.some(r => r.pattern.test(cmd) && r.check())
      expect(matched, `Should not block: ${cmd}`).toBe(false)
    }
  })
})
