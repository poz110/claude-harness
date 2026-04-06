# scripts/lib/

## config.js — Single Source of Truth (v11.0)

所有工作流常量的唯一定义位置。`workflow.js` 通过 `require('./lib/config.js')` 加载，不再内嵌任何常量。

### 导出内容

| 常量 | 说明 |
|------|------|
| `SCHEMA_VERSION` | 当前 schema 版本（`'11.0'`）|
| `STATES` | 13 个工作流状态定义 |
| `TRANSITIONS` | 状态转换规则 |
| `PREREQS` | 每个状态的前置文件要求 |
| `STALE_ARTIFACTS` | 回滚时自动清理的文件 |
| `CODE_OUTPUTS` | FE/BE 构建验证配置 |
| `ARTIFACT_STATE_MAP` | 文件 → 状态完成映射（Hook 使用）|
| `DANGEROUS_BASH_PATTERNS` | 危险命令拦截规则 |
| `DOC_VALIDATORS` | 8 种文档类型的验证规则 |
| `CONTEXT_BUDGET` | **[v11]** Context 生命周期管理配置 |
| `AGENT_TEAMS_CONFIG` | **[v11]** Agent Teams 双向通信配置 |
| `GLOBAL_INSTALL_CONFIG` | **[v11]** 框架全局化配置 |
| `FE_PATH_PREFIX` / `BE_PATH_PREFIX` | 并行进度检测路径前缀 |

### 版本历史

- v8.0 — 初始分离（只有基础常量）
- v11.0 — 统一版本号 + 新增 v11 三大配置模块

### 修改指南

修改此文件后不需要重启任何进程——`workflow.js` 每次执行都 `require` 最新版本。

测试方式：
```bash
node -e "const c = require('./scripts/lib/config.js'); console.log(c.SCHEMA_VERSION)"
# 输出: 11.0
```
