---
name: writing-skills
description: >
  Methodology for creating new workflow skills. Enforces TDD for process
  documentation: write failing scenario first, then write the skill.
  Use when adding any new SKILL.md to the workflow.
---

# Writing Skills — 技能的测试驱动开发

## ⚡ Iron Law

**在没有"无此技能时的失败场景"证明之前，禁止创建新技能。**

技能是流程约束，不是功能代码。如果你无法演示"没有这个技能时 Agent 会做什么错误的事"，那么这个技能要么没有必要，要么你还没理解需要解决的问题。

---

## 为什么技能需要 TDD

Agent 的行为是概率性的。一个写得不好的技能会：
- 被 Agent 忽略（太长、太模糊）
- 被 Agent 选择性执行（只执行容易的部分）
- 与 Agent 默认行为重叠（浪费 context）
- 在特定情况下反而让 Agent 行为更差（过度约束）

只有先观察"没有技能时的失败模式"，才能写出真正解决问题的技能。

---

## 技能 TDD 协议（4步）

### Step 1：记录失败场景（红）

在写任何 SKILL.md 之前，运行以下测试：

```
场景：给 Agent 相同的任务，但不提供新技能
观察：Agent 会做什么？哪里会出错？
记录：把失败的具体行为逐字记录下来
```

失败场景模板（保存为 `skills/<name>/failure-evidence.md`）：

```markdown
# 失败场景记录 — <技能名>

## 测试日期
{date}

## 测试任务
给 Agent 以下指令，不提供新技能：
"{具体任务描述}"

## 观察到的失败行为
1. Agent 做了 {X}，但应该做 {Y}
2. Agent 跳过了 {步骤}，导致 {结果}
3. Agent 产出了 {错误的产出物}，因为缺少 {约束}

## 失败的严重程度
- [ ] 严重（导致下游阻塞）
- [ ] 中等（质量下降但可补救）
- [ ] 轻微（最佳实践偏差）

## 结论：这个技能是否有必要？
{是/否，以及理由}
```

---

### Step 2：定义成功标准（什么叫"技能有效"）

```markdown
## 成功标准

技能有效的判定条件（全部满足才算有效）：
- [ ] Agent 在 {触发条件} 时会自动加载此技能（不需要用户提示）
- [ ] Agent 执行技能中的 {关键步骤}，而不只是读一遍就继续
- [ ] 加载技能后，Step 1 中记录的失败行为不再出现
- [ ] 技能不会导致 Agent 在 {非适用场景} 时错误触发
```

---

### Step 3：写技能（绿）

技能文件格式规范：

```markdown
---
name: <skill-name>
description: >
  [一句话描述触发条件] Use when [具体场景].
  [不要写工作流摘要，不要写"此技能会做X"——那会让 Agent 读描述就跳过全文]
---

# <技能标题> — <副标题>

## ⚡ Iron Law（如果有的话）
[不可违反的单条规则，有且仅有一条最重要的]

## 禁止行为（可选）
[明确列出禁止做的事，比指令更有效]

## [主要流程/协议]
[具体的、可执行的步骤，用 bash 命令块而不是模糊描述]

## 接力
[完成后应该调用哪个技能，或通知哪个 Agent]
```

命名规则：
- 目录名：`kebab-case` 动名词（如 `systematic-debugging`, `writing-skills`）
- description 开头：用 `Use when...` 描述触发场景，不用 `This skill...`

---

### Step 4：验证（重跑失败场景）

```
给 Agent 相同的任务，这次提供新技能
检查：Step 1 中记录的失败行为是否还出现？
如果还出现：技能写得不够清晰，回到 Step 3
如果不出现：技能有效，可以合并
```

---

## 技能质量检查清单

在提交新技能之前，逐项检查：

- [ ] `failure-evidence.md` 存在，且有具体的失败记录
- [ ] `description` 字段用 `Use when` 开头，不是工作流摘要
- [ ] 关键步骤有具体的 bash 命令或可执行操作，不只是文字描述
- [ ] 有 `## 接力` 章节，明确下一步
- [ ] 技能长度适中（500-2000字）——太短没有约束力，太长 Agent 会跳读
- [ ] Iron Law 只有一条（多条 Iron Law = 没有 Iron Law）
- [ ] 已在不使用技能的情况下测试过失败场景

---

## 接力

新技能写完并验证后：
- 更新 `CLAUDE.md` 中的技能列表（如果面向用户）
- 在调用方 agent 文件中添加技能引用
- 运行 `node scripts/workflow.js install-global --force` 使技能全局可用
