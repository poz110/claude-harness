---
name: stitch-design
description: >
  Generates real UI design screens using Google Stitch MCP. Derives complete
  page list from PRD + design-spec, builds per-page prompts with full feature
  context, calls Stitch MCP, verifies output completeness, and hands off to FE.
  Never silently degrades or skips pages. Always confirms page inventory upfront.
---

# Stitch Design — 真实设计稿生成

## 核心约束

1. **不遗漏**：每一个在 `docs/design-spec.md` 页面清单里的页面都必须生成设计稿
2. **不简化**：每个 prompt 必须包含该页面所有功能模块的具体描述
3. **不静默降级**：任何失败必须明确告知用户，不能跳过
4. **可验证**：生成完成后必须逐页核对，输出完整性报告

---

## Phase 0：前置读取（每次调用必须执行）

**按顺序读取以下文件，构建完整的设计上下文：**

```
1. docs/prd.md          → 功能需求列表（Section 3）、用户场景（Section 2）
2. docs/arch-decision.md → 技术约束、支持的组件库
3. DESIGN.md            → 字体名、颜色精确 hex、间距、圆角规则
4. docs/design-spec.md  → 完整页面清单（Step 0 推导结果）、每页功能模块、组件规范
```

**如果以上任一文件缺失，停止并报告：**
```
❌ 缺少必要文件：{文件名}
请先完成以下步骤：
- 缺 DESIGN.md → 先运行 /design-system
- 缺 design-spec.md → 先运行 /design-spec
- 缺 prd.md / arch-decision.md → 请检查工作流状态
```

---

## Phase 1：构建完整页面生成队列

从 `docs/design-spec.md` 的页面清单中提取所有需要生成的页面，建立生成队列。

**生成队列格式（必须在生成前输出，供用户确认）：**

```markdown
## 📋 本次 Stitch 生成队列

**总计：{N} 个页面，{M} 次 Stitch 调用**（桌面版 + 移动版 = 各页面 ×2）

| # | 页面名 | 路由 | 设计稿路径 | 包含的功能模块 |
|---|--------|------|----------|-------------|
| 1 | 登录页 | /login | design/login/ | 表单、错误提示、记住密码 |
| 2 | 商品列表 | /products | design/products/ | 筛选栏、商品卡片、分页 |
| 3 | 购物车 | /cart | design/cart/ | 商品列表、价格汇总、结算CTA |
| ... | ... | ... | ... | ... |

**不生成的页面**（原因说明）：
- {页面名}：{原因，如"纯系统页，无需设计稿"}

请确认队列正确后回复「开始生成」，或告诉我需要调整的内容。
```

**等待用户确认后再执行 Phase 2。**

---

## Phase 2：Stitch MCP 状态检测

```bash
MCP_STATUS="NOT_CONFIGURED"
claude mcp list 2>/dev/null | grep -qi "stitch" && MCP_STATUS="READY"
[ -f ".mcp.json" ] && grep -qi "stitch" .mcp.json 2>/dev/null && MCP_STATUS="READY"
[ -f "$HOME/.claude/mcp.json" ] && grep -qi "stitch" "$HOME/.claude/mcp.json" && MCP_STATUS="READY"
echo $MCP_STATUS
```

### 情况 A：MCP_READY → 直接进入 Phase 3

### 情况 B：已有设计稿（design/index.html 存在，但 MCP 未配置）

```
## 发现已有设计稿

design/ 目录已存在，包含 {N} 个页面设计稿。

A) 直接使用，FE 按现有设计稿实现（跳过生成）
B) 补充生成缺少的页面（需配置 Stitch MCP）
C) 全部重新生成（需配置 Stitch MCP，将覆盖现有文件）

请回复 A、B 或 C：
```

选 B 时：对比 Phase 1 队列和 design/ 目录，找出缺少的页面，只生成缺少的。

### 情况 C：MCP 未配置，无设计稿 → 停止并展示

