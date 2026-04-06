---
name: generate-design
description: >
  Executes the Designer workflow: AI Slop detection → competitive research →
  design system proposal → design spec generation. Produces DESIGN.md and
  docs/design-spec.md with 80-item audit score.
---

# Generate Design — 完整执行流程

## Phase 1：AI Slop 检测（必须最先执行）

对照 10 种反模式，评估当前设计方向或已有设计：

```markdown
## AI Slop 检测报告

| # | 反模式 | 检测结果 | 严重程度 |
|---|--------|---------|---------|
| 1 | 蓝紫渐变背景 hero 区 | 发现/未发现 | 🔴 高危 |
| 2 | 三列等宽图标网格 | 发现/未发现 | 🔴 高危 |
| 3 | 全局统一圆角（无变化） | 发现/未发现 | 🟡 中危 |
| 4 | 漂浮装饰性 blob/形状 | 发现/未发现 | 🔴 高危 |
| 5 | 所有区块文字居中对齐 | 发现/未发现 | 🟡 中危 |
| 6 | 库存风格 hero 图片 | 发现/未发现 | 🟡 中危 |
| 7 | 字体超过 2 种字族 | {实际数量} | 🟡 中危 |
| 8 | 超过 12 种颜色 | {实际数量} | 🔴 高危 |
| 9 | 几乎每个元素都有动效 | 发现/未发现 | 🟡 中危 |
| 10 | 每屏 2+ 个等权重 CTA | {实际数量} | 🔴 高危 |

**高危问题数**：{N}
**评级**：PASS（0个高危）/ WARNING（1-2个）/ FAIL（≥3个高危）

FAIL 时：停止生成 design-spec，先解决高危问题。
```

---

## Phase 2：竞品设计研究

读取 `docs/prd.md`，提取产品类型，分析竞品设计语言：

```markdown
## 竞品设计分析

**产品类型**：{e.g., B2B SaaS 分析工具}

| 竞品 | 字体系统 | 主色 | 颜色数量 | 圆角风格 | 整体感 |
|------|---------|------|---------|---------|-------|
| {竞品 1} | {字体} | {颜色} | {N种} | {px} | {一词描述} |
| {竞品 2} | ... | ... | ... | ... | ... |
| {竞品 3} | ... | ... | ... | ... | ... |

**品类设计规范**（这是"不会出错的安全区"）：
- 主流字体选择：{总结}
- 主流颜色范围：{总结}
- 主流风格特征：{总结}

**差异化机会**（在哪里可以打破规范而不显得怪异）：
- {机会 1}：{原因}
- {机会 2}：{原因}
```

---

## Phase 3：设计方向提案

必须同时给出安全选择和创意风险：

```markdown
## 设计方向提案

### 方案 A：安全选择（符合品类预期）
- 主字体：{字体名} — 原因：{为什么安全，用户期望}
- 主色：{hex 值} — 原因：{品类常见颜色范围内}
- 圆角：{px} — 风格：{classy / friendly / minimal}
- 整体感：{一句话描述}
- 风险等级：低 — 最坏结果：平庸但专业

### 方案 B：创意风险（可能让产品被记住）
- 主字体：{非常规字体} — 理由：{为什么与品类不同，差异化价值}
- 主色：{非常规颜色} — 理由：{打破期望的原因}
- 圆角：{可能更极端的选择} — 效果：{具体的视觉效果}
- 整体感：{一句话描述}
- 风险等级：中/高
  - 如果成功：{正面效果，用户会说什么}
  - 如果失败：{失败原因，风险所在}

**Designer 推荐**：方案 {A/B}
理由：{具体说明，结合产品目标和用户特征}
```

---

## Phase 4：DESIGN.md 生成

用户选择方案后，输出完整设计系统文档：

