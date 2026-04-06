---
name: code-review-arch
description: >
  Architecture compliance code review. Used by Reviewer agent after IMPLEMENTATION.
  Two-stage sequential review: spec compliance first, then code quality.
  Each stage must pass independently. Produces PASS/FAIL verdict.
---

# Code Review (Architecture Compliance) — 两阶段审查

## ⚡ Iron Law

**两个阶段顺序执行，不可合并，不可跳过。**
第一阶段（规范合规）通过后才能开始第二阶段（代码质量）。
开场假设：**"这个实现完成得过于顺利了，某处一定藏着问题。"**

---

## Phase 1：规范合规审查（Spec Compliance）

**核心问题**：实现是否精确地做了 PRD 和 API spec 要求的事——不多也不少？

开场假设（对抗性）：
> "实现者完成得太快了。他们可能跳过了某些 PRD Must 功能，或者用了更简单的替代方案来规避困难需求。"

### 1a. PRD Must 功能覆盖

```bash
# 检查追溯矩阵 Must 条目完成情况
if [ -f "docs/traceability-matrix.md" ]; then
  UNFINISHED=$(grep -c "⬜\|🔧" docs/traceability-matrix.md 2>/dev/null || echo 0)
  MUST_COUNT=$(grep -c "| Must |" docs/traceability-matrix.md 2>/dev/null || echo 0)
  echo "Must 条目：${MUST_COUNT} 个 | 未完成：${UNFINISHED} 个"
  [ "$UNFINISHED" -gt 0 ] && echo "❌ SPEC-001: ${UNFINISHED} 个 Must 条目未完成"
fi
```

### 1b. API 规范合规

```bash
# 检查 api-spec.md 中的端点是否全部有路由实现
node scripts/workflow.js integration-check
```

### 1c. Interaction-Spec 合规

```bash
# 检查关键交互状态是否实现
node scripts/workflow.js validate-doc interaction-spec
```

### 1d. ADR 技术选型合规

```bash
# 确认没有偏离架构决策（静默偏离 = FAIL，有说明 = PASS WITH NOTES）
grep -rn "from 'express'\|from 'fastify'\|from 'redux'" apps/ 2>/dev/null | grep -v "test\|spec"
```

**Phase 1 判定**：

| 编号 | 问题 | 判定 |
|------|------|------|
| SPEC-001 | PRD Must 功能代码缺失 | FAIL |
| SPEC-002 | API 端点覆盖率 < 80% | FAIL |
| SPEC-003 | ADR 技术选型静默偏离 | FAIL |
| SPEC-004 | Interaction-Spec 可交互元素状态机未实现 | FAIL |

**Phase 1 FAIL → 停止，不执行 Phase 2，直接报告。**

---

## Phase 2：代码质量审查（Code Quality）

**前提**：Phase 1 已通过（全绿）。

开场假设（对抗性）：
> "代码通过了规范检查，但实现质量可能很差——临时 hack、未处理的边缘案例、安全漏洞或性能地雷。"

### 2a. 构建与类型验证

```bash
node scripts/workflow.js check-code FE
node scripts/workflow.js check-code BE
node scripts/workflow.js verify-code FE
node scripts/workflow.js verify-code BE
```

### 2b. 代码质量扫描

```bash
# Biome Lint + Format
cd apps/web && npx biome check --reporter=github .
cd apps/server && npx biome check --reporter=github .
```

### 2c. 安全基线合规

```bash
# Token 存储检查
grep -rn "localStorage" apps/web/src --include="*.ts" --include="*.tsx" | grep -v "test\|spec"
# 原始 SQL 检查
grep -rn "sql\`\|rawQuery" apps/server/src | grep -v "drizzle"
# 敏感数据日志
grep -rn "console\.\|logger\." apps/server/src --include="*.ts" | grep -i "password\|token\|secret"
```

### 2d. 性能回归与依赖审计

