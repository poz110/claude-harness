# claude-harness — AI 贡献者指南

> **注意：本项目对 AI 生成的代码有严格的验收标准。请在提交前通读本文档。**

---

## 快速检查：你的修改会被立即拒绝如果...

- [ ] ❌ 添加了新的 npm 依赖（本项目追求零运行时依赖）
- [ ] ❌ 修改了 `state/workflow-state.json`（必须通过 `workflow.js` 命令修改）
- [ ] ❌ 跳过了测试（新功能必须有测试覆盖）
- [ ] ❌ 在没有读 `CLAUDE.md` 的情况下修改了状态机逻辑
- [ ] ❌ 创建了新的 Agent 文件但没有更新 `scripts/lib/config.js` 中的权限白名单
- [ ] ❌ 修改了 `scripts/lib/config.js` 但没有运行 `node scripts/workflow.js install-global --force`
- [ ] ❌ 绕过了 hookPreWrite 鉴权

---

## 贡献流程

### 1. 理解项目架构

按此顺序阅读：

```
1. CLAUDE.md                          — 项目架构和快速命令
2. state/workflow-state.json          — 当前流水线状态
3. .claude/agents/orchestrator.md     — 状态机规则（最重要）
4. scripts/lib/config.js              — 所有常量、权限、状态定义
5. .claude/agents/_shared.md          — 所有 Agent 共享的 Iron Laws
```

### 2. 修改规则

| 修改类型 | 必须操作 |
|---------|---------|
| 新增 Agent | 更新 `scripts/lib/config.js` 权限白名单 |
| 修改状态机 | 更新 `CLAUDE.md` 状态图 |
| 修改 Hook | 运行 `install-global --force` |
| 添加 Skill | 在对应目录创建 `SKILL.md` |

### 3. 提交前检查

```bash
# 运行测试
npm test

# 运行 lint
npm run lint

# 验证配置
node scripts/workflow.js check
```

---

## Agent Tier 定义

| Tier | 预算 | 适用场景 |
|------|------|---------|
| `TIER_FAST` | ~5K tokens | 简单任务路由、状态检查 |
| `TIER_STANDARD` | ~20K tokens | 标准实现任务 |
| `TIER_HEAVY` | ~50K tokens | 复杂架构设计、大规模 PRD |
| `TIER_AUDIT` | ~30K tokens | 安全审计、代码审查 |

---

## 写入权限白名单

每个 Agent 只能写入其职责范围内的路径。权限定义在 `scripts/lib/config.js` → `AGENT_WRITE_PERMISSIONS`。

如需添加新路径，提交时必须说明理由。

---

## Context 预算规则

- 每个状态转换后，Context Budget 重置
- Hook 自动追踪实际 token 消耗
- 超出预算时，Workflow 暂停并等待用户确认

---

## Iron Laws（不可违反）

1. **IL-01** 前置文档不存在 → 禁止推进到下一阶段
2. **IL-02** API spec 不存在 → 禁止写任何路由/组件
3. **IL-03** hookPreWrite 未授权 → 禁止写文件
4. **IL-04** Reviewer 不修改代码，只报告问题
5. **IL-05** 测试必须用真浏览器（Playwright），mock 不计入覆盖率
6. **IL-06** 每个 Agent 完成时必须执行 write-agent-result
7. **IL-07** MANUAL 节点无 --force 或 autopilot=true → 等待用户确认
8. **IL-08** 生产环境禁止 drizzle-kit push
9. **IL-09** PRD Must 功能缺失 = FAIL（不可降级为 WARN）
10. **IL-10** 新技能上线前必须有 failure-evidence.md