```markdown
# 设计系统 — {项目名}
版本：v1.0 | 建立日期：{date} | 设计方案：{A/B}

---

## 设计原则

（必须是具体可验证的，不是"简洁美观"这类废话）

1. {原则 1}：{具体描述，举例说明怎么做到}
2. {原则 2}：{...}
3. {原则 3}：{...}

---

## 字体系统

### 选型
| 角色 | 字体名 | 引入方式 | 备注 |
|------|--------|---------|------|
| 主字体（标题）| {字体} | Google Fonts | {选择理由} |
| 副字体（正文）| {字体} | System | {选择理由} |
| 等宽字体 | {字体} | Google Fonts | 用于代码、数字 |

### 字阶规范
| 级别 | 大小 | 字重 | 行高 | 字间距 | 用途 |
|------|------|------|------|--------|------|
| display | 48px | 700 | 1.1 | -0.02em | 首屏大标题 |
| h1 | 32px | 600 | 1.2 | -0.01em | 页面标题 |
| h2 | 24px | 600 | 1.3 | 0 | 区块标题 |
| h3 | 18px | 500 | 1.4 | 0 | 子标题 |
| body-lg | 16px | 400 | 1.6 | 0 | 主正文 |
| body | 14px | 400 | 1.5 | 0 | 辅助文字 |
| caption | 12px | 400 | 1.4 | 0.01em | 标注说明 |

---

## 颜色系统

### CSS 变量定义
```css
@theme {
  /* 品牌色 */
  --color-brand:          oklch({L} {C} {H});
  --color-brand-hover:    oklch({L-0.05} {C} {H});
  --color-brand-subtle:   oklch({L+0.3} {C*0.3} {H});

  /* 中性色（6级）*/
  --color-gray-50:   oklch(0.98 0.002 {H});
  --color-gray-100:  oklch(0.95 0.003 {H});
  --color-gray-200:  oklch(0.90 0.005 {H});
  --color-gray-400:  oklch(0.70 0.008 {H});
  --color-gray-600:  oklch(0.45 0.010 {H});
  --color-gray-900:  oklch(0.15 0.005 {H});

  /* 语义色 */
  --color-success:  oklch(0.65 0.18 145);
  --color-warning:  oklch(0.75 0.18 75);
  --color-error:    oklch(0.55 0.22 25);
  --color-info:     oklch(0.60 0.15 230);

  /* 语义背景/文字/边框 */
  --color-bg-primary:   var(--color-gray-50);
  --color-bg-secondary: var(--color-gray-100);
  --color-bg-tertiary:  var(--color-gray-200);

  --color-text-primary:   var(--color-gray-900);
  --color-text-secondary: var(--color-gray-600);
  --color-text-tertiary:  var(--color-gray-400);

  --color-border:       var(--color-gray-200);
  --color-border-focus: var(--color-brand);
}

/* 暗色模式 */
.dark {
  --color-bg-primary:   oklch(0.10 0.005 {H});
  --color-bg-secondary: oklch(0.14 0.005 {H});
  --color-text-primary: oklch(0.95 0.005 {H});
  /* ... 完整暗色映射 ... */
}
```

### 颜色使用规则
- **总颜色数上限**：{N} 种（不含透明度变体）
- 颜色传达含义，不用作装饰
- 禁止直接使用原始 hex 值，必须通过语义变量名
- 禁止：{列出项目特定的禁止用法}

---

## 间距系统

**基准值：8px**（所有间距必须是 8 的倍数或 4px）

| token | 值 | 用途 |
|-------|----|------|
| space-1 | 4px | 图标内间距，紧凑元素 |
| space-2 | 8px | 行内元素间距 |
| space-3 | 12px | 小组件内间距 |
| space-4 | 16px | 组件内标准间距 |
| space-6 | 24px | 组件间间距 |
| space-8 | 32px | 区块间间距 |
| space-12 | 48px | 大区块间距 |
| space-16 | 64px | 区域间距 |

**禁止使用任意值**（如 13px、22px、37px）

---

## 圆角系统

| token | 值 | 适用场景 |
|-------|----|---------|
| radius-none | 0 | {具体用途，如：表格、分隔线} |
| radius-sm | 4px | {具体用途，如：标签、小按钮} |
| radius-md | 8px | {具体用途，如：输入框、按钮} |
| radius-lg | 16px | {具体用途，如：卡片、模态框} |
| radius-full | 999px | 仅用于：{限制用途，如：pill badge} |

**禁止随意混用**：同一组件不同实例必须使用相同 radius token

---

## 阴影系统

（不超过 3 级，明确每级语义）

| 级别 | 值 | 用途 |
|------|-----|------|
| shadow-sm | 0 1px 2px rgba(0,0,0,0.05) | 卡片悬浮前 |
| shadow-md | 0 4px 12px rgba(0,0,0,0.08) | 卡片 hover、下拉菜单 |
| shadow-lg | 0 8px 24px rgba(0,0,0,0.12) | 模态框、抽屉 |

---

## 动效系统

| 场景 | 时长 | 缓动 | 说明 |
|------|------|------|------|
| 微交互（颜色/透明度）| 150ms | ease-out | 按钮 hover、输入 focus |
| 组件进出场 | 250ms | ease-spring | 下拉、提示框 |
| 页面切换 | 350ms | ease-out | View Transitions |
| 大型动画 | ≤500ms | 自定义 | 谨慎使用 |

**减少动效原则**：`@media (prefers-reduced-motion)` 必须适配

---

## 核心组件规范速查

（详细规范在 docs/design-spec.md）

| 组件 | shadcn/ui 基础 | 主要改动 |
|------|--------------|---------|
| Button | Button | {颜色、大小变体} |
| Input | Input | {状态样式} |
| Card | Card | {圆角、阴影} |
| Dialog | Dialog | {尺寸、动效} |
| ... | ... | ... |
```

