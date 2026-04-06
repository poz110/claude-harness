'use strict'
/**
 * errors.js — v14.4
 *
 * 职责：统一的错误码定义和错误类
 *   - 标准化错误码（E001-E499）
 *   - 错误类层级（WorkflowError → StateError/HookError/ValidationError/IOError/AgentError）
 *   - 错误上下文、提示和可序列化输出
 *
 * 错误码范围：
 *   E001-E099: State machine errors
 *   E100-E199: Hook errors
 *   E200-E299: Validation errors
 *   E300-E399: IO errors
 *   E400-E499: Agent errors
 */

// ─── Error Code Definitions ───────────────────────────────────────────────────

const ERROR_CODES = {
  // ── State Machine Errors (E001-E099) ─────────────────────────────────────
  E001: {
    message: 'No transition from current state',
    category: 'state',
    hint: 'Check TRANSITIONS config or verify current state is not DONE',
    exitCode: 1,
  },
  E002: {
    message: 'Manual state requires --force flag',
    category: 'state',
    hint: 'Add --force or -f flag to confirm manual transition',
    exitCode: 1,
  },
  E003: {
    message: 'Invalid target state for rollback',
    category: 'state',
    hint: 'Target state must be earlier in the workflow',
    exitCode: 1,
  },
  E004: {
    message: 'Cannot rollback forward',
    category: 'state',
    hint: 'Target state must be before current state',
    exitCode: 1,
  },
  E005: {
    message: 'Prerequisites not met',
    category: 'state',
    hint: 'Run "check" command to see missing files',
    exitCode: 1,
  },
  E006: {
    message: 'Unknown state name',
    category: 'state',
    hint: 'Use valid state name from STATES config',
    exitCode: 1,
  },
  E007: {
    message: 'Invalid state transition',
    category: 'state',
    hint: 'Check TRANSITIONS config for valid next states',
    exitCode: 1,
  },
  E008: {
    message: 'QA failure escalation triggered',
    category: 'state',
    hint: 'Multiple QA failures detected, rolling back to ARCH_REVIEW',
    exitCode: 0, // Not an error, just informational
  },
  E009: {
    message: 'Feature mode prerequisites not met',
    category: 'state',
    hint: 'Feature mode requires existing arch-decision.md',
    exitCode: 1,
  },

  // ── Hook Errors (E100-E199) ─────────────────────────────────────────────
  E100: {
    message: 'Write blocked: state file protected',
    category: 'hook',
    hint: 'Use workflow.js commands to modify state files',
    exitCode: 2,
  },
  E101: {
    message: 'Write blocked: restricted path',
    category: 'hook',
    hint: 'Check AGENT_WRITE_RESTRICTIONS for allowed paths',
    exitCode: 2,
  },
  E102: {
    message: 'Bash blocked: dangerous pattern detected',
    category: 'hook',
    hint: 'Avoid destructive commands or use workflow.js alternatives',
    exitCode: 2,
  },
  E103: {
    message: 'Operation timeout exceeded',
    category: 'hook',
    hint: 'Increase timeout or optimize the operation',
    exitCode: 2,
  },
  E104: {
    message: 'Hook initialization failed',
    category: 'hook',
    hint: 'Check hook input format and stdin availability',
    exitCode: 2,
  },
  E105: {
    message: 'Cross-state artifact modification warning',
    category: 'hook',
    hint: 'Verify artifact modification is intentional',
    exitCode: 0, // Warning only
  },

  // ── Validation Errors (E200-E299) ─────────────────────────────────────────
  E201: {
    message: 'Document validation failed',
    category: 'validation',
    hint: 'Run validate-doc command for detailed errors',
    exitCode: 1,
  },
  E202: {
    message: 'Missing required document sections',
    category: 'validation',
    hint: 'Check document template for required sections',
    exitCode: 1,
  },
  E203: {
    message: 'Build verification failed',
    category: 'validation',
    hint: 'Fix build errors before proceeding',
    exitCode: 1,
  },
  E204: {
    message: 'Lint check failed',
    category: 'validation',
    hint: 'Run lint with --fix or resolve errors manually',
    exitCode: 1,
  },
  E205: {
    message: 'Type check failed',
    category: 'validation',
    hint: 'Resolve TypeScript errors before proceeding',
    exitCode: 1,
  },
  E206: {
    message: 'Integration check failed',
    category: 'validation',
    hint: 'Review integration check output for details',
    exitCode: 1,
  },
  E207: {
    message: 'Code output verification failed',
    category: 'validation',
    hint: 'Check required files and minimum file count',
    exitCode: 1,
  },
  E208: {
    message: 'Unknown document type',
    category: 'validation',
    hint: 'Use valid document key from DOC_VALIDATORS',
    exitCode: 1,
  },

  // ── IO Errors (E300-E399) ─────────────────────────────────────────────────
  E301: {
    message: 'Lock acquisition failed',
    category: 'io',
    hint: 'Check for zombie locks or concurrent processes',
    exitCode: 1,
  },
  E302: {
    message: 'State file corrupted',
    category: 'io',
    hint: 'Restore from backup or run reset command',
    exitCode: 1,
  },
  E303: {
    message: 'File not found',
    category: 'io',
    hint: 'Verify path exists and check working directory',
    exitCode: 1,
  },
  E304: {
    message: 'Permission denied',
    category: 'io',
    hint: 'Check file permissions and ownership',
    exitCode: 1,
  },
  E305: {
    message: 'Directory creation failed',
    category: 'io',
    hint: 'Check parent directory permissions',
    exitCode: 1,
  },
  E306: {
    message: 'JSON parse error',
    category: 'io',
    hint: 'Verify JSON file syntax and encoding',
    exitCode: 1,
  },
  E307: {
    message: 'Git operation failed',
    category: 'io',
    hint: 'Check git repository state and permissions',
    exitCode: 1,
  },

  // ── Agent Errors (E400-E499) ─────────────────────────────────────────────
  E401: {
    message: 'Agent execution failed',
    category: 'agent',
    hint: 'Check agent-log.jsonl for detailed error',
    exitCode: 1,
  },
  E402: {
    message: 'Agent timeout exceeded',
    category: 'agent',
    hint: 'Increase WORKFLOW_TIMEOUT_AGENT or optimize agent task',
    exitCode: 1,
  },
  E403: {
    message: 'Circuit breaker open',
    category: 'agent',
    hint: 'Wait for recovery period before retrying',
    exitCode: 1,
  },
  E404: {
    message: 'Agent not found',
    category: 'agent',
    hint: 'Check agent name and verify installation',
    exitCode: 1,
  },
  E405: {
    message: 'Agent result write failed',
    category: 'agent',
    hint: 'Check state directory permissions',
    exitCode: 1,
  },
  E406: {
    message: 'Agent Teams not available',
    category: 'agent',
    hint: 'Enable CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 for native mode',
    exitCode: 0, // Fallback to file polling
  },
  E407: {
    message: 'Retry exhausted',
    category: 'agent',
    hint: 'Operation failed after maximum retries',
    exitCode: 1,
  },
}

