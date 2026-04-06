---
name: traceability-matrix
description: >
  Generates and maintains the requirement traceability matrix (docs/traceability-matrix.md).
  Maps every PRD Must/Should feature (F###) to its expected implementation location,
  Gherkin scenarios, test IDs, and completion status. Required output of PRD_REVIEW
  phase. Consumed by FE, BE, Reviewer, and QA. Invoke when: Architect completes ADR,
  FE/BE update implementation status, Reviewer verifies coverage, QA links test IDs.
---

# Traceability Matrix Skill

## 目的

需求追溯矩阵解决多 Agent 流水线中的**上下文衰减**问题：
PRD 的细节经过 PM → Architect → Designer → FE/BE 多轮传递后，每次都经过摘要和解读，
边缘情况、隐式约束、业务规则大量丢失。

追溯矩阵是一份**在整个流水线中持续更新的活文档**，把原始 PRD 需求与实现、测试绑定在一起，
让每个 Agent 都能用同一份索引对齐工作范围。

---

## 何时生成

Architect 在 PRD_REVIEW 阶段完成 ADR 和安全基线后，**立即生成**追溯矩阵。
这是 IMPLEMENTATION 阶段的强制前置文件：

```bash
node scripts/workflow.js validate-doc traceability  # 必须通过才能进入 IMPLEMENTATION
```

---

## 生成步骤（Architect 执行）

### Step 1：扫描 PRD 功能需求

读取 `docs/prd.md` Section 3（功能需求 MoSCoW 表），提取所有 **Must** 和 **Should** 条目：

```bash
# 在 PRD 中定位功能需求表
grep -n "| F[0-9]\|Must\|Should" docs/prd.md | head -40
```

### Step 2：读取 Gherkin 场景

读取 `docs/prd.md` Section 4（用户故事与验收标准），为每个功能 ID 找到对应的 Scenario 列表。

**规则**：
- 每个 Must 功能至少要有：正向主路径 + 边界/异常场景 + 权限场景（共 ≥3 个）
- 发现某功能缺少场景类型 → 在矩阵的"备注"列标注 `⚠️ 缺少{类型}场景`，并通知 Orchestrator 要求 PM 补充

### Step 3：预估实现位置

基于 ADR 中的技术栈和项目结构，为每个功能预估 FE 和 BE 的实现路径：

```
FE 路径规律（Next.js 15 App Router）：
  认证类功能  → app/(auth)/{feature}/
  仪表盘类   → app/(dashboard)/{feature}/
  公开页面   → app/{feature}/
  复用组件   → components/{feature}/

BE 路径规律（Hono/tRPC）：
  REST 路由  → apps/server/src/routes/v1/{resource}.ts
  tRPC 路由  → apps/server/src/trpc/routers/{resource}.ts
  服务层     → apps/server/src/services/{resource}.ts
```

### Step 4：输出矩阵文档

```markdown
# 需求追溯矩阵
生成时间：{ISO date} | 基于：PRD v{X.X} + ADR {ADR-编号}
状态图例：⬜ 待实现 | 🔧 实现中 | ✅ 已实现(Reviewer验证) | 🧪 已测试(QA验证) | ❌ 未通过

---

## Must 功能（必须全部实现）

| 功能 ID | 功能名称 | Gherkin Scenario（简称） | 预期 FE 实现路径 | 预期 BE 实现路径 | 测试 ID | 状态 | 备注 |
|--------|---------|------------------------|----------------|----------------|--------|------|------|
| F001   | 用户注册  | 正向:有效邮箱注册成功 / 异常:重复邮箱报错 / 权限:未登录可访问 | `app/(auth)/register/` | `routes/v1/auth.ts#POST/register` | T-F001-1,2,3 | ⬜ | |
| F002   | 用户登录  | 正向:有效凭证登录 / 异常:错误密码报错 / 权限:已登录跳转首页 | `app/(auth)/login/` | `routes/v1/auth.ts#POST/login` | T-F002-1,2,3 | ⬜ | |
| F003   | 创建订单  | 正向:提交购物车 / 异常:库存不足 / 权限:未登录跳转登录 | `app/checkout/` | `routes/v1/orders.ts#POST` | T-F003-1,2,3 | ⬜ | |

---

## Should 功能（尽力实现）

| 功能 ID | 功能名称 | Gherkin Scenario（简称） | 预期 FE 实现路径 | 预期 BE 实现路径 | 测试 ID | 状态 | 备注 |
|--------|---------|------------------------|----------------|----------------|--------|------|------|
| F004   | 订单历史  | 正向:查看历史列表 / 分页:超过20条分页 | `app/orders/` | `routes/v1/orders.ts#GET` | T-F004-1,2 | ⬜ | |

---

## Must 功能覆盖统计

- Must 总数：{N} 个
- Gherkin 场景完整（≥3类）：{N}/{N}
- 预期实现路径已填写：{N}/{N}
- 当前完成状态：⬜ {N} | 🔧 {N} | ✅ {N} | 🧪 {N} | ❌ {N}
- 整体覆盖率：{N}/{N} ({%})

---

## 变更日志

| 版本 | 日期 | 变更内容 | 变更方 |
|------|------|---------|------|
| 1.0 | {date} | 初始生成 | Architect |
```

---

## 各阶段的维护责任

### FE Agent（DESIGN_REVIEW 阶段）
- 开工前：将负责的 FE 条目从 ⬜ 改为 🔧
- 完工后：将已实现的 FE 条目从 🔧 改为 ✅，并填写实际实现路径（如与预估不同）
- 如遇某功能无法按预估路径实现，在"备注"列说明原因

### BE Agent（DESIGN_REVIEW 阶段）
- 与 FE 相同，维护 BE 列的状态

### Reviewer（IMPLEMENTATION → CODE_REVIEW）
- 检查所有 Must 条目是否为 ✅（F-016 门控）
- 如有 ⬜ 或 🔧 遗留 → FAIL，回滚至 IMPLEMENTATION

### QA（CODE_REVIEW → QA_PHASE）
- 为每个条目填写实际测试 ID（格式：T-F###-N）
- 测试通过后将 ✅ 更新为 🧪
- 发现缺少对应测试用例的 Must 条目 → P1 bug，触发 qa-failure

---

## 质量检查命令

```bash
# 验证矩阵文档格式（由 Orchestrator / hooks 自动调用）
node scripts/workflow.js validate-doc traceability

# 手动检查覆盖率
grep -c "| Must |" docs/traceability-matrix.md
grep -c "✅\|🧪" docs/traceability-matrix.md
grep -c "⬜\|🔧" docs/traceability-matrix.md
```

---

## 常见问题

**Q：PRD 没有 F### 格式的功能 ID 怎么办？**
A：PM 的 PRD 规范要求功能 ID 格式为 F###（见 pm.md 行为规范）。
如果 PRD 缺少 ID，Architect 在生成矩阵时自行分配，并在矩阵变更日志中注明
"功能 ID 由 Architect 分配，PM PRD 需更新"，同时通知 Orchestrator 让 PM 更新。

**Q：Could 和 Won't 功能要进矩阵吗？**
A：不需要。矩阵只追踪 Must 和 Should。Could 功能在 PRD Out of Scope 章节管理。

**Q：FE/BE 实现路径与预估不同时怎么办？**
A：直接更新矩阵中的实际路径，在备注列写明变更原因（如"功能合并到父路由"）。
矩阵是活文档，随实现更新，不是一次性锁定的。

---

## 接力

追溯矩阵生成后：
- **PRD 阶段** → 通知 Orchestrator 推进 `PRD_REVIEW` → `ARCH_REVIEW`
- **CODE_REVIEW 阶段** → `code-review-arch` Phase 1 会消费矩阵做 Must 功能覆盖检查