```
## ⚙️ 需要你的决定：Stitch MCP 未配置

已准备好 {N} 个页面的生成队列，需要 Stitch MCP 才能生成。

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

选项 1：现在配置 Stitch（推荐，约 2 分钟后自动生成所有 {N} 页）
  获取 API Key：https://stitch.withgoogle.com → Settings → API Keys
  直接把 API Key 粘贴给我，我来完成配置并立即开始生成

选项 2：第三方代理配置（解决 OAuth 问题）
  需要先安装 Node.js
  在终端运行：npx @_davideast/stitch-mcp init
  运行完成后告诉我

选项 3：只生成提示词文件（之后手动操作）
  生成 design/stitch-prompts.md，包含所有 {N} 个页面的精确 prompt
  你可前往 https://stitch.withgoogle.com 手动逐页生成
  把下载的 HTML 放入 design/{page}/desktop.html 即可

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
请回复 1、2、3，或直接粘贴 API Key：
```

配置执行（选 1 / 直接粘贴 Key）：
```bash
claude mcp add stitch \
  --transport http \
  "https://stitch.googleapis.com/mcp" \
  --header "X-Goog-Api-Key: {KEY}" \
  -s user

# 验证
claude mcp list 2>/dev/null | grep -qi "stitch" \
  && echo "✅ 配置成功，开始生成..." \
  || echo "❌ 配置失败，请检查 API Key"
```

---

## Phase 3：为每个页面构建精确 Prompt

**这是质量最关键的步骤。** 每个 prompt 必须包含该页面所有功能模块的完整描述，不能只写"设计一个商品页"这种泛泛描述。

### Prompt 构建规则

从 `docs/design-spec.md` 中该页面的 `### {页面名}` 节提取：

**必须包含的 9 个要素：**

```
1. 产品类型与用途（第一句：说清这是什么产品的什么页面）
2. 整体布局尺寸（header px、sidebar px、main padding）
3. 颜色精确 hex（来自 DESIGN.md，不用描述词如"蓝色"）
4. 字体精确名称（来自 DESIGN.md）
5. 该页面的所有功能模块（来自 design-spec.md 功能模块清单）
6. 关键交互元素（按钮、表单、弹窗的具体描述）
7. 数据显示格式（表格列、金额格式、日期格式）
8. 风格关键词（3-5个精确词，不用"现代感""简洁"这类废话）
9. Avoid 列表（防 AI Slop 的必备项）
```

### 标准 Prompt 模板

```
Design a {产品类型} {页面用途} page.

Layout: {整体布局描述，含具体像素}.
  Header: {px}, {颜色 hex}, {内容描述，如 logo left + nav right + user avatar}.
  {Sidebar/Main/etc}: {px}, {颜色 hex}, {内容}.

Primary color: {hex}. Background: {hex}. Text: {hex}.
Font: {字体名}. Body size: {px}. Heading weight: {weight}.

Page sections (in order from top):
  1. {Section 名}: {具体内容描述，包括每个元素}
  2. {Section 名}: {具体内容描述}
  3. {以此类推，不要省略任何功能模块}

Key components:
  - {组件名}: {具体规格，如 "cards with white bg, 16px radius, 1px border #E5E7EB, shadow-sm"}
  - {组件名}: {具体规格}
  - Form fields (if any): {label style, input style, validation state}
  - Empty state (if list): title "{具体文案}", subtitle "{具体文案}", CTA "{按钮文字}"

Data format: {金额/日期/数字的显示格式}
Interaction states: show {hover/loading/error state description if needed}

Style: {3-5个具体风格词，如 "minimal, data-dense, professional, high-contrast"}.
Avoid: purple gradients, icon grids, decorative blobs, centered hero text, excessive shadows.
```

### 移动版 Prompt 调整规则

桌面版 prompt 基础上，增加以下修改说明：

```
[Mobile version, 390px wide]
Changes from desktop:
  - Navigation: {bottom tab bar / hamburger menu}
  - Sidebar (if any): hidden, accessible via {drawer / bottom sheet}
  - Columns: {N 列变为 1 列 / 具体网格变化}
  - Header: {高度变化，如 56px}
  - CTA buttons: {full-width}
  - {其他移动端特有的布局调整}
All other specs same as desktop.
```

### 具体 Prompt 示例（商品列表页）

