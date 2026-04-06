---
name: prepare-tests
description: >
  Creates test plan, writes Vitest unit tests, Playwright E2E tests, and k6
  performance tests. Used by QA agent after CODE_REVIEW passes.
---

# Prepare Tests

## 测试技术栈

```
单元/组件  Vitest 2.x + React Testing Library + MSW 2.x
E2E        Playwright（含 axe-playwright 无障碍检测）
性能       k6 + Lighthouse CI
API Mock   MSW（网络层 mock，前后端通用）
覆盖率     v8 provider（Vitest）
```

## 测试金字塔

```
10% E2E      — Playwright，关键用户流程
20% 集成     — API 集成测试，DB 交互
70% 单元     — Vitest + RTL，组件、Hook、工具函数
```

## Vitest 配置

```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      thresholds: { lines: 80, functions: 80, branches: 75 },
    },
  },
})
```

## MSW Setup

```typescript
// tests/mocks/handlers.ts
import { http, HttpResponse } from 'msw'

export const handlers = [
  http.get('/api/v1/orders', () =>
    HttpResponse.json({ data: [], meta: { total: 0, page: 1 } })
  ),
]

// tests/setup.ts
import { setupServer } from 'msw/node'
import { handlers } from './mocks/handlers'

const server = setupServer(...handlers)
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())
```

## 组件测试示例

```typescript
import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

describe('LoginForm', () => {
  it('提交空表单显示验证错误', async () => {
    const user = userEvent.setup()
    render(<LoginForm onSubmit={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: /登录/i }))
    expect(await screen.findByRole('alert')).toBeInTheDocument()
  })

  it('键盘导航正常', async () => {
    const user = userEvent.setup()
    render(<LoginForm onSubmit={vi.fn()} />)
    await user.tab()
    expect(screen.getByLabelText(/邮箱/i)).toHaveFocus()
  })
})
```

## Playwright 配置

```typescript
// playwright.config.ts
import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  reporter: [['html'], ['junit', { outputFile: 'test-results/junit.xml' }]],
  use: { baseURL: 'http://localhost:3000', trace: 'on-first-retry' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-safari', use: { ...devices['iPhone 15'] } },
  ],
  webServer: {
    command: 'bun run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
  },
})
```

## E2E + 无障碍检测

```typescript
import { test, expect } from '@playwright/test'
import { checkA11y, injectAxe } from 'axe-playwright'

test('核心流程 + 无障碍', async ({ page }) => {
  await page.goto('/products')
  await injectAxe(page)
  await checkA11y(page, null, { detailedReport: true })

  // 业务流程
  await page.click('[data-testid="add-to-cart"]:first-child')
  await expect(page.locator('[data-testid="cart-count"]')).toHaveText('1')
})
```

## k6 性能测试

```javascript
// tests/performance/load-test.js
import http from 'k6/http'
import { check, sleep } from 'k6'

export const options = {
  stages: [
    { duration: '30s', target: 20 },
    { duration: '1m', target: 100 },
    { duration: '30s', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'],
    http_req_failed: ['rate<0.01'],
  },
}

export default function () {
  const res = http.get(`${__ENV.BASE_URL}/api/v1/orders`, {
    headers: { Authorization: `Bearer ${__ENV.TEST_TOKEN}` },
  })
  check(res, {
    'status 200': (r) => r.status === 200,
    'response <500ms': (r) => r.timings.duration < 500,
  })
  sleep(1)
}
```

## 测试计划模板（`docs/test-plan.md`）

```markdown
# [项目] 测试计划

## 测试范围
| 模块 | 功能 | 优先级 |

## 策略
| 类型 | 工具 | 目标 |
| 单元 | Vitest + RTL | ≥80% |
| E2E | Playwright | 关键流程 100% |
| 性能 | k6 | p95<500ms |
| 无障碍 | axe-playwright | 零 Critical |

## 用例
| ID | 场景 | 前置 | 步骤 | 期望 |
```

---

## 接力

测试计划创建、E2E 测试通过后：
- **所有测试 PASS** → 通知 Orchestrator 推进到 `SECURITY_REVIEW`
- **发现 P0/P1 Bug** → `systematic-debugging` 定位根因 → 通知 Orchestrator 触发 `qa-failure` 回滚