---

## Phase 5：80 项设计审计评分

对照完整评分表，输出分项得分：

### 评分规则
每项 0-1 分（1=通过，0=不通过）
总分 = 各项得分之和，满分 80

### 10 个类别（各 8 项）

**A. 版式（Typography）**
A1 标题字阶对比度 ≥ 3:1（最小 vs 最大）
A2 正文字体大小 ≥ 14px
A3 行高适配内容类型（标题 1.1-1.2，正文 1.5-1.6）
A4 字重不超过 3 种（含 regular/medium/bold）
A5 中文字间距已配置（标题 letter-spacing: -0.01em 到 -0.02em）
A6 无全大写正文段落（标题可以，正文不行）
A7 混合语言（中英）排版自然
A8 引用、代码块有明确的视觉区分

**B. 颜色（Color）**
B1 主色与白色背景对比度 ≥ 4.5:1
B2 小文字（< 18px）对比度 ≥ 4.5:1
B3 大文字（≥ 18px 或 bold ≥ 14px）对比度 ≥ 3:1
B4 颜色总数 ≤ DESIGN.md 定义的上限
B5 语义颜色（成功/警告/错误）有一致的应用规则
B6 渐变使用不超过 1 处
B7 颜色不是传达信息的唯一方式（同时用图标/文字）
B8 暗色模式颜色方案完整

**C. 间距与布局（Layout）**
C1 所有间距值在 8px 基准系统内
C2 相关元素间距 < 无关元素间距（Gestalt 邻近）
C3 内容最大宽度设置（≤ 1200px）
C4 移动端内边距 ≥ 16px
C5 网格系统一致（不随意混用列数）
C6 表单标签和输入框对齐规则一致
C7 图文混排有足够的环绕空间
C8 滚动时关键操作可见（sticky header/footer）

**D. 组件状态（States）**
D1 所有可交互元素有 hover 状态
D2 所有可交互元素有可见的 focus 状态
D3 disabled 状态视觉明确区分
D4 loading 状态有占位（skeleton 或 spinner）
D5 error 状态有明确视觉提示
D6 空状态有设计（不是空白）
D7 success 状态有反馈
D8 以上状态在暗色模式下也正确

**E. 响应式（Responsive）**
E1 375px 宽度无横向滚动
E2 768px 断点处理合理
E3 1024px+ 充分利用宽屏空间
E4 表格/图表在小屏有降级方案
E5 触摸目标 ≥ 44×44px（移动端所有交互元素）
E6 导航在移动端有明确的方案（底栏/汉堡）
E7 图片在不同屏幕下正确裁剪/缩放
E8 字体大小在移动端不低于 12px

**F. 信息层级（Hierarchy）**
F1 每屏有且只有一个最高权重 CTA
F2 视觉重量按重要性分配
F3 次要信息使用更低对比度
F4 空状态有明确的下一步引导
F5 错误信息比成功信息更显眼
F6 页面标题清楚描述页面内容
F7 列表/表格有明确的排序逻辑
F8 关键数字/状态在第一屏可见