```
Design an e-commerce product listing page for a consumer marketplace.

Layout: full-width, max-content 1280px, 24px side padding.
  Header: 64px, white (#FFFFFF), logo left 160px, search bar center 480px, cart icon + user avatar right.
  Left filter sidebar: 240px fixed, bg #F9FAFB, 1px border #E5E7EB, category tree + price range slider.
  Main area: white, 24px padding-left from sidebar.

Primary: #6366F1. Background: #F9FAFB. Text: #111827. Secondary text: #6B7280.
Font: Inter. Body: 14px. Product name: 16px weight 500.

Page sections:
  1. Breadcrumb: 12px gray text, "首页 / 电子产品 / 手机", 16px top padding.
  2. Results header: "共找到 128 件商品", sort dropdown right ("综合排序 ▾"), view toggle (grid/list).
  3. Product grid: 4 columns, 16px gap.
     Each card: white, 8px radius, 1px border #E5E7EB, hover shadow-md.
     Card content: product image 240×240px, product name 2 lines max ellipsis,
     price ¥1,234 in #111827 weight 600, original ¥1,599 strikethrough #9CA3AF,
     "已售 2.3万" in 12px #9CA3AF, "加入购物车" button full-width outlined.
  4. Pagination: centered, show 5 page numbers, prev/next arrows, current page #6366F1 filled.
  5. Empty state (no results): search icon 48px gray, title "没有找到商品", 
     subtitle "换个关键词试试", "清除筛选" button outlined.

Loading state: show 12 skeleton cards (same grid), shimmer animation.

Style: clean, commercial, product-focused, trustworthy.
Avoid: purple gradients, decorative blobs, icon grids, heavy shadows.
```

---

## Phase 4：顺序调用 Stitch MCP 生成

**按队列顺序逐页生成，不跳过，不并发（避免配额）。**

每个页面的生成步骤：

```
Step 4.1：调用 generate_screen_from_text（桌面版）
  prompt: {Phase 3 构建的完整 prompt}
  aspect_ratio: "desktop"
  → 保存 HTML 到 design/{page-slug}/desktop.html

Step 4.2：调用 generate_screen_from_text（移动版）
  prompt: {桌面版 prompt + 移动端调整}
  aspect_ratio: "mobile"
  → 保存 HTML 到 design/{page-slug}/mobile.html

Step 4.3：立即验证（生成后立刻检查，不等所有页面完成）
  检查文件大小：> 5KB 为有效（< 5KB 说明生成了空页面）
  检查关键词：grep -c "{页面关键词}" design/{page}/desktop.html
  如验证失败 → 立即触发 Phase 5 的失败处理
```

**进度汇报（每完成一页输出）：**

```
✅ [{当前}/{总数}] {页面名} — 桌面版 {文件大小}KB / 移动版 {文件大小}KB
```

---

## Phase 5：失败处理（单页生成失败）

```
❌ [{当前}/{总数}] {页面名} 生成失败

失败原因：{错误信息}
页面路径：design/{page}/desktop.html

处理选项：
  A) 自动优化 prompt 后重试（我来简化 prompt，保留关键信息）
  B) 跳过此页，继续生成其他页面（之后单独处理）
  C) 暂停所有生成，让我查看 prompt 后再决定
  D) 降级：把此页 prompt 写入 design/stitch-prompts.md，手动操作

请回复 A、B、C 或 D：
```

选 A 时的 Prompt 优化策略：
1. 删除超过 20 个单词的详细描述，保留结构描述
2. 组件描述从"所有组件"精简到"核心组件"
3. 颜色指定简化到主色 + 背景色 + 文字色
4. 保留 Avoid 列表（这个不能删）

---

## Phase 6：提取 Design Tokens

所有页面生成完成后，从第一个桌面版 HTML 提取 CSS 变量：

```bash
# 提取颜色 hex
grep -oE '#[0-9a-fA-F]{3,6}' design/*/desktop.html | sort | uniq -c | sort -rn | head -20

# 提取字体
grep -oE 'font-family:[^;]+' design/*/desktop.html | sort -u

# 提取主要间距值
grep -oE 'padding:[^;]+|margin:[^;]+|gap:[^;]+' design/*/desktop.html | sort | uniq -c | sort -rn | head -10
```

生成 `design/design-tokens.css`：

