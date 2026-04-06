---
name: interaction-spec
description: >
  Generates docs/interaction-spec.md through a TWO-PHASE process:
  Phase A — Designer extracts every interactive element from design screens
  and presents an Intent Confirmation Checklist to the user (DESIGN_PHASE
  MANUAL node). Phase B — after user confirms intent for each element,
  Designer locks the confirmed decisions into interaction-spec.md, which
  becomes the authoritative behavioral contract for FE, QA, and Reviewer.
  The spec is not a template to fill in — it is a record of confirmed
  human intent. Invoke at DESIGN_PHASE MANUAL after CEO_REVIEW completes.
---

# Interaction Spec — 从设计稿提取 → 用户确认意图 → 锁定行为规范

## 核心原则

**不是穷举模板，是意图外化。**

不管功能是登录表单、连接钱包、支付流程、实时协作还是拖拽排序——
规范的来源不是预设的模板，而是：
1. Designer 从设计稿中**看到**了什么可交互的元素
2. 用户**确认**每个元素的行为意图是否正确
3. 确认后的意图被**锁定**成 FE 实现的基准

没有经过用户确认的交互行为，不算定义清楚。

---

## 两个阶段

### Phase A：提取 + 确认（ARCH_REVIEW 末尾执行，DESIGN_PHASE 前）

Designer 从设计稿和 design-spec.md 中提取所有可交互元素，
生成"交互意图确认清单"，在 DESIGN_PHASE MANUAL 节点呈现给用户。

### Phase B：锁定（用户确认后立即执行）

将用户已确认的每一条意图，写入 `docs/interaction-spec.md`。
已确认 = 已定义。未确认 = 不实现（进入 v2 Backlog）。

---

## Phase A：生成交互意图确认清单

### Step A1：前置读取

```
按顺序读取：
1. docs/prd.md          → 提取 Must 功能列表和 Gherkin Scenario
2. docs/design-spec.md  → 提取每个页面的功能模块清单和弹窗/抽屉清单
3. design/{page}/desktop.html（如存在）→ 实际观察页面上的可点击元素
```

### Step A2：逐页提取可交互元素

对每一个页面，扫描三类元素：

**类型 1：触发导航的元素（去哪里）**
任何点击后会改变当前视图的元素：
- 跳转到其他页面的按钮/链接
- 打开弹窗（Modal）的按钮
- 打开抽屉（Drawer/Sheet）的按钮
- 打开下拉菜单（Dropdown）的按钮
- 展开/折叠内联区域的按钮
- Tab 切换

**类型 2：触发操作的元素（做什么）**
任何点击后会改变数据或系统状态的元素：
- 提交表单的按钮
- 删除/编辑/创建资源的按钮
- 上传文件的触发器
- 开关/切换控件
- 搜索触发器
- 任何调用 API 的按钮

**类型 3：输入数据的元素（填什么）**
任何接受用户输入的元素：
- 文本输入框（含 placeholder、最大长度、格式要求）
- 选择器（Select/Radio/Checkbox）
- 日期/时间选择器
- 文件上传区域
- 富文本编辑器

### Step A3：生成确认清单（每页一节）

格式如下，确保每一条都是一个**可以用 Yes/No 回答的问题**：

```markdown
## 交互意图确认清单
生成时间：{date} | 基于：design-spec.md + design/ 设计稿

> 请逐项确认每个交互元素的行为意图。
> ✅ 确认正确 | ✏️ 需要修改（请注明修改意见）| ❌ 本期不做（移入 v2）

---

### 页面：{页面名}（路由：{URL}）

#### 导航类（点了去哪里）

| # | 元素 | 位置 | 当前设计意图 | 确认？|
|---|------|------|------------|------|
| N1 | 「登录」按钮 | 表单底部 | 点击后调用登录 API，成功则跳转 /dashboard，失败则在表单上方显示错误提示 | ☐ |
| N2 | 「忘记密码」链接 | 密码输入框右下 | 点击后跳转 /forgot-password 页面（新页面，不是弹窗）| ☐ |
| N3 | 「还没有账号？注册」 | 表单底部 | 点击后跳转 /register | ☐ |

#### 操作类（做什么）

| # | 元素 | 位置 | 当前设计意图 | 确认？|
|---|------|------|------------|------|
| O1 | 「登录」按钮 | 表单底部 | 调用 POST /api/auth/login，提交 email + password | ☐ |
| O2 | （无其他操作类元素）| — | — | — |

#### 输入类（填什么）

| # | 字段 | 类型 | Placeholder | 必填 | 校验规则 | 确认？|
|---|------|------|------------|------|---------|------|
| I1 | 邮箱 | email | 请输入邮箱地址 | ✅ | 合法邮箱格式 | ☐ |
| I2 | 密码 | password | 请输入密码 | ✅ | 最少 8 位 | ☐ |

---

### 页面：{页面名}（路由：{URL}）

...（每个页面重复以上结构）

---

### ❓ Designer 的疑问（需要用户决策）

在提取过程中发现以下设计中未明确的交互，需要用户决定：

| # | 疑问 | 选项 A | 选项 B | 你的决定 |
|---|------|-------|-------|---------|
| ? | 商品详情页「加入购物车」后是否跳转购物车页？| 跳转 /cart | 留在当前页，显示 Toast | |
| ? | 订单创建成功后跳转订单详情还是订单列表？| 跳转 /orders/{id} | 跳转 /orders | |

---

### 本期不涉及的交互（确认排除）

以下交互在设计稿中未出现，确认本期不做：
- 社交登录（Google/GitHub OAuth）
- 手机号登录
- 记住登录状态（Remember me）

☐ 确认以上均不在本期范围内
```

