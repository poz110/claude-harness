---
name: implement-feature
description: >
  Implements frontend features using Next.js 15, React 19, shadcn/ui, Tailwind v4,
  tRPC/TanStack Query. Load this skill when FE agent needs implementation details.
---

# Implement Feature (FE)

> **⚠️ 存量项目适配说明**：以下技术规范是**全新项目的默认推荐**。
> 若目标项目已有代码（src 文件 > 20），**以 `docs/arch-decision.md` 中确认的现有技术栈为准**，
> 本规范中的具体框架（Next.js/shadcn/Tailwind/tRPC）作为参考，不得强行引入。
> 存量项目中，组件库、CSS 方案、路由方式须与现有代码保持一致。

## 技术栈（2025/2026，适用于全新项目）

```
运行时    Bun 1.x
框架      Next.js 15 — App Router + React Server Components + Server Actions
React     React 19 + React Compiler 1.0（自动 memoization）
组件库    shadcn/ui（复制到项目）+ Radix UI 原语
CSS       Tailwind CSS v4 — @theme 指令，CSS-first 配置
状态      Zustand 5（客户端）+ TanStack Query v5（服务端状态）
接口      tRPC v11（全栈项目）
表单      React Hook Form v7 + Zod v4
动效      Framer Motion（复杂）/ CSS View Transitions（页面切换）
代码质量  Biome
测试      Vitest + React Testing Library + Playwright + MSW
```

## 项目结构

```
src/
├── app/
│   ├── (auth)/login/page.tsx
│   ├── (dashboard)/
│   │   └── dashboard/
│   │       ├── page.tsx          # Server Component（默认）
│   │       └── _components/
│   ├── globals.css               # Tailwind v4 + Design Token
│   └── layout.tsx
├── components/
│   ├── ui/                       # shadcn/ui 组件（复制到项目）
│   └── [feature]/                # 业务组件
├── hooks/                        # 自定义 Hooks
├── lib/
│   ├── trpc/                     # tRPC client
│   ├── validations/              # Zod schemas（与 BE 共享）
│   └── utils.ts
├── stores/                       # Zustand stores
└── types/
```

## 关键模式

### Server Action（Next.js 15）

```typescript
// app/(dashboard)/actions.ts
'use server'
import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { insertOrderSchema } from '@/lib/validations/order'

export async function createOrder(formData: FormData) {
  const parsed = insertOrderSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { error: parsed.error.flatten() }
  await db.insert(orders).values(parsed.data)
  revalidatePath('/dashboard/orders')
  return { success: true }
}
```

### React 19 useActionState

```typescript
'use client'
import { useActionState } from 'react'
import { createOrder } from '../actions'

export function OrderForm() {
  const [state, formAction, isPending] = useActionState(createOrder, null)
  return (
    <form action={formAction}>
      <button type="submit" disabled={isPending}>
        {isPending ? '提交中...' : '创建'}
      </button>
      {state?.error && <p className="text-destructive">{JSON.stringify(state.error)}</p>}
    </form>
  )
}
```

### tRPC v11 客户端

```typescript
// lib/trpc/client.ts
import { createTRPCClient, httpBatchStreamLink } from '@trpc/client'
import type { AppRouter } from '@/server/routers/_app'

export const trpc = createTRPCClient<AppRouter>({
  links: [httpBatchStreamLink({ url: '/api/trpc' })],
})
```

### Zustand 5

```typescript
// stores/ui-store.ts
import { create } from 'zustand'
import { devtools, persist } from 'zustand/middleware'
import { immer } from 'zustand/middleware/immer'

interface UIState {
  sidebarOpen: boolean
  toggleSidebar: () => void
}

export const useUIStore = create<UIState>()(
  devtools(persist(immer((set) => ({
    sidebarOpen: true,
    toggleSidebar: () => set((s) => { s.sidebarOpen = !s.sidebarOpen }),
  })), { name: 'ui-storage' }))
)
```

### React Hook Form + Zod v4

```typescript
'use client'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod/v4'

const schema = z.object({
  email: z.email('请输入有效邮箱'),
  password: z.string().min(8, '密码至少 8 个字符'),
})

export function LoginForm() {
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm({
    resolver: zodResolver(schema),
  })
  return (
    <form onSubmit={handleSubmit(async (data) => { /* call server action */ })}>
      <input {...register('email')} aria-invalid={!!errors.email} />
      {errors.email && <span role="alert">{errors.email.message}</span>}
      <button type="submit" disabled={isSubmitting}>登录</button>
    </form>
  )
}
```

## 执行顺序

1. 代码探索：`Glob + Grep` 查找现有组件，避免重复
2. 规划：Server vs Client Component？Zustand vs Server State？
3. 实现：shadcn/ui 基础 → 业务组件 → Server Actions / tRPC hooks → 状态
4. 测试：Vitest + RTL 单元测试，MSW mock API
5. 完工自检：对照 fe.md 完工清单逐项验证

---

## 接力

FE 实现完成、自检通过后：
→ 下一步：`code-review-arch`（Phase 1 规范合规 + Phase 2 代码质量）
→ 遇到 Bug：`systematic-debugging`
→ 通知 Orchestrator：`write-agent-result '{"status":"success","nextAction":"advance"}'`
