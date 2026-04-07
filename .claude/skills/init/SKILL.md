---
name: init
description: "初始化 claude-harness：安装 agents 和 skills 到 ~/.claude/，安装后即可使用 /autopilot、/generate-prd 等指令。"
---

# claude-harness init

初始化 claude-harness 工作流系统。安装后，所有 slash commands 即刻可用。

## 用法

```
/claude-harness:init
/init
```

## 触发条件

用户说：
- "/claude-harness:init"
- "/init"
- "初始化 claude-harness"
- "安装 claude-harness"
- "setup claude-harness"
- "安装工作流"
- "初始化工作流"
- "开始使用 claude-harness"

---

## 执行流程

### Step 1: 执行全局安装

```bash
# Claude Code 执行时 CWD = skills/<name>/，workflow.js 在 plugins/<name>/scripts/
# market安装: plugins/<name>/skills/<name>/ → plugins/<name>/scripts/ = ../../scripts/
# 本地开发:   .claude/skills/<name>/ → .claude/scripts/ = ../../scripts/
node ../../scripts/workflow.js init
```

这会将以下文件复制到 `~/.claude/`：

| 类型 | 数量 | 目标位置 |
|------|------|---------|
| Agents | 13 | `~/.claude/agents/` |
| Skills | 19 | `~/.claude/skills/` |
| Settings | 1 | `~/.claude/settings.json` |

### Step 2: 验证安装

```bash
node ../../scripts/workflow.js check-global
```

### Step 3: 确认成功

```
✅ claude-harness 安装完成！

可用指令：
  /autopilot              — 全流程自动驾驶
  /generate-prd           — 生成 PRD
  /generate-design        — 生成设计稿
  /implement-feature      — 实现功能
  /arch-review            — 架构审查
  /code-review-arch       — 代码审查
  /qa                     — QA 测试
  /owasp-scan             — 安全扫描
  /setup-cicd             — CI/CD 配置
  /monitor                — 监控面板

下一步：
  /autopilot <需求描述>   — 开始自动流程
  /status                 — 查看当前状态
```

---

## 错误处理

| 错误 | 解决方案 |
|------|---------|
| `~/.claude/` 无写入权限 | 检查文件系统权限 |
| 已有旧版本 | 运行 `node ../../scripts/workflow.js install-global --force` 强制更新 |
| 安装失败 | 检查 Node.js 版本（需 >= 18.0.0） |

---

## 禁止行为

- 不在安装失败时继续推进流程
- 不跳过 check-global 验证步骤
- 不在未安装状态下使用其他指令（应先引导用户运行 init）