### Step A4：呈现给用户

Designer 输出上述清单后，**停止等待**，不继续生成任何内容。

对话格式：

```
## ⏸ 需要你确认：交互意图确认清单

我从设计稿中提取了 {N} 个页面的 {M} 个交互元素，
需要你逐项确认每个元素的行为意图是否符合你的预期。

这是 FE 实现的行为基准——你确认后，FE 会严格按照你确认的内容实现，
不会自行决定"这个按钮应该打开弹窗还是跳转页面"。

[清单内容如上]

**你的操作**：
- 逐项在「确认？」列打 ✅（或告诉我哪项需要修改）
- 回答 Designer 疑问部分的选项
- 确认「本期不涉及」列表是否正确

全部确认后，我立即生成 interaction-spec.md 并通知 Orchestrator 继续。
```

---

## Phase B：锁定为 interaction-spec.md

用户确认完毕后，**立即执行**，不再等待：

### Step B1：将确认结果写入 interaction-spec.md

结构如下：

```markdown
# 交互行为规范（Interaction Spec）
版本：v1.0 | 确认日期：{date}
来源：用户在 DESIGN_PHASE 逐项确认的交互意图
维护：Designer 生成 → 用户确认 → FE 实现 → Reviewer F-019 核查 → QA Layer 6 测试

> 本文档记录的是**已经过用户确认的交互意图**。
> FE 实现时不得偏离此文档，如需修改须走变更流程（重新确认）。

---

## 第一部分：已确认的页面交互

### {页面名}（路由：{URL}）

#### 导航行为

| 元素 | 触发方式 | 目标 | 携带参数 |
|------|---------|------|---------|
| 「登录」按钮 | 点击（表单有效时）| 调用 API → 成功跳转 /dashboard | — |
| 「登录」按钮 | 点击（表单有效时）| 调用 API → 失败留在当前页 | 错误信息 |
| 「忘记密码」 | 点击 | 跳转 /forgot-password | — |
| 「去注册」 | 点击 | 跳转 /register | — |

#### 表单字段

| 字段 | 类型 | 必填 | 校验规则 | 错误文案 |
|------|------|------|---------|---------|
| 邮箱 | email | ✅ | 合法邮箱格式 | 请输入有效的邮箱地址 |
| 密码 | password | ✅ | 最少 8 位 | 密码至少需要 8 位字符 |

#### 操作行为

| 操作 | API | 成功后 | 失败后（按错误码）|
|------|-----|-------|----------------|
| 表单提交 | POST /api/auth/login | 跳转 /dashboard | 401→表单上方显示"邮箱或密码错误"；429→显示"操作太频繁，请稍后重试"；500→Toast "服务器异常，请稍后重试" |

---

## 第二部分：全局交互规则（来自用户确认）

这部分规则适用于所有页面，来自用户在确认过程中的统一决定：

{用户在确认过程中给出的全局决定，例如：
- "所有删除操作都需要二次确认弹窗"
- "API 失败后表单数据保留，不清空"
- "登录过期统一跳转登录页，不在当前页弹窗"
}

---

## 第三部分：本期不实现（已确认排除）

| 功能 | 排除原因 | 计划版本 |
|------|---------|---------|
| 社交登录 | 本期不做 | v2 |
| 手机号登录 | 本期不做 | v2 |

---

## 变更流程

如 FE 实现过程中发现需要偏离此规范：
1. FE 在 `.claude/review-notes.md` 说明偏离原因
2. Designer 评估并更新此文档
3. 用户确认变更
4. Reviewer 在 F-019 检查时使用最新版本
```

### Step B2：验证并通知

```bash
node scripts/workflow.js validate-doc interaction-spec
node scripts/workflow.js validate-doc error-map
```

两项通过后继续执行 Step B3，**不要在此暂停**。

---

### Step B3：为每个交互状态生成状态设计稿 HTML（State Baseline）

> **核心原则**：interaction-spec.md 定义了每个元素有哪些状态。
> 每个状态都需要一张"期望长什么样"的基准图，FE 实现后才能做客观 diff。
> 截图本身不够——截图只能抓默认加载后的画面，无法抓"折叠后"、"主题切换后"、"Modal 打开后"。

**从 interaction-spec.md 中提取所有产生视觉变化的状态转换**：

扫描每个页面的每个交互元素，找出所有"操作后页面外观会发生变化"的条目：

