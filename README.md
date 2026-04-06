# claude-harness

基于 Claude Code 的多 Agent 协作开发工作流系统

## 特性

- **12 个专职 Agent** - PM、架构师、设计师、全栈工程师、评审、QA、安全、DevOps 等
- **14 状态流水线** - 想法 → PRD → 架构 → 设计 → 实现 → QA → 安全 → 部署
- **Autopilot 模式** - 全自动工作流，说出需求即可
- **Slash 命令** - `/autopilot`、`/generate-prd`、`/implement-feature` 等

## 安装

```bash
claude plugin marketplace add poz110/claude-harness
claude plugin install claude-harness
```

## 使用

```bash
# 全自动流程
/autopilot 构建一个博客系统，支持用户注册登录

# 单个命令
/generate-prd           # 生成产品需求文档
/generate-design        # 创建设计系统
/implement-feature      # 实现功能
/arch-review            # 架构评审
/code-review-arch       # 代码审查
/qa                     # QA 测试
/owasp-scan             # 安全扫描
/hotfix <问题>         # 紧急修复
```

## 工作流状态

| 状态 | 描述 |
|------|------|
| `IDEA` | 初始想法，PM 生成 PRD |
| `PRD_DRAFT` | PRD 已生成，等待审核 |
| `PRD_REVIEW` | 架构师审核中 |
| `ARCH_REVIEW` | ADR 完成，设计师工作中 |
| `CEO_REVIEW` | CEO 审核 UX 逻辑 |
| `DESIGN_PHASE` | 设计完成，等待审核 |
| `DESIGN_REVIEW` | 全栈工程师实现中 |
| `IMPLEMENTATION` | 实现中，评审审计中 |
| `CODE_REVIEW` | 代码评审完成，QA 测试中 |
| `QA_PHASE` | QA 完成，等待审核 |
| `SECURITY_REVIEW` | 安全审计中 |
| `DEPLOY_PREP_SETUP` | DevOps 准备部署中 |
| `DEPLOY_PREP` | 部署就绪，等待确认 |
| `DONE` | 完成 |

## 环境要求

- Node.js >= 18.0.0
- Claude Code 最新版

## License

MIT © Snow.Li