```bash
cd apps/web && npm audit --audit-level=high 2>/dev/null | grep -c "vulnerabilities" || echo "clean"
```

**Phase 2 判定**：

| 编号 | 问题 | 判定 |
|------|------|------|
| QUAL-001 | 构建失败（FE 或 BE）| FAIL |
| QUAL-002 | Biome 有错误（非警告）| FAIL |
| QUAL-003 | TypeScript 类型错误 | FAIL |
| QUAL-004 | 生产代码中有 mock 数据 | FAIL |
| QUAL-005 | 违反安全基线约束 | FAIL |
| QUAL-006 | High/Critical 依赖漏洞 | FAIL |
| QUAL-007 | BE Smoke Test 失败 | FAIL |

---

## 输出格式

写入 `docs/code-review.md`，必须包含：
- **Phase 1 结论**：PASS / FAIL（含每项检查结果）
- **Phase 2 结论**：PASS / PASS WITH NOTES / FAIL（Phase 1 FAIL 则不填）
- **总体结论**：两阶段均 PASS 才算 PASS
- FAIL 问题列表（编号、位置、修复建议）

**总体结论为 FAIL 时，在报告末尾写明**：
```
> ❌ FAIL — Orchestrator 必须执行 rollback IMPLEMENTATION 并清理本文件
```

---

## 接力

- **PASS** → `prepare-tests`（QA 测试阶段）
- **FAIL** → 通知 Orchestrator 执行 `rollback IMPLEMENTATION`，加载 `systematic-debugging` 定位问题

### 1. 产出物存在性

```bash
node scripts/workflow.js check-code FE
node scripts/workflow.js check-code BE
```

### 2. 构建验证（实时输出）

```bash
node scripts/workflow.js verify-code FE
node scripts/workflow.js verify-code BE
```

### 3. 进程内联调检查

```bash
node scripts/workflow.js integration-check
```

### 4. 架构合规检查

对照 `docs/arch-decision.md` 技术约束：
- 技术栈是否与选型一致（版本号）
- 数据库 Schema 是否与 ADR 草图一致
- 接口路由是否与契约摘要一致

对照 `docs/security-baseline.md` 安全约束：
- Token 存储：禁止 localStorage（搜索代码）
- 密码处理：是否使用 Argon2id/bcrypt
- SQL 注入：是否有原始字符串拼接
- 日志：是否有敏感数据

```bash
# 快速安全检查
grep -rn "localStorage" apps/web/src --include="*.ts" --include="*.tsx" | grep -v "test\|spec"
grep -rn "md5\|Math.random()" apps/server/src
grep -rn "sql\`\|rawQuery" apps/server/src | grep -v "drizzle"
```

## FAIL 判定标准

| 编号 | 问题 | 判定 |
|------|------|------|
| FAIL-001 | 构建失败（FE 或 BE）| FAIL |
| FAIL-002 | Biome 有错误（非警告）| FAIL |
| FAIL-003 | TypeScript 类型错误 | FAIL |
| FAIL-004 | 前端使用 mock 数据 | FAIL |
| FAIL-005 | API 客户端未配置 | FAIL |
| FAIL-006 | 后端无路由定义 | FAIL |
| FAIL-007 | 接口契约与实现不一致（>20% 缺失）| FAIL |
| FAIL-008 | 违反安全基线约束 | FAIL |
| FAIL-009 | PRD Must 级功能代码缺失 | FAIL |

## 输出格式

写入 `docs/code-review.md`，必须包含：
- 总体结论：PASS / PASS WITH NOTES / FAIL
- 每个验证步骤的执行结果表格
- FAIL 问题列表（编号、位置、修复建议）
- 建议改进（不阻塞）
- 架构亮点

**结论为 FAIL 时，在报告末尾写明**：
```
> ❌ FAIL — Orchestrator 必须执行 rollback IMPLEMENTATION 并清理本文件
```