**G. 交互设计（Interaction）**
G1 破坏性操作有确认步骤
G2 表单有实时验证（不是只在提交后报错）
G3 长操作（>1s）有进度反馈
G4 错误信息具体可操作（"请输入有效邮箱"不是"格式错误"）
G5 成功操作有明确反馈
G6 返回/取消操作清晰
G7 操作后状态明确（用户知道发生了什么）
G8 搜索/筛选有即时反馈

**H. 可访问性（Accessibility）**
H1 所有图片有 alt 文字（或 alt="" 声明装饰性）
H2 所有表单字段有 label
H3 键盘可完成所有核心操作
H4 Tab 顺序合理
H5 焦点样式可见（不依赖浏览器默认）
H6 颜色不是唯一的信息传达方式
H7 动效有 prefers-reduced-motion 适配
H8 ARIA 使用正确（不滥用，不缺失）

**I. 内容质量（Content）**
I1 无 Lorem ipsum 占位文字
I2 数字/日期格式全站一致
I3 CTA 文字描述动作（"开始试用"而非"提交"）
I4 错误信息用第一人称视角
I5 页面标题语义正确（h1/h2/h3 不为样式乱用）
I6 链接文字描述目标（不是"点击这里"）
I7 表单帮助文字在用户输入前就显示
I8 空状态文案有引导性

**J. AI Slop 防护（Anti-AI-Slop）**
J1 无蓝紫渐变背景
J2 无三列等宽图标网格
J3 无漂浮装饰性形状/blob
J4 颜色总数 ≤ DESIGN.md 规定上限
J5 圆角有变化（不是全局统一）
J6 不是所有区块都居中文字
J7 每屏 CTA 数量 ≤ 1 个主要 + 1 个次要
J8 字体选择有个性（不是默认 Inter/Roboto）

### 评分输出格式

```markdown
## 设计审计评分

| 类别 | 得分 | 满分 | 评级 |
|------|------|------|------|
| A 版式 | {X} | 8 | {A/B/C/F} |
| B 颜色 | {X} | 8 | {A/B/C/F} |
| C 间距布局 | {X} | 8 | {A/B/C/F} |
| D 组件状态 | {X} | 8 | {A/B/C/F} |
| E 响应式 | {X} | 8 | {A/B/C/F} |
| F 信息层级 | {X} | 8 | {A/B/C/F} |
| G 交互 | {X} | 8 | {A/B/C/F} |
| H 可访问性 | {X} | 8 | {A/B/C/F} |
| I 内容质量 | {X} | 8 | {A/B/C/F} |
| J AI Slop 防护 | {X} | 8 | {A/B/C/F} |
| **总计** | **{X}** | **80** | **{综合评级}** |

综合评级：A（≥70）/ B（56-69）/ C（40-55）/ F（<40）

需要修复的不通过项：
- [{类别}{编号}] {描述}：{修复建议}
```

---

## Figma AI 提示词格式

每个主要页面输出一个精确提示词：

```
Design a {功能描述 - 英文，具体} web interface.

Typography: {字体名，精确}. Heading size: {px}. Body size: {px}.
Colors: Primary {hex 精确值}, Background {hex 精确值}, Text {hex 精确值}.
Style keywords: {2-3 个精确描述词，避免 "modern", "clean", "minimal" 这类无意义词}.
Border radius: {px 值}.

Components needed:
- {组件 1}：{具体描述，包含位置、尺寸比例、内容}
- {组件 2}：{...}

Layout: {具体布局，如 "two-column with 240px fixed left sidebar and flexible right content"}
Responsive: mobile-first, 375px breakpoint shows {具体移动端变化}.

Strictly avoid:
- Blue-to-purple gradients
- Three-column icon grids  
- Floating decorative blobs
- Centered text in every section
- More than {N} distinct colors
```

---

## Phase 6：Designer 直接编写 HTML 设计稿（不依赖任何 MCP）

**核心约束**：不调用 Stitch MCP 或任何外部工具，Designer 用 HTML + 内联 CSS 自行实现每个页面的高保真视觉稿。

### 6.1 构建页面队列

从 `docs/design-spec.md` 提取完整页面清单，建立生成队列（每页生成 `design/{page-slug}/desktop.html`）。

---

### 6.2 每个页面的 HTML 模板标准

每个 `desktop.html` 必须满足：