```
类型 1：视图切换（折叠/展开、Tab 切换、主题切换）
类型 2：覆盖层出现（Modal 打开、Drawer 打开、Dropdown 展开、Tooltip 显示）
类型 3：内容区状态（加载中 skeleton、空状态 empty、错误状态 error、成功态 success）
类型 4：表单状态（字段 focus、字段 error、字段 disabled、整体 submitting）
```

**对每一个状态，生成对应的静态 HTML 文件**，存入 `design/states/`：

文件命名规则：`design/states/{page}__{state-id}.html`

```
design/states/dashboard__sidebar-collapsed.html   ← 折叠后的 dashboard
design/states/dashboard__sidebar-expanded.html    ← 展开后（=默认，可复用）
design/states/dashboard__theme-dark.html          ← 暗色主题
design/states/dashboard__modal-create-open.html   ← 创建 Modal 打开状态
design/states/settings__tab-billing.html          ← Billing tab 激活
design/states/login__form-error.html              ← 表单提交失败状态
design/states/login__form-submitting.html         ← 按钮 loading 状态
```

**状态 HTML 的生成方式**：

优先调用 Stitch MCP 生成（与主设计稿同一风格）。

如果 Stitch 不可用，则直接从主设计稿 HTML（`design/{page}/desktop.html`）
派生——用内联 `<style>` 覆盖样式来模拟该状态：

```html
<!-- design/states/dashboard__sidebar-collapsed.html -->
<!-- 基于 design/dashboard/desktop.html，覆盖侧边栏为折叠态 -->
<!DOCTYPE html>
<html>
<head>
  <!-- 复用主设计稿的所有样式 -->
  <style>
    /* 覆盖：侧边栏折叠状态 */
    .sidebar { width: 64px !important; }
    .sidebar .nav-label { display: none !important; }
    .main-content { margin-left: 64px !important; }
    /* 确保主内容区填满，无空白 */
    .main-content { flex: 1; min-width: 0; }
  </style>
</head>
<body>
  <!-- 直接嵌入主设计稿的 HTML，用上方 style 覆盖状态 -->
  {desktop.html 的 body 内容}
</body>
</html>
```

**生成完毕后写入 manifest**：

```bash
node scripts/workflow.js design-baseline
# 此命令会自动扫描 design/states/ 并写入 manifest.json
```

**输出格式**（生成完成后告知用户）：

```
✅ interaction-spec.md 已生成并验证通过
   包含：{N} 个页面，{M} 个已确认交互元素

✅ 状态设计稿已生成
   design/states/ 目录：{K} 个状态文件
   覆盖的状态：
   - dashboard: sidebar-collapsed, sidebar-expanded, theme-dark, modal-create-open
   - login: form-error, form-submitting
   - settings: tab-billing, tab-profile
   ...（逐页列出）

   FE 实现后，Playwright 将对比每个状态的实现截图与此基准。
   任何视觉差异超过阈值将自动 FAIL，无需人工判断。

通知 Orchestrator：
  node scripts/workflow.js advance --force
  （DESIGN_PHASE MANUAL 节点现在可以推进）
```

---

## 变更管理

`interaction-spec.md` 一旦确认就是"已签署的合同"。FE 实现过程中如需变更：

| 变更类型 | 流程 |
|---------|------|
| 小调整（文案修改、错误提示位置）| FE 在 review-notes.md 说明 → Designer 更新文档 |
| 中等变更（增加一个字段、改变跳转目标）| FE 通知 Orchestrator → 召回 Designer 更新 → 用户确认 |
| 大变更（增加新功能、改变核心流程）| 回滚到 DESIGN_PHASE → 重新走确认流程 |

---

## 常见问题

**Q：连接钱包、支付、实时协作这类复杂功能怎么处理？**

A：一样的流程。Designer 从设计稿中提取这些功能的可交互元素，逐一列出：
- 「Connect Wallet」按钮 → 点击打开钱包选择 Modal 还是直接触发 MetaMask？
- 钱包选择 Modal 里有哪些选项？每个选项点击后做什么？
- 连接中的状态视觉是什么？
- 连接成功后显示什么？连接失败显示什么？

用户回答这些问题。答案写进 interaction-spec.md。FE 按答案实现。

不需要任何"钱包连接专用模板"，因为模板解决的是格式问题，不是意图问题。

**Q：用户确认阶段很繁琐，每个按钮都要确认吗？**

A：只有"行为存在歧义"的元素需要确认。
- 纯导航链接（文档链接、面包屑）→ 不需要确认，行为显而易见
- 标准表单提交 → 只确认成功/失败后的行为
- 复杂流程（支付、权限申请、异步操作）→ 必须确认

Designer 的职责是判断哪些有歧义，只把有歧义的提出来。
不要把所有按钮都列出来让用户逐一确认——那会让确认变成负担。

---

## 接力

`docs/interaction-spec.md` 输出并用户确认后：
→ 通知 Orchestrator 推进 `DESIGN_PHASE` → `DESIGN_REVIEW`，等待 fullstack-engineer 在 IMPLEMENTATION 消费此文档
