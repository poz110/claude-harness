---
name: monitor
description: "啟動工作流可視化監控面板，實時顯示狀態、耗時、產物文檔。HTTP + WebSocket 服務，支持多客戶端同時連接。"
---

# Monitor — 工作流可視化監控

## 用法

```bash
/monitor              # 啟動監控服務（默認端口 3456）
/monitor 8080         # 指定端口
```

## 功能

- **實時狀態顯示**：14 個狀態的進度條，當前狀態高亮
- **耗時統計**：每個階段的耗時、總耗時、當前階段耗時
- **Agent 信息**：顯示每個狀態對應的 Agent 和操作類型
- **產物文檔**：點擊狀態節點查看對應的產物文檔
- **WebSocket 實時同步**：狀態變化時自動推送更新
- **手動/自動節點標識**：👤 手動確認 vs 🤖 自動推進

## 啟動流程

```
1. 檢查 state/workflow-state.json 是否存在
2. 啟動 HTTP 服務（默認端口 3456）
3. 啟動 WebSocket 服務
4. 監聽 state/workflow-state.json 文件變化
5. 輸出訪問 URL
```

## 前端界面

- 深色主題（Tailwind CSS）
- 響應式布局
- 狀態節點可點擊查看詳情

## 停止服務

按 `Ctrl+C` 停止服務。

## 示例輸出

```
📊 Workflow Monitor 已啟動
   URL: http://localhost:3456
   按 Ctrl+C 停止
```