```css
/* Design Tokens — 从 Stitch 设计稿提取
   生成时间：{date}
   来源：design/*/desktop.html */

:root {
  /* 从 DESIGN.md 核心品牌色 */
  --color-brand: {hex};
  --color-brand-hover: {hex};

  /* 从设计稿统计的实际使用颜色 */
  --color-bg-primary: {hex};         /* 页面背景，出现 {N} 次 */
  --color-bg-secondary: {hex};       /* 卡片背景 */
  --color-text-primary: {hex};
  --color-text-secondary: {hex};
  --color-border: {hex};

  /* 语义色 */
  --color-success: {hex};
  --color-warning: {hex};
  --color-error: {hex};

  /* 字体 */
  --font-primary: '{字体名}', system-ui, sans-serif;

  /* 间距（来自设计稿主要使用的 padding/gap 值） */
  --space-xs: 4px;
  --space-sm: 8px;
  --space-md: 16px;
  --space-lg: 24px;
  --space-xl: 32px;

  /* 圆角（来自 DESIGN.md） */
  --radius-sm: {px};
  --radius-md: {px};
  --radius-lg: {px};
}
```

---

## Phase 7：生成汇总入口 index.html

```html
<!DOCTYPE html>
<html lang="zh">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{项目名} 设计稿</title>
  <style>
    body{font-family:system-ui;max-width:1200px;margin:40px auto;padding:0 24px;color:#111}
    h1{font-size:24px;font-weight:600;margin-bottom:4px}
    .meta{color:#6B7280;font-size:13px;margin-bottom:32px}
    .stats{display:flex;gap:24px;margin-bottom:24px;padding:16px;background:#F9FAFB;
      border-radius:8px;border:1px solid #E5E7EB}
    .stat{text-align:center}
    .stat-num{font-size:28px;font-weight:700;color:#6366F1}
    .stat-label{font-size:12px;color:#6B7280;margin-top:2px}
    .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:16px}
    .card{border:1px solid #E5E7EB;border-radius:10px;overflow:hidden;transition:box-shadow .15s}
    .card:hover{box-shadow:0 4px 12px rgba(0,0,0,.08)}
    .card-header{padding:14px 16px;background:#F9FAFB;border-bottom:1px solid #E5E7EB}
    .card-title{font-weight:600;font-size:14px;margin:0 0 2px;color:#111}
    .card-route{font-size:11px;color:#9CA3AF;font-family:monospace;margin:0}
    .card-body{padding:10px 16px 12px}
    .card-desc{font-size:12px;color:#6B7280;margin:0 0 10px}
    .card-links{display:flex;gap:6px}
    .card-links a{font-size:12px;color:#6366F1;text-decoration:none;
      padding:4px 12px;border:1px solid #C7D2FE;border-radius:5px;background:#EEF2FF}
    .card-links a:hover{background:#E0E7FF}
    .badge{display:inline-block;font-size:10px;padding:2px 6px;border-radius:4px;
      font-weight:500;margin-left:6px}
    .badge-p0{background:#FEF3C7;color:#92400E}
    .badge-p1{background:#F3F4F6;color:#6B7280}
  </style>
</head>
<body>
  <h1>{项目名} — 设计稿</h1>
  <p class="meta">生成：{date} | 工具：Google Stitch MCP | 共 {N} 个页面</p>

  <div class="stats">
    <div class="stat"><div class="stat-num">{N}</div><div class="stat-label">总页面数</div></div>
    <div class="stat"><div class="stat-num">{M}</div><div class="stat-label">桌面版</div></div>
    <div class="stat"><div class="stat-num">{M}</div><div class="stat-label">移动版</div></div>
    <div class="stat"><div class="stat-num">{P0}</div><div class="stat-label">P0 优先</div></div>
  </div>

  <div class="grid">
    {每个页面一个卡片，动态生成}
    <div class="card">
      <div class="card-header">
        <p class="card-title">{页面名}<span class="badge badge-p0">P0</span></p>
        <p class="card-route">{路由}</p>
      </div>
      <div class="card-body">
        <p class="card-desc">{功能模块列表，逗号分隔}</p>
        <div class="card-links">
          <a href="{page}/desktop.html" target="_blank">桌面版</a>
          <a href="{page}/mobile.html" target="_blank">移动版</a>
        </div>
      </div>
    </div>
  </div>
</body>
</html>
```

---

## Phase 8：完整性验证报告

**所有页面生成后，必须输出完整性报告，不能省略。**

