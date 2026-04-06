---
name: systematic-debugging
description: >
  Structured debugging methodology for implementation failures.
  Use when a build fails, tests fail, or behavior is unexpected.
  Replaces ad-hoc guessing with hypothesis-driven root cause analysis.
---

# Systematic Debugging — 系统化调试

## ⚡ Iron Law

**在没有证明根因的情况下，禁止提交任何修复。**

猜测性修改是最危险的调试方式：它可能掩盖根因、引入新 Bug，并且让下一次失败更难诊断。

---

## 禁止行为

在调试过程中，以下行为绝对禁止：

- ❌ 随机修改代码直到错误消失（"try and see"）
- ❌ 在未定位根因时删除报错行
- ❌ 注释掉失败的测试
- ❌ 用 `any` 类型规避 TypeScript 报错
- ❌ 在未理解意图的情况下修改他人代码
- ❌ 声称"修好了"但不能解释为什么之前会出错

---

## 调试协议（5步，顺序执行）

### Step 1：精确重现（Reproduce First）

```bash
# 记录完整错误输出（不要截断）
<失败命令> 2>&1 | tee /tmp/debug-$(date +%s).log

# 确认可以稳定重现（非偶发）
# 运行 3 次，如果错误不稳定，记录重现率
```

**输出**：完整错误信息（包括 stack trace、行号、文件路径）

---

### Step 2：最小化复现（Minimize）

将问题缩小到最小可复现单元：

```bash
# 如果是构建失败：找到第一个报错，忽略级联错误
# 如果是运行时错误：注释掉其他代码，只保留出错的最小路径
# 如果是测试失败：单独运行失败的测试
npx vitest run tests/specific.test.ts
npx playwright test tests/specific.spec.ts
```

**目标**：能用 ≤10 行代码稳定触发同样的错误

---

### Step 3：形成假设（Hypothesize）

在修改任何代码之前，写下你的假设：

```
假设：[具体的根因猜测，要有依据]
依据：[是什么让你认为这是根因？错误信息的哪一行？]
验证方法：[如何证明这个假设是正确的？]
预期：[如果假设正确，修复后会看到什么？]
```

**不允许**：同时有多个假设，先验证第一个。

---

### Step 4：验证假设（Verify）

用最小改动验证假设，不要同时修改多个地方：

```bash
# 验证手段（按可逆性排序，优先用可逆手段）：
# 1. 添加 console.log/调试输出（最可逆）
# 2. 注释掉可疑代码（可逆）
# 3. 替换为已知可工作的简单实现（可逆）
# 4. 修改配置（可逆）
# 5. 修改代码（较不可逆，最后尝试）

# 验证后立即还原临时调试代码
```

如果假设被证伪：**回到 Step 3**，形成新假设。不要在错误假设上继续叠加修改。

---

### Step 5：修复并证明（Fix & Prove）

```bash
# 1. 实施针对根因的最小修复
# 2. 重新运行失败的测试/构建，确认通过
# 3. 运行完整测试套件，确认没有引入新问题
# 4. 写下根因说明（用于 git commit message 或报告）

echo "根因：[具体描述]"
echo "修复：[具体描述，一句话]"
echo "验证：[运行了什么命令，输出是什么]"
```

---

## 常见根因分类（快速诊断）

| 症状 | 可能根因 | 验证方式 |
|------|---------|---------|
| TypeScript 类型错误 | 类型定义与实现不一致 | `tsc --noEmit` 看完整错误 |
| 构建通过但运行崩溃 | 运行时 env 变量缺失 | 检查 `.env` 配置 |
| 测试通过但 E2E 失败 | mock 与真实 API 行为不一致 | 对比 API 实际响应 |
| 间歇性失败 | 竞态条件或异步时序问题 | 增加 await/延时，看是否稳定 |
| 只在 CI 失败 | 环境差异（Node 版本、env 变量） | 对比 CI 和本地环境 |
| 特定数据失败 | 边缘案例未处理（null、空数组、特殊字符） | 用最小化数据复现 |

---

## 调试报告模板

调试完成后，在提交信息或 code-review.md 中包含：

```markdown
### 调试记录
- **错误**：[错误信息摘要]
- **根因**：[经过验证的根本原因]
- **修复**：[修改了什么，为什么]
- **验证**：[运行了什么命令，结果如何]
- **预防**：[如何防止这类错误再次发生]
```

---

## 接力

调试完成、问题修复后：
- 如果是 IMPLEMENTATION 阶段的 Bug → 继续 `implement-feature` 或 `implement-api`
- 如果是 QA 发现的 Bug → 通知 Reviewer 重新验证，执行 `code-review-arch`
- 如果根因是架构问题 → 通知 Orchestrator，考虑 rollback 到 ARCH_REVIEW
