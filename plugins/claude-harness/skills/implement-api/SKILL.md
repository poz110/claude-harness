---
name: implement-api
description: >
  Implements backend APIs using Bun, Hono, Drizzle ORM, tRPC v11, better-auth.
  Load this skill when BE agent needs implementation details.
---

# Implement API (BE)

## 技术栈（2025/2026）

```
运行时      Bun 1.x
后端框架    Hono（轻量、边缘友好）或 Elysia（Bun 原生，Eden 类型推断）
ORM         Drizzle ORM（无 generate 步骤，Schema=类型）
数据库      PostgreSQL 16+（Neon/Supabase serverless 可选）
缓存/队列   Redis / Upstash（BullMQ）
接口        tRPC v11（全栈项目推荐）
验证        Zod v4（与 Drizzle/tRPC 深度集成）
认证        better-auth（TS 原生）
邮件        Resend + React Email
代码质量    Biome
测试        Bun test + Hono test helper
```

## 项目结构

```
src/
├── db/
│   ├── schema.ts          # Drizzle schema（类型即 Schema）
│   ├── index.ts           # db client
│   └── migrations/
├── routes/v1/             # Hono 路由（REST 方案）
├── trpc/routers/          # tRPC routers（全栈方案）
├── services/              # 业务逻辑层
├── middleware/
│   ├── auth.ts
│   ├── validate.ts
│   └── rate-limit.ts
└── lib/
    ├── auth.ts            # better-auth 配置
    ├── errors.ts          # 统一错误类型
    └── env.ts             # Zod 环境变量验证
```

## 关键模式

### Drizzle Schema（核心）

```typescript
// db/schema.ts
import { pgTable, text, timestamp, decimal, index } from 'drizzle-orm/pg-core'
import { createInsertSchema, createSelectSchema } from 'drizzle-zod'
import { z } from 'zod/v4'
import { relations } from 'drizzle-orm'

export const users = pgTable('users', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  email: text('email').notNull().unique(),
  name: text('name'),
  role: text('role', { enum: ['user', 'admin'] }).default('user').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  index('users_email_idx').on(t.email),
])

// 自动生成 Zod schema（无需手写）
export const insertUserSchema = createInsertSchema(users, {
  email: (s) => s.email({ message: '请输入有效邮箱' }),
})
export const selectUserSchema = createSelectSchema(users)
export type InsertUser = z.infer<typeof insertUserSchema>
export type SelectUser = z.infer<typeof selectUserSchema>
```

### Hono API 路由

```typescript
// routes/v1/orders.ts
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod/v4'
import { db } from '@/db'
import { orders, insertOrderSchema } from '@/db/schema'
import { authMiddleware } from '@/middleware/auth'
import { AppError } from '@/lib/errors'
import { eq, and, desc, sql } from 'drizzle-orm'

const app = new Hono()
  .get('/', authMiddleware, zValidator('query', z.object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })), async (c) => {
    const { page, limit } = c.req.valid('query')
    const userId = c.get('userId')
    const [items, [{ count }]] = await Promise.all([
      db.select().from(orders).where(eq(orders.userId, userId))
        .orderBy(desc(orders.createdAt)).limit(limit).offset((page - 1) * limit),
      db.select({ count: sql<number>`count(*)` }).from(orders).where(eq(orders.userId, userId)),
    ])
    return c.json({ data: items, meta: { page, limit, total: count } })
  })
  .post('/', authMiddleware, zValidator('json', insertOrderSchema), async (c) => {
    const userId = c.get('userId')
    const data = c.req.valid('json')
    const [order] = await db.insert(orders).values({ ...data, userId }).returning()
    return c.json({ data: order }, 201)
  })

export default app
```

### tRPC v11 Router

```typescript
// trpc/routers/order.ts
import { z } from 'zod/v4'
import { router, protectedProcedure } from '@/trpc/trpc'
import { db } from '@/db'
import { orders, insertOrderSchema } from '@/db/schema'
import { eq, desc } from 'drizzle-orm'

export const orderRouter = router({
  list: protectedProcedure
    .input(z.object({ page: z.number().default(1), limit: z.number().default(20) }))
    .query(async ({ ctx, input }) => {
      const items = await db.select().from(orders)
        .where(eq(orders.userId, ctx.user.id))
        .orderBy(desc(orders.createdAt))
        .limit(input.limit).offset((input.page - 1) * input.limit)
      return { data: items }
    }),
  create: protectedProcedure
    .input(insertOrderSchema)
    .mutation(async ({ ctx, input }) => {
      const [order] = await db.insert(orders)
        .values({ ...input, userId: ctx.user.id }).returning()
      return { data: order }
    }),
})
```

### better-auth 配置

```typescript
// lib/auth.ts
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { db } from '@/db'
import * as schema from '@/db/schema'

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: 'pg', schema }),
  emailAndPassword: { enabled: true, requireEmailVerification: true },
  socialProviders: {
    github: { clientId: process.env.GITHUB_CLIENT_ID!, clientSecret: process.env.GITHUB_CLIENT_SECRET! },
  },
  session: { expiresIn: 60 * 60 * 24 * 7 },
  rateLimit: { window: 60, max: 10 },
})
```

### 统一错误处理

```typescript
// lib/errors.ts
export class AppError extends Error {
  constructor(
    public message: string,
    public statusCode: number,
    public code: string,
    public details?: unknown
  ) { super(message) }

  static notFound = (r: string) => new AppError(`${r} not found`, 404, 'NOT_FOUND')
  static unauthorized = () => new AppError('Unauthorized', 401, 'UNAUTHORIZED')
  static forbidden = () => new AppError('Forbidden', 403, 'FORBIDDEN')
  static validation = (d: unknown) => new AppError('Validation failed', 400, 'VALIDATION_ERROR', d)
}

// Hono 全局错误中间件
app.onError((err, c) => {
  if (err instanceof AppError) {
    return c.json({ error: { code: err.code, message: err.message, details: err.details } }, err.statusCode as any)
  }
  return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } }, 500)
})
```

### 环境变量验证（启动时）

```typescript
// lib/env.ts
import { z } from 'zod/v4'

const envSchema = z.object({
  DATABASE_URL: z.url(),
  BETTER_AUTH_SECRET: z.string().min(32),
  NODE_ENV: z.enum(['development', 'production', 'test']),
  REDIS_URL: z.string().optional(),
})

export const env = envSchema.parse(process.env)
// 若缺少必需变量，启动时立即报错
```

## 执行顺序

1. 读取 `docs/arch-decision.md` 和 `docs/security-baseline.md`
2. 定义/更新 Drizzle schema（`db/schema.ts`）
3. 先写 `docs/api-spec.md`，与 FE 对齐接口格式
4. 实现路由：认证中间件 → Zod 验证 → 业务逻辑 → 错误处理
5. 集成测试：Bun test + Hono test helper
6. 完工自检：对照 be.md 完工清单

---

## 接力

BE 实现完成后：
→ 下一步：`implement-feature`（在同一 fullstack-engineer context 中继续 FE 实现）
→ 遇到 Bug：`systematic-debugging`