```markdown
## 设计稿完整性验证报告

生成时间：{date}
Stitch 调用次数：{N}

### 页面生成状态

| # | 页面名 | 路由 | 桌面版 | 移动版 | 文件大小 | 状态 |
|---|--------|------|--------|--------|---------|------|
| 1 | 登录页 | /login | ✅ | ✅ | 45KB / 38KB | 正常 |
| 2 | 商品列表 | /products | ✅ | ✅ | 62KB / 41KB | 正常 |
| 3 | 购物车 | /cart | ❌ | ❌ | — | 生成失败 |
| ... | | | | | | |

### 与设计规范的对齐检查

| 检查项 | 结果 |
|--------|------|
| design-spec.md 中的所有 P0 页面均已生成 | ✅ / ❌ {N} 个缺失 |
| design-spec.md 中的所有 P1 页面均已生成 | ✅ / ❌ {N} 个缺失 |
| design-tokens.css 已生成 | ✅ / ❌ |
| index.html 已生成 | ✅ / ❌ |
| stitch-prompts.md 备份已保存 | ✅ / ❌ |

### 缺失 / 失败的页面

{列出所有未成功生成的页面，及原因和处理建议}

### FE 交接注意事项

{基于实际生成结果，给 FE 的具体提示}
```

---

## Phase 9：FE 交接 + 工作流推进

在 `.claude/review-notes.md` 追加 FE 交接记录：

```markdown
## Designer → FE 交接（{date}）

### 设计稿已就绪

共生成 {N} 个页面，{M} 个设计稿文件：
→ 入口：design/index.html（在浏览器打开查看所有设计稿）

| 页面名 | 桌面版 | 移动版 | 功能模块 |
|--------|--------|--------|---------|
| {页面名} | design/{page}/desktop.html | design/{page}/mobile.html | {功能列表} |

### 关键参数（来自 DESIGN.md）
- 主色：{hex}
- 字体：{字体名}
- 圆角：{px}（小）/ {px}（中）/ {px}（大）
- 间距基准：8px（参见 design/design-tokens.css）

### FE 实现规则
- 视觉误差 ≤ 8px（超出需在实现报告中说明原因）
- 颜色必须使用 design-tokens.css 中的 CSS 变量，不允许硬编码 hex
- 以桌面版 HTML 为最高优先级参考，design-spec.md 为补充说明

### 未生成的页面
{如果有失败的页面，说明如何处理：手动生成路径或临时基于 design-spec 实现}
```

更新工作流状态：

```bash
node scripts/workflow.js log-agent \
  '{"agent":"designer","skill":"stitch-design","screens_total":{N},"screens_ok":{M},"status":"OK"}'

node scripts/workflow.js set-context "design_ready" "true"
node scripts/workflow.js set-context "design_screen_count" "{N}"
node scripts/workflow.js set-context "design_failed_pages" "{失败页面数}"
```

---

## 选项 3 降级：仅输出提示词文件

用户选择跳过生成时，输出 `design/stitch-prompts.md`，**包含完整的所有页面 prompt**：

```markdown
# Stitch 设计提示词 — {项目名}
生成时间：{date}
页面总数：{N}

## 使用说明

1. 前往 https://stitch.withgoogle.com → 新建项目
2. 按顺序操作每个 Screen 章节
3. 下载后：把桌面版 HTML 放入 design/{page-slug}/desktop.html
4. 下载后：把移动版 HTML 放入 design/{page-slug}/mobile.html
5. 全部完成后运行 /generate-stitch-designs（选项 A 复用现有）触发交接流程

---

## Screen 01：{页面名}（桌面版）
Stitch 设置：Aspect ratio = Desktop (1440×900)

{完整精确 prompt，使用 Phase 3 的标准模板，不省略任何要素}

---

## Screen 02：{页面名}（移动版）
Stitch 设置：Aspect ratio = Mobile (390×844)

{移动版 prompt}

---

{以此类推，每个页面一节，桌面 + 移动各一节}

---

## 配置 Stitch MCP 后重新自动生成（推荐）

配置步骤：
1. 前往 https://stitch.withgoogle.com → Settings → API Keys → 生成 Key
2. 在 Claude Code 中运行：
   claude mcp add stitch --transport http \
     https://stitch.googleapis.com/mcp \
     --header "X-Goog-Api-Key: YOUR_KEY" -s user
3. 重新运行 /generate-stitch-designs（自动生成所有 {N} 个页面）
```

---

## 接力

Stitch 设计稿生成并验证完成后：
→ 通知 Orchestrator 推进 `DESIGN_REVIEW` → `IMPLEMENTATION`，fullstack-engineer 以设计稿为视觉参考实现 FE