**结构要求**：
- 完整的 `<!DOCTYPE html>` 文档
- `<head>` 中引入 Google Fonts（来自 DESIGN.md 字体选型）
- 使用 `<style>` 内联 CSS，所有颜色使用 CSS 变量（来自 DESIGN.md）
- 页面宽度模拟 1440px 桌面端，使用 `max-width: 1440px; margin: 0 auto`

**视觉还原要求**：
- 精确使用 DESIGN.md 中定义的颜色（CSS 变量 + fallback hex）
- 精确使用 DESIGN.md 中定义的字体、字阶、字重
- 精确使用 DESIGN.md 中定义的间距（8px 基准）、圆角
- 所有主要功能区块必须存在（来自 design-spec.md 该页的功能模块清单）
- 包含真实感的占位内容（非 Lorem ipsum）

**组件状态**：
- 所有按钮有 hover 样式（CSS `:hover`）
- 表单输入有 focus 样式
- 必要的空/加载/错误状态用注释标注或用 `[data-state]` 伪实现

**禁止**：
- 不得使用 Tailwind CDN 或外部 UI 框架
- 不得引用本地图片（用 CSS 背景色块或 SVG placeholder 代替）
- 不得使用随机 hex 颜色，所有颜色来自 DESIGN.md 定义的 CSS 变量

---

### 6.3 页面生成顺序

按 P0 优先：

```
1. 核心业务页（P0）— 逐一编写
2. 次要页（P1）— 编写
3. 系统页（注册/登录等，若有）— 编写
```

每写完一个页面，立即输出确认：
```
✅ [{当前}/{总数}] {页面名} → design/{slug}/desktop.html ({估计行数}行)
```

---

### 6.4 design/index.html 入口页

所有页面完成后，生成汇总入口：

```html
<!DOCTYPE html>
<html lang="zh">
<head>
  <meta charset="UTF-8">
  <title>{项目名} 设计稿</title>
  <style>
    body { font-family: system-ui; max-width: 1100px; margin: 40px auto; padding: 0 24px; }
    h1 { font-size: 22px; font-weight: 600; margin-bottom: 4px; }
    .meta { color: #6B7280; font-size: 13px; margin-bottom: 28px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px; }
    .card { border: 1px solid #E5E7EB; border-radius: 10px; overflow: hidden; }
    .card-header { padding: 14px 16px; background: #F9FAFB; border-bottom: 1px solid #E5E7EB; }
    .card-title { font-weight: 600; font-size: 14px; margin: 0 0 2px; }
    .card-route { font-size: 11px; color: #9CA3AF; font-family: monospace; margin: 0; }
    .card-body { padding: 12px 16px; }
    .card-desc { font-size: 12px; color: #6B7280; margin: 0 0 10px; }
    .card-link { font-size: 12px; color: #6366F1; text-decoration: none;
      padding: 4px 12px; border: 1px solid #C7D2FE; border-radius: 5px;
      background: #EEF2FF; display: inline-block; }
    .badge { display: inline-block; font-size: 10px; padding: 2px 6px;
      border-radius: 4px; font-weight: 500; margin-left: 6px; }
    .p0 { background: #FEF3C7; color: #92400E; }
  </style>
</head>
<body>
  <h1>{项目名} — 设计稿</h1>
  <p class="meta">生成：{date} | Designer 手写 HTML | 共 {N} 个页面</p>
  <div class="grid">
    {每个页面一个 card，含页面名、路由、功能模块摘要、桌面版链接}
  </div>
</body>
</html>
```

---

### 6.5 完整性验证

所有页面生成后输出验证报告：

```markdown
## 设计稿完整性验证

| 页面名 | 路由 | 文件 | 行数 | 状态 |
|--------|------|------|------|------|
| {页面名} | {路由} | design/{slug}/desktop.html | {N}行 | ✅ |

- design-spec.md 中所有 P0 页面均已生成：✅ / ❌
- design/index.html 已生成：✅ / ❌
- 所有文件使用 DESIGN.md 颜色变量：✅ / ❌
```

---

## 接力

所有产出物完成（`DESIGN.md` + `docs/design-spec.md` + `design/*/desktop.html` + `design/index.html`）后：
→ 下一步：`interaction-spec`（提取交互状态机）→ 通知 Orchestrator 推进 `DESIGN_REVIEW`
