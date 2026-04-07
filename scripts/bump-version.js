const fs = require('fs')
const path = require('path')
const args = process.argv.slice(2)
if (!args[0]) { console.error('Usage: node scripts/bump-version.js <version>'); process.exit(1) }
const v = args[0]
if (!/^\d+\.\d+\.\d+$/.test(v)) { console.error('Must be x.y.z'); process.exit(1) }
const ROOT = path.join(__dirname, '..')
const files = ['package.json', 'plugins/claude-harness/plugin.json']
let ok = [], skip = []
for (const f of files) {
  const p = path.join(ROOT, f)
  if (!fs.existsSync(p)) { skip.push(f + ' (not found)'); continue }
  const j = JSON.parse(fs.readFileSync(p, 'utf8'))
  if (j.version === undefined) { skip.push(f + ' (no version field)'); continue }
  const old = j.version
  j.version = v
  fs.writeFileSync(p, JSON.stringify(j, null, 2) + '\n')
  ok.push(f + ': ' + old + ' -> ' + v)
}
console.log('\nUpdated:')
ok.forEach(x => console.log('  + ' + x))
if (skip.length) { skip.forEach(x => console.log('  - ' + x)) }
console.log('\nNext: git add . && git commit -m "chore: bump to ' + v + '" && git push')
