---
name: setup-cicd
description: >
  Sets up GitHub Actions CI/CD, Dockerfile, deployment configuration, and monitoring.
  Used by DevOps agent after SECURITY_REVIEW passes.
---

# Setup CI/CD

> **存量项目适配**：以下技术规范是**全新项目的默认推荐**。
> 若 `docs/arch-decision.md` 或项目已有 CI/CD 配置（如 `.github/workflows/`、`vercel.json`、`Dockerfile`、`k8s/`），
> 以**现有基础设施**为准，不得强制引入新的部署平台。

## 技术栈（适用于全新项目）

```
容器      Docker + Docker Compose（开发）
CI/CD     GitHub Actions
部署      Vercel（前端）/ Fly.io 或 Railway（后端 Bun）
密钥管理  GitHub Secrets + OIDC（无长期密钥）
监控      Sentry（错误）+ Vercel Analytics / OpenTelemetry
日志      Pino + Axiom 或 Loki
```

## GitHub Actions 流水线

```yaml
# .github/workflows/ci.yml
name: CI

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  quality:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with: { bun-version: latest }
      - run: bun install --frozen-lockfile
      - run: npx biome check --reporter=github .    # Lint + Format
      - run: bun run typecheck                       # tsc --noEmit
      - run: bun test --coverage                     # Unit tests
      - uses: codecov/codecov-action@v4

  e2e:
    runs-on: ubuntu-latest
    needs: quality
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun install --frozen-lockfile
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: bunx playwright install --with-deps
      - run: bun run build
      - run: bun run start &
        env:
          DATABASE_URL: ${{ secrets.TEST_DATABASE_URL }}
          BETTER_AUTH_SECRET: ${{ secrets.BETTER_AUTH_SECRET }}
      - run: bunx playwright test
      - uses: actions/upload-artifact@v4
        if: failure()
        with: { name: playwright-report, path: playwright-report/ }

  security:
    runs-on: ubuntu-latest
    needs: quality
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun install --frozen-lockfile
      - run: bun audit --audit-level=high
      - name: Secret scan
        uses: trufflesecurity/trufflehog@main
        with: { path: ./, only-verified: true }

  deploy:
    runs-on: ubuntu-latest
    needs: [e2e, security]
    if: github.ref == 'refs/heads/main'
    steps:
      - uses: actions/checkout@v4
      - name: Deploy FE to Vercel
        uses: amondnet/vercel-action@v25
        with:
          vercel-token: ${{ secrets.VERCEL_TOKEN }}
          vercel-org-id: ${{ secrets.VERCEL_ORG_ID }}
          vercel-project-id: ${{ secrets.VERCEL_PROJECT_ID }}
          vercel-args: '--prod'
      - name: Deploy BE to Fly.io
        uses: superfly/flyctl-actions/setup-flyctl@master
      - run: flyctl deploy --remote-only
        env:
          FLY_API_TOKEN: ${{ secrets.FLY_API_TOKEN }}
```

## Dockerfile（Bun 后端）

```dockerfile
FROM oven/bun:1-alpine AS base
WORKDIR /app

FROM base AS deps
COPY package.json bun.lockb ./
RUN bun install --frozen-lockfile --production

FROM base AS build
COPY package.json bun.lockb ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build

FROM base AS release
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/src ./src

ENV NODE_ENV=production
USER bun
EXPOSE 3000/tcp
ENTRYPOINT ["bun", "run", "src/index.ts"]
```

## 环境变量模板（`.env.example`）

```bash
# Database
DATABASE_URL="postgresql://user:password@host:5432/db?sslmode=require"

# Auth
BETTER_AUTH_SECRET="32+ 字符随机字符串"
BETTER_AUTH_URL="https://yourdomain.com"

# OAuth（可选）
GITHUB_CLIENT_ID=""
GITHUB_CLIENT_SECRET=""

# Monitoring
SENTRY_DSN=""

# Frontend
NEXT_PUBLIC_APP_URL="https://yourdomain.com"
```

## 监控配置（Sentry）

```typescript
// instrumentation.ts（Next.js 15）
import * as Sentry from '@sentry/nextjs'

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV,
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
})
```

## 完工检查清单

- [ ] CI：Lint → 类型检查 → 单元测试 → E2E → 安全扫描 → 部署（全链路）
- [ ] 所有密钥通过 Secrets 管理，无明文
- [ ] `.env.example` 包含所有必需变量
- [ ] 环境变量启动时 Zod 验证
- [ ] 健康检查端点 `/health` 配置
- [ ] Sentry 错误监控接入
- [ ] 部署回滚方案记录在 `docs/deploy-plan.md`

---

## 接力

`docs/deploy-plan.md` 输出完成后：
→ 通知 Orchestrator 推进到 `DEPLOY_PREP`（最终部署确认，MANUAL 节点）→ 用户确认后 → `DONE`
