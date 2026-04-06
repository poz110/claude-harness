---
name: autopilot
description: "全自动模式：直接派发 PM Agent 生成 PRD，自动推进整个开发流程"
---

# Autopilot — 全流程自动驾驶

## 用法

```
/autopilot <需求描述>
```

## 触发条件

用户说：
- "/autopilot <需求描述>"
- "全自动"
- "自动完成"
- "从头到尾"

## 执行流程

### Step 1: 派发 PM Agent 生成 PRD

```
Agent: pm

Prompt:
"
你是 Product Manager，负责生成产品需求文档。

用户需求：{用户输入的需求描述}

请生成 docs/prd.md，包含：
1. 项目概述和目标
2. 用户故事和功能需求（Must/Should/Could）
3. 技术约束和假设
4. MVP 范围定义
5. 验收标准

输出文件：docs/prd.md

完成后，告诉用户 PRD 已生成，可以继续下一步。
"
```

### Step 2: 派发 Architect Agent 生成 ADR

```
Agent: architect

Prompt:
"
你是 Software Architect，负责架构决策。

前置：Read docs/prd.md

请生成以下文档：
1. docs/arch-decision.md — 包含架构图（数据流、组件图）
2. docs/security-baseline.md — 安全需求
3. docs/traceability-matrix.md — 需求追溯矩阵

完成后，告诉用户架构已完成。
"
```

### Step 3: 派发 Designer Agent 生成设计

```
Agent: designer

Prompt:
"
你是 UX Designer，负责设计系统。

前置：Read docs/prd.md, docs/arch-decision.md

请生成：
1. DESIGN.md — 设计系统（颜色、字体、间距等）
2. docs/design-spec.md — 设计规格说明

完成后，告诉用户设计已完成。
"
```

### Step 4: 派发 FullStack Agent 实现

```
Agent: fullstack

Prompt:
"
你是 Full-Stack Engineer，负责实现。

前置：Read docs/prd.md, docs/arch-decision.md, docs/design-spec.md

请实现：
1. docs/api-spec.md — API 规格
2. apps/web/ — 前端代码
3. apps/server/ — 后端代码

完成后，告诉用户代码已实现。
"
```

### Step 5: 派发 Reviewer Agent 代码审查

```
Agent: reviewer

Prompt:
"
你是 Code Reviewer，负责代码审查。

前置：Read docs/api-spec.md, apps/web/, apps/server/

请执行：
1. 构建验证：npm run build
2. 类型检查：npx tsc --noEmit
3. 生成 docs/code-review.md

如果发现问题，详细列出并要求修复。
"
```

### Step 6: 派发 QA Agent 测试

```
Agent: qa

Prompt:
"
你是 QA Engineer，负责测试。

前置：Read docs/traceability-matrix.md, docs/api-spec.md

请执行：
1. 编写测试计划
2. 执行单元测试和 E2E 测试
3. 生成 docs/test-report.md

如果发现 P0/P1 bug，报告给用户。
"
```

### Step 7: 派发 Security Auditor

```
Agent: security-auditor

Prompt:
"
你是 Security Auditor，负责安全审计。

前置：Read docs/security-baseline.md

请执行 OWASP Top 10 安全扫描，生成 docs/security-report.md。

如果发现 Critical/High 漏洞，详细说明。
"
```

### Step 8: 派发 DevOps Agent 部署

```
Agent: devops

Prompt:
"
你是 DevOps Engineer，负责部署配置。

前置：Read docs/prd.md, docs/arch-decision.md

请生成：
1. docs/deploy-plan.md — 部署计划
2. docs/runbook.md — 运维手册
3. Dockerfile
4. .github/workflows/deploy.yml

完成后，告诉用户可以部署了。
"
```

### 完成

```
🎉 全流程完成！

产出物：
- docs/prd.md
- docs/arch-decision.md
- docs/security-baseline.md
- docs/traceability-matrix.md
- DESIGN.md
- docs/design-spec.md
- docs/api-spec.md
- docs/code-review.md
- docs/test-report.md
- docs/security-report.md
- docs/deploy-plan.md
- docs/runbook.md
- apps/web/ (前端代码)
- apps/server/ (后端代码)
```

---

## 错误处理

| 异常 | 处理 |
|------|------|
| PRD 失败 | 报告给用户，重新生成 |
| 架构问题 | 报告给用户，修复后继续 |
| 实现失败 | 详细列出问题，要求修复 |
| Code Review FAIL | 要求修复后重新审查 |
| QA 发现 P0/P1 bug | 要求修复后重新测试 |
| Security Critical | 要求修复后重新审计 |

---

## 禁止行为

- 不跳过任何必要阶段
- 不在失败时继续推进
- 不忽略 Critical/High 安全漏洞
