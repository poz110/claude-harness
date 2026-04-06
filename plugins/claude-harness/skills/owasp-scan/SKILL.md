---
name: owasp-scan
description: >
  OWASP Top 10 (2021) security audit. Read-only scan using Grep and Bash.
  Cross-references docs/security-baseline.md for project-specific constraints.
---

# OWASP Scan

## 前置：读取安全基线

```bash
cat docs/security-baseline.md
# 了解本项目的具体安全约束，扫描时优先检查这些约束
```

## 扫描步骤

### A01 Broken Access Control
```bash
# 检查资源所有权验证
grep -rn "findFirst\|findById" apps/server/src/routes/ | grep -v "userId\|ownerId\|ctx.user"
# 检查直接路径参数访问（未验证所有权）
grep -rn "\.id\b" apps/server/src/routes/ | grep "param\|req\." | grep -v "userId\|user\.id"
```

### A02 Cryptographic Failures
```bash
grep -rn "md5\|sha1\|Math\.random()" apps/server/src/
grep -rn "password.*=.*['\"]" apps/server/src/     # 明文密码
grep -rn "localStorage\|sessionStorage" apps/web/src/ # Token 存在前端存储
```

### A03 Injection
```bash
grep -rn "sql\`\|rawQuery\|executeRaw" apps/server/src/ | grep -v "drizzle\|schema"
grep -rn "eval(\|new Function(" apps/server/src/
```

### A04 Insecure Design
```bash
# 检查速率限制覆盖认证端点
grep -rn "rateLimit\|rate.limit" apps/server/src/
grep -rn "/auth\|/login\|/register" apps/server/src/routes/ | grep -v "rateLimit"
```

### A05 Security Misconfiguration
```bash
# CORS 配置检查
grep -rn "cors\|CORS\|origin.*\*" apps/server/src/
# 生产环境详细错误检查
grep -rn "process\.env\.NODE_ENV.*!==.*production\|isDev" apps/server/src/
```

### A06 Vulnerable Components
```bash
bun audit --audit-level=high
# 或
npm audit --audit-level=high
```

### A07 Authentication Failures
```bash
# Refresh Token 轮换
grep -rn "refreshToken\|refresh_token" apps/server/src/ | grep -v "test\|spec"
# 账户锁定
grep -rn "failedAttempts\|lockout\|maxAttempts" apps/server/src/
```

### Secret 扫描
```bash
grep -rn "sk_live\|sk_test\|AKIA[A-Z0-9]" apps/
grep -rn "-----BEGIN.*PRIVATE KEY-----" .
grep -rn "['\"][a-zA-Z0-9+/]{40,}['\"]" apps/server/src/ | grep -v "node_modules\|test"
```

## 输出格式

写入 `docs/security-report.md`：

```markdown
# 安全审计报告
审计日期：YYYY-MM-DD | 安全基线版本：v1.0

## 总体结论：[PASS / PASS WITH NOTES / FAIL]

## 安全基线合规检查
| 约束项 | 状态 | 说明 |
|--------|------|------|
| Token 存储 | PASS/FAIL | |
| 密码哈希 | PASS/FAIL | |
| 速率限制 | PASS/FAIL | |

## 🔴 Critical / High（FAIL，阻塞发布）
| ID | 位置 | OWASP | 描述 | 修复建议 |
|----|------|-------|------|---------|

## 🟡 Medium（不阻塞，建议修复）

## 依赖漏洞
[bun audit 输出摘要]

## Secret 扫描结果
[扫描结论]
```

## 漏洞级别 → 工作流影响

| 级别 | 定义 | 影响 |
|------|------|------|
| Critical | 远程执行代码/系统接管 | 禁止发布，回滚至 CODE_REVIEW，重跑 QA |
| High | 数据泄露/权限绕过 | 禁止发布，修复后重跑 |
| Medium | 有限影响 | PM 决定是否阻塞 |
| Low | 轻微信息泄露 | 记录，不阻塞 |

---

## 接力

OWASP 扫描完成后：
- **无 Critical/High** → `setup-cicd`（DevOps 部署配置）→ 通知 Orchestrator 推进 `DEPLOY_PREP_SETUP`
- **有 Critical/High** → 阻塞，通知 Orchestrator 触发 `security-reaudit`，FE/BE 修复后重跑本技能
