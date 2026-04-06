#!/usr/bin/env node
/**
 * check-syntax.js — CI 语法检查
 * 
 * 在 CI 中运行，确保所有 JS 文件语法正确。
 * 用法：node scripts/check-syntax.js
 */

'use strict'

const { execSync } = require('child_process')
const path = require('path')
const fs = require('fs')

const ROOT = path.join(__dirname, '..')
const LIB_DIR = path.join(ROOT, 'scripts', 'lib')

const files = [
  path.join(ROOT, 'scripts', 'workflow.js'),
  ...fs.readdirSync(LIB_DIR)
    .filter(f => f.endsWith('.js'))
    .map(f => path.join(LIB_DIR, f)),
]

let errors = 0

for (const file of files) {
  try {
    execSync(`node -c "${file}"`, { stdio: 'pipe' })
    console.log(`  ✅ ${path.relative(ROOT, file)}`)
  } catch (err) {
    errors++
    console.error(`  ❌ ${path.relative(ROOT, file)}`)
    console.error(`     ${err.stderr?.toString().split('\n')[0] || err.message}`)
  }
}

console.log(`\n${errors === 0 ? '✅' : '❌'} Checked ${files.length} files, ${errors} error(s)\n`)
process.exit(errors > 0 ? 1 : 0)
