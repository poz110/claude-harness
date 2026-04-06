#!/usr/bin/env node
/**
 * monitor-server.js — 工作流可視化監控服務
 *
 * 功能：
 *   - HTTP 服務提供監控面板
 *   - WebSocket 實時推送狀態變化
 *   - 文件監聽自動同步
 *
 * 用法：
 *   node scripts/monitor-server.js [port]
 */

'use strict'

const http = require('http')
const fs = require('fs')
const path = require('path')
const WebSocket = require('ws')

// 配置
const PORT = process.argv[2] || 3456
const ROOT = path.join(__dirname, '..')
const STATE_FILE = path.join(ROOT, 'state/workflow-state.json')
const UI_DIR = path.join(ROOT, 'state/monitor-ui')

// 從 config.js 加載配置
const CONFIG_PATH = path.join(ROOT, 'scripts/lib/config.js')
let STATES, TRANSITIONS, ARTIFACT_DOCS

try {
  const config = require(CONFIG_PATH)
  STATES = config.STATES
  TRANSITIONS = config.TRANSITIONS
  ARTIFACT_DOCS = config.ARTIFACT_DOCS || {}
} catch (e) {
  console.error('❌ 無法加載 config.js:', e.message)
  process.exit(1)
}

// 讀取狀態
function readState() {
  try {
    const content = fs.readFileSync(STATE_FILE, 'utf-8')
    return JSON.parse(content)
  } catch (e) {
    return null
  }
}

// 計算狀態耗時
function calculateDurations(state) {
  const durations = {}
  if (!state || !state.history) return durations

  // 從 createdAt 開始計算
  let lastTime = state.createdAt ? new Date(state.createdAt).getTime() : Date.now()

  for (const entry of state.history) {
    const currentTime = new Date(entry.timestamp).getTime()
    if (entry.from !== entry.to && entry.from) {
      durations[entry.from] = currentTime - lastTime
    }
    lastTime = currentTime
  }

  // 當前狀態的持續時間（到現在）
  const now = Date.now()
  durations[state.currentState] = now - lastTime

  return durations
}

// 計算總耗時
function calculateTotalDuration(state) {
  if (!state) return 0
  const created = state.createdAt ? new Date(state.createdAt).getTime() : Date.now()
  return Date.now() - created
}

// 獲取存在的文檔列表
function getExistingDocs() {
  const docs = []
  const docsDir = path.join(ROOT, 'docs')

  if (fs.existsSync(docsDir)) {
    const files = fs.readdirSync(docsDir)
    files.forEach(f => {
      if (f.endsWith('.md')) {
        const filePath = path.join(docsDir, f)
        const stat = fs.statSync(filePath)
        docs.push({
          name: f,
          path: `docs/${f}`,
          size: stat.size,
          modified: stat.mtime
        })
      }
    })
  }

  // 檢查 DESIGN.md
  const designMd = path.join(ROOT, 'DESIGN.md')
  if (fs.existsSync(designMd)) {
    const stat = fs.statSync(designMd)
    docs.push({
      name: 'DESIGN.md',
      path: 'DESIGN.md',
      size: stat.size,
      modified: stat.mtime
    })
  }

  return docs.sort((a, b) => a.name.localeCompare(b.name))
}

// 讀取文檔內容
function readDocContent(docPath) {
  const fullPath = path.join(ROOT, docPath)
  try {
    return fs.readFileSync(fullPath, 'utf-8')
  } catch (e) {
    return null
  }
}

// 提供靜態文件
function serveFile(res, filePath, contentType) {
  try {
    const content = fs.readFileSync(filePath)
    res.setHeader('Content-Type', contentType)
    res.end(content)
  } catch (e) {
    res.statusCode = 404
    res.end('File not found')
  }
}

// HTTP 請求處理
function handleRequest(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`)

  // CORS 支持
  res.setHeader('Access-Control-Allow-Origin', '*')

  if (url.pathname === '/' || url.pathname === '/index.html') {
    serveFile(res, path.join(UI_DIR, 'index.html'), 'text/html; charset=utf-8')
  } else if (url.pathname === '/api/state') {
    const state = readState()
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({
      state,
      durations: calculateDurations(state),
      totalDuration: calculateTotalDuration(state),
      config: { STATES, TRANSITIONS, ARTIFACT_DOCS }
    }))
  } else if (url.pathname === '/api/docs') {
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(getExistingDocs()))
  } else if (url.pathname.startsWith('/api/doc/')) {
    const docPath = decodeURIComponent(url.pathname.replace('/api/doc/', ''))
    const content = readDocContent(docPath)
    if (content) {
      res.setHeader('Content-Type', 'text/plain; charset=utf-8')
      res.end(content)
    } else {
      res.statusCode = 404
      res.end('Document not found')
    }
  } else {
    res.statusCode = 404
    res.end('Not Found')
  }
}

// WebSocket 廣播
function broadcast(wss, data) {
  const message = JSON.stringify(data)
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message)
    }
  })
}

// 主函數
function main() {
  // 檢查狀態文件
  if (!fs.existsSync(STATE_FILE)) {
    console.error('❌ 找不到 state/workflow-state.json')
    console.error('   請先運行：node scripts/workflow.js init-project')
    process.exit(1)
  }

  // 檢查 UI 文件
  if (!fs.existsSync(path.join(UI_DIR, 'index.html'))) {
    console.error('❌ 找不到 state/monitor-ui/index.html')
    process.exit(1)
  }

  // 創建 HTTP 服務
  const server = http.createServer(handleRequest)

  // 創建 WebSocket 服務
  const wss = new WebSocket.Server({ server })

  // WebSocket 連接處理
  wss.on('connection', (ws) => {
    // 發送當前狀態
    const state = readState()
    if (state) {
      ws.send(JSON.stringify({
        type: 'initial-state',
        state,
        durations: calculateDurations(state),
        totalDuration: calculateTotalDuration(state)
      }))
    }
  })

  // 文件監聯
  let lastMtime = null
  fs.watchFile(STATE_FILE, { interval: 500 }, (curr, prev) => {
    if (curr.mtime > prev.mtime) {
      const state = readState()
      if (state) {
        broadcast(wss, {
          type: 'state-update',
          state,
          durations: calculateDurations(state),
          totalDuration: calculateTotalDuration(state)
        })
      }
    }
  })

  // 啟動服務
  server.listen(PORT, () => {
    console.log('\n📊 Workflow Monitor 已啟動')
    console.log(`   URL: http://localhost:${PORT}`)
    console.log('   按 Ctrl+C 停止\n')
  })

  // 優雅關閉
  process.on('SIGINT', () => {
    console.log('\n⏹  監控服務已停止')
    fs.unwatchFile(STATE_FILE)
    server.close()
    wss.close()
    process.exit(0)
  })
}

main()