// ─── Error Classes ────────────────────────────────────────────────────────────

/**
 * Base error class for all workflow errors
 */
class WorkflowError extends Error {
  constructor(code, context = {}) {
    const def = ERROR_CODES[code] || { message: 'Unknown error', category: 'unknown', hint: '', exitCode: 1 }
    super(def.message)
    this.name = 'WorkflowError'
    this.code = code
    this.category = def.category
    this.context = context
    this.timestamp = new Date().toISOString()
    this.hint = def.hint
    this.exitCode = def.exitCode
  }

  /**
   * Serialize error for logging and debugging
   */
  toJSON() {
    return {
      code: this.code,
      name: this.name,
      message: this.message,
      category: this.category,
      context: this.context,
      hint: this.hint,
      exitCode: this.exitCode,
      timestamp: this.timestamp,
      stack: this.stack,
    }
  }

  /**
   * Format error for CLI output
   */
  toCLI() {
    const lines = [
      `\n❌ [${this.code}] ${this.message}`,
    ]
    if (Object.keys(this.context).length > 0) {
      lines.push(`   Context: ${JSON.stringify(this.context)}`)
    }
    if (this.hint) {
      lines.push(`   Hint: ${this.hint}`)
    }
    return lines.join('\n')
  }
}

/**
 * State machine errors (E001-E099)
 */
