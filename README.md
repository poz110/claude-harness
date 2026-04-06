# claude-harness

基于 Claude Code 的多 Agent 协作开发工作流系统

## 特性

- **12 个专职 Agent** - PM、架构师、设计师、全栈工程师、评审、QA、安全、DevOps 等
- **Slash 命令** - `/autopilot`、`/generate-prd`
- **PRD 生成** - 说出需求，自动生成产品需求文档

## 安装

```bash
claude plugin marketplace add poz110/claude-harness
claude plugin install claude-harness
```

## 使用

```bash
# 自动生成 PRD
/autopilot 构建一个博客系统，支持用户注册登录

# 或者手动触发
/generate-prd
```

## 可用命令

| 命令 | 描述 |
|------|------|
| `/autopilot <需求>` | 说出需求，自动生成 PRD |
| `/generate-prd` | 生成产品需求文档 |

## License

MIT © Snow.Li