class StateError extends WorkflowError {
  constructor(code, context = {}) {
    super(code, context)
    this.name = 'StateError'
  }
}

/**
 * Hook errors (E100-E199)
 */
class HookError extends WorkflowError {
  constructor(code, context = {}) {
    super(code, context)
    this.name = 'HookError'
  }
}

/**
 * Validation errors (E200-E299)
 */
class ValidationError extends WorkflowError {
  constructor(code, context = {}) {
    super(code, context)
    this.name = 'ValidationError'
  }
}

/**
 * IO errors (E300-E399)
 */
class IOError extends WorkflowError {
  constructor(code, context = {}) {
    super(code, context)
    this.name = 'IOError'
  }
}

/**
 * Agent errors (E400-E499)
 */
class AgentError extends WorkflowError {
  constructor(code, context = {}) {
    super(code, context)
    this.name = 'AgentError'
  }
}

// ─── Helper Functions ─────────────────────────────────────────────────────────

/**
 * Check if an error is a WorkflowError
 */
function isWorkflowError(err) {
  return err instanceof WorkflowError
}

/**
 * Get error definition by code
 */
function getErrorDef(code) {
  return ERROR_CODES[code] || null
}

/**
 * Create appropriate error class based on code
 */
function createError(code, context = {}) {
  const def = ERROR_CODES[code]
  if (!def) {
    return new WorkflowError(code, context)
  }

  const codeNum = parseInt(code.slice(1), 10)
  if (codeNum >= 1 && codeNum <= 99) {
    return new StateError(code, context)
  } else if (codeNum >= 100 && codeNum <= 199) {
    return new HookError(code, context)
  } else if (codeNum >= 200 && codeNum <= 299) {
    return new ValidationError(code, context)
  } else if (codeNum >= 300 && codeNum <= 399) {
    return new IOError(code, context)
  } else if (codeNum >= 400 && codeNum <= 499) {
    return new AgentError(code, context)
  }

  return new WorkflowError(code, context)
}

/**
 * Format any error for CLI output
 */
function formatError(err) {
  if (isWorkflowError(err)) {
    return err.toCLI()
  }
  return `\n❌ ${err.message || String(err)}`
}

/**
 * Handle error with appropriate exit code
 */
function handleError(err, exit = true) {
  console.error(formatError(err))

  if (isWorkflowError(err) && err.stack) {
    console.error(`\n   Stack trace:`)
    console.error(err.stack.split('\n').slice(1, 4).map(l => '     ' + l).join('\n'))
  }

  if (exit) {
    const exitCode = isWorkflowError(err) ? err.exitCode : 1
    process.exit(exitCode)
  }
}

/**
 * Wrap async function with error handling
 */
function withErrorHandling(fn) {
  return async (...args) => {
    try {
      return await fn(...args)
    } catch (err) {
      handleError(err)
    }
  }
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  // Error codes
  ERROR_CODES,
  getErrorDef,

  // Error classes
  WorkflowError,
  StateError,
  HookError,
  ValidationError,
  IOError,
  AgentError,

  // Helper functions
  isWorkflowError,
  createError,
  formatError,
  handleError,
  withErrorHandling,
}
