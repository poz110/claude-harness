---
name: env-check
description: >
  Universal environment checker. Detects missing tools, services, and
  configurations BEFORE starting any work phase. Always asks user before
  installing anything. Used by Designer (Stitch), FE, and BE agents.
  Modules: A = Stitch MCP (Designer), B = Backend env (BE), C = Frontend env (FE).
---

# 环境检测与引导配置

## 核心原则

**检测先行，询问再装，用户决定。**

任何工具或服务缺失时：
1. 检测 → 确认是否缺失
2. 询问 → 告诉用户缺什么，问是否需要配置
3. 引导 → 如果用户同意，提供具体安装命令并执行
4. 验证 → 安装后验证是否成功
5. 继续 → 验证通过后继续工作流

**永远不在没有明确用户同意的情况下自动安装任何东西。**

## 模块索引

| 模块 | 调用方 | 说明 | 跳转 |
|------|--------|------|------|
| 模块 A | Designer | Stitch MCP 检测与配置 | → [模块 A] |
| 模块 B | BE Agent | 后端环境检测（DB / Redis / 依赖）| → [模块 B] |
| 模块 C | FE Agent | 前端环境检测（依赖 / 设计稿 / API 客户端）| → [模块 C] |

**使用方式**：加载本 SKILL.md 后，只执行与调用方对应的模块，其他模块跳过。

---

任何工具或服务缺失时：
1. 检测 → 确认是否缺失
2. 询问 → 告诉用户缺什么，问是否需要配置
3. 引导 → 如果用户同意，提供具体安装命令并执行
4. 验证 → 安装后验证是否成功
5. 继续 → 验证通过后继续工作流

**永远不在没有明确用户同意的情况下自动安装任何东西。**

---

<!-- ═══ MODULE A START ═══ -->
## 模块 A：Stitch MCP 检测

由 Designer Agent 在 `/generate-stitch-designs` 前调用。

### 检测逻辑

```bash
# 检测 Stitch MCP 是否已配置
check_stitch_mcp() {
  # 方法 1：检查 claude mcp list 输出
  if claude mcp list 2>/dev/null | grep -qi "stitch"; then
    echo "CONFIGURED"
    return 0
  fi

  # 方法 2：检查 .mcp.json 配置文件
  if [ -f ".mcp.json" ] && grep -qi "stitch" .mcp.json 2>/dev/null; then
    echo "CONFIGURED"
    return 0
  fi

  # 方法 3：检查全局配置
  if [ -f "$HOME/.claude/mcp.json" ] && grep -qi "stitch" "$HOME/.claude/mcp.json" 2>/dev/null; then
    echo "CONFIGURED"
    return 0
  fi

  echo "NOT_CONFIGURED"
  return 1
}
```

### 询问流程

当检测到 `NOT_CONFIGURED` 时，**停止**并向用户展示以下内容：

```
## ⚙️ 需要你的决定：Stitch MCP 未配置

Stitch 是 Google 的 AI UI 设计工具，可以生成真实的 HTML 设计稿。
当前 Stitch MCP 未配置，有以下三个选择：

---

**选项 1：现在配置（推荐）**
   使用 API Key 方式，约 2 分钟，之后自动生成设计稿

   步骤：
   a. 前往 https://stitch.withgoogle.com → Settings → API Keys
   b. 复制 API Key
   c. 告诉我 API Key，我来完成配置

**选项 2：使用第三方代理（解决 OAuth bug）**
   需要 gcloud CLI 已安装，约 3 分钟

   命令：npx @_davideast/stitch-mcp init

**选项 3：跳过 Stitch，输出提示词文件**
   生成 design/stitch-prompts.md，你可以之后手动粘贴到 stitch.withgoogle.com
   设计阶段继续进行，但没有真实 HTML 设计稿

---

请回复：1、2、3 或直接粘贴你的 API Key
```

### 配置执行（用户选择 1 后）

```bash
# 用户提供 API Key 后执行
configure_stitch_api_key() {
  local api_key="$1"

  # 添加到 Claude Code
  claude mcp add stitch \
    --transport http \
    "https://stitch.googleapis.com/mcp" \
    --header "X-Goog-Api-Key: $api_key" \
    -s user

  # 验证配置
  if claude mcp list 2>/dev/null | grep -qi "stitch"; then
    echo "✅ Stitch MCP 配置成功"
    return 0
  else
    echo "❌ 配置失败，请检查 API Key 是否正确"
    return 1
  fi
}
```

### 配置执行（用户选择 2 后）

```bash
configure_stitch_proxy() {
  # 检查 npm/npx 是否可用
  if ! command -v npx &>/dev/null; then
    echo "❌ 需要先安装 Node.js 和 npm"
    return 1
  fi

  npx @_davideast/stitch-mcp init

  if [ $? -eq 0 ]; then
    echo "✅ Stitch MCP 代理配置成功"
  else
    echo "❌ 配置失败，请查看上方错误信息"
    return 1
  fi
}
```

---

## 模块 B：BE 开发环境检测

由 BE Agent 在开始实现之前调用。

### 检测清单

```bash
check_be_environment() {
  local issues=()
  local warnings=()

  # 1. 运行时检测
  echo "检测运行时..."
  if command -v bun &>/dev/null; then
    BUN_VERSION=$(bun --version)
    echo "  ✅ Bun $BUN_VERSION"
  elif command -v node &>/dev/null; then
    NODE_VERSION=$(node --version)
    echo "  ⚠️  Node.js $NODE_VERSION（推荐 Bun，但 Node 可用）"
    warnings+=("运行时：建议安装 Bun 以获得更好性能")
  else
    echo "  ❌ Bun/Node.js 未安装"
    issues+=("MISSING_RUNTIME:需要 Bun 或 Node.js")
  fi

  # 2. 数据库检测
  echo "检测数据库..."
  DB_URL="${DATABASE_URL:-}"

  if [ -z "$DB_URL" ]; then
    # 检查 .env 文件
    if [ -f ".env" ] && grep -q "DATABASE_URL" .env; then
      DB_URL=$(grep "DATABASE_URL" .env | cut -d= -f2-)
    elif [ -f ".env.local" ] && grep -q "DATABASE_URL" .env.local; then
      DB_URL=$(grep "DATABASE_URL" .env.local | cut -d= -f2-)
    fi
  fi

  if [ -z "$DB_URL" ]; then
    echo "  ❌ DATABASE_URL 未配置"
    issues+=("MISSING_DATABASE_URL:数据库连接未配置")
  else
    # 尝试连接（如果是 PostgreSQL）
    if echo "$DB_URL" | grep -q "postgresql\|postgres"; then
      if command -v psql &>/dev/null; then
        if psql "$DB_URL" -c "SELECT 1" &>/dev/null 2>&1; then
          echo "  ✅ PostgreSQL 可连接"
        else
          echo "  ❌ PostgreSQL 配置了但无法连接"
          issues+=("DB_CONNECTION_FAILED:数据库无法连接，请检查连接字符串和服务状态")
        fi
      else
        echo "  ⚠️  DATABASE_URL 已配置，但无法验证连接（psql 未安装）"
        warnings+=("建议安装 psql 以验证数据库连接")
      fi
    fi
  fi

  # 3. Redis 检测（如果 arch-decision.md 提到需要）
  if [ -f "docs/arch-decision.md" ] && grep -qi "redis\|bullmq\|upstash" docs/arch-decision.md; then
    echo "检测 Redis..."
    REDIS_URL="${REDIS_URL:-}"
    if [ -z "$REDIS_URL" ]; then
      if [ -f ".env" ] && grep -q "REDIS_URL" .env; then
        REDIS_URL=$(grep "REDIS_URL" .env | cut -d= -f2-)
      fi
    fi

    if [ -z "$REDIS_URL" ]; then
      echo "  ❌ REDIS_URL 未配置（架构要求 Redis）"
      issues+=("MISSING_REDIS_URL:架构需要 Redis，但 REDIS_URL 未配置")
    else
      echo "  ✅ REDIS_URL 已配置"
    fi
  fi

  # 4. .env 文件检测
  echo "检测环境变量..."
  if [ ! -f ".env" ] && [ ! -f ".env.local" ]; then
    echo "  ❌ 未找到 .env 文件"
    issues+=("MISSING_ENV_FILE:.env 文件不存在")
  elif [ -f ".env.example" ]; then
    # 检查 .env.example 中的必填项是否都配置了
    MISSING_VARS=()
    while IFS= read -r line; do
      # 跳过注释和空行
      [[ "$line" =~ ^#.*$ || -z "$line" ]] && continue
      VAR_NAME=$(echo "$line" | cut -d= -f1)
      # 检查变量是否在 .env 中有值
      if [ -f ".env" ]; then
        VAR_VALUE=$(grep "^${VAR_NAME}=" .env | cut -d= -f2-)
        if [ -z "$VAR_VALUE" ]; then
          MISSING_VARS+=("$VAR_NAME")
        fi
      fi
    done < .env.example

    if [ ${#MISSING_VARS[@]} -gt 0 ]; then
      echo "  ⚠️  以下变量未配置：${MISSING_VARS[*]}"
      warnings+=("ENV_VARS_MISSING:${MISSING_VARS[*]}")
    else
      echo "  ✅ 环境变量完整"
    fi
  fi

  # 5. 依赖安装检测
  echo "检测依赖..."
  # 支持 monorepo（apps/server） + 单仓库（根目录 / server/）
  BE_PKG=$(find . -maxdepth 3 -name "package.json" \
    \( -path "*/apps/server/package.json" -o -path "*/server/package.json" -o -path "*/backend/package.json" -o -path "./server/package.json" -o -path "./backend/package.json" \) \
    -not -path "*/node_modules/*" 2>/dev/null | head -1)
  if [ -n "$BE_PKG" ]; then
    BE_DIR=$(dirname "$BE_PKG")
    if [ ! -d "${BE_DIR}/node_modules" ]; then
      echo "  ❌ 后端依赖未安装（${BE_DIR}/）"
      issues+=("DEPS_NOT_INSTALLED:${BE_DIR}/node_modules 不存在")
    else
      echo "  ✅ 后端依赖已安装（${BE_DIR}/）"
    fi
  else
    echo "  ⚠️  未检测到后端 package.json（单仓库或无独立后端）"
  fi

  # 汇总结果
  echo ""
  echo "检测完成"
  echo "❌ 阻塞问题：${#issues[@]} 个"
  echo "⚠️  建议修复：${#warnings[@]} 个"

  # 返回问题列表（供询问流程使用）
  printf '%s\n' "${issues[@]}"
}
```

### BE 环境询问模板

当检测到问题时，停止并向用户展示：

```
## ⚙️ 需要你的决定：开发环境有 {N} 个问题

在开始实现之前，发现以下环境问题：

---

{如果 MISSING_RUNTIME}
**问题 1：未找到 Bun / Node.js**
Bun 是推荐的运行时（比 Node.js 快 3-4x）

选项：
  A) 安装 Bun（推荐）：curl -fsSL https://bun.sh/install | bash
  B) 使用系统已有的 Node.js（如果有的话）
  C) 告诉我你希望用什么运行时

{如果 MISSING_DATABASE_URL}
**问题 {N}：数据库未配置**
架构决策要求 PostgreSQL 16+

选项：
  A) 本地 Docker 快速启动（推荐开发环境）：
     docker run -d --name postgres \
       -e POSTGRES_PASSWORD=devpassword \
       -e POSTGRES_DB=myapp \
       -p 5432:5432 postgres:16
     DATABASE_URL=postgresql://postgres:devpassword@localhost:5432/myapp

  B) 使用云数据库（Neon/Supabase）：告诉我你的连接字符串
  C) 跳过数据库，先实现不需要 DB 的部分

{如果 MISSING_REDIS_URL}
**问题 {N}：Redis 未配置**
架构决策要求 Redis（用于 BullMQ 队列/缓存）

选项：
  A) 本地 Docker 启动：
     docker run -d --name redis -p 6379:6379 redis:7
     REDIS_URL=redis://localhost:6379

  B) 使用 Upstash（免费云 Redis）：https://upstash.com
  C) 跳过 Redis 相关功能，先实现其他部分

{如果 DEPS_NOT_INSTALLED}
**问题 {N}：依赖未安装**
需要运行 bun install / npm install

选项：
  A) 现在自动安装（推荐）
  B) 我手动安装后告诉你

---

请回复每个问题选择的选项（如：1-A, 2-B, 3-A）
或直接说"全部自动处理"让我帮你完成所有配置
```

### BE 自动处理逻辑

```bash
# 如果用户说"全部自动处理"或指定了选项

# 安装 Bun（如果选 A）
install_bun() {
  echo "正在安装 Bun..."
  curl -fsSL https://bun.sh/install | bash
  export PATH="$HOME/.bun/bin:$PATH"
  bun --version && echo "✅ Bun 安装成功" || echo "❌ 安装失败"
}

# 启动本地 PostgreSQL（如果选 A）
start_local_postgres() {
  if ! command -v docker &>/dev/null; then
    echo "❌ Docker 未安装，请先安装 Docker Desktop"
    echo "   下载：https://www.docker.com/products/docker-desktop"
    return 1
  fi

  docker run -d --name postgres-dev \
    -e POSTGRES_PASSWORD=devpassword \
    -e POSTGRES_DB=myapp_dev \
    -p 5432:5432 \
    postgres:16-alpine \
    2>/dev/null || docker start postgres-dev 2>/dev/null

  sleep 3  # 等待启动

  # 写入 .env
  if ! grep -q "DATABASE_URL" .env 2>/dev/null; then
    echo 'DATABASE_URL=postgresql://postgres:devpassword@localhost:5432/myapp_dev' >> .env
    echo "✅ DATABASE_URL 已写入 .env"
  fi

  # 运行 migration
  if [ -n "$BE_DIR" ] && [ -f "${BE_DIR}/package.json" ]; then
    cd "$BE_DIR"
    bun run db:push 2>/dev/null || \
    bun run drizzle-kit push 2>/dev/null || \
    echo "⚠️  请手动运行数据库迁移"
    cd ../..
  fi
}

# 启动本地 Redis（如果选 A）
start_local_redis() {
  if ! command -v docker &>/dev/null; then
    echo "❌ Docker 未安装"
    return 1
  fi

  docker run -d --name redis-dev \
    -p 6379:6379 \
    redis:7-alpine \
    2>/dev/null || docker start redis-dev 2>/dev/null

  if ! grep -q "REDIS_URL" .env 2>/dev/null; then
    echo 'REDIS_URL=redis://localhost:6379' >> .env
    echo "✅ REDIS_URL 已写入 .env"
  fi
}

# 安装依赖
install_deps() {
  _target_dir="${BE_DIR:-apps/server}"
  cd "$_target_dir"
  echo "正在安装依赖: $_target_dir/"
  if command -v bun &>/dev/null; then
    bun install && echo "✅ 依赖安装成功（bun）"
  else
    npm install && echo "✅ 依赖安装成功（npm）"
  fi
  cd ../..
}
```

---

## 模块 C：FE 开发环境检测

由 FE Agent 在开始实现之前调用。

### 检测清单

```bash
check_fe_environment() {
  local issues=()

  # 1. Node.js / Bun
  echo "检测运行时..."
  if command -v bun &>/dev/null; then
    echo "  ✅ Bun $(bun --version)"
  elif command -v node &>/dev/null; then
    NODE_VER=$(node -e "process.exit(parseInt(process.version.slice(1)) < 18 ? 1 : 0)" 2>/dev/null)
    if [ $? -eq 0 ]; then
      echo "  ✅ Node.js $(node --version)"
    else
      echo "  ❌ Node.js 版本过低（需要 18+）"
      issues+=("NODE_VERSION_LOW:Node.js 版本需要 18 以上")
    fi
  else
    echo "  ❌ Node.js / Bun 未安装"
    issues+=("MISSING_RUNTIME:需要 Node.js 18+ 或 Bun")
  fi

  # 2. FE 依赖
  echo "检测前端依赖..."
  # 支持 monorepo（apps/web）+ 单仓库（根目录 / client/ / frontend/）
  FE_PKG=$(find . -maxdepth 3 -name "package.json" \
    \( -path "*/apps/web/package.json" -o -path "*/client/package.json" -o -path "*/frontend/package.json" \
       -o -path "./package.json" -o -path "./client/package.json" -o -path "./frontend/package.json" \) \
    -not -path "*/node_modules/*" 2>/dev/null | head -1)
  if [ -n "$FE_PKG" ]; then
    FE_DIR=$(dirname "$FE_PKG")
    if [ ! -d "${FE_DIR}/node_modules" ]; then
      echo "  ❌ 前端依赖未安装（${FE_DIR}/）"
      issues+=("FE_DEPS_MISSING:${FE_DIR}/node_modules 不存在")
    else
      echo "  ✅ 前端依赖已安装（${FE_DIR}/）"
    fi
  else
    echo "  ⚠️  未检测到前端 package.json"
  fi

  # 3. 设计稿检测
  echo "检测设计稿..."
  if [ -d "design" ] && [ -f "design/index.html" ]; then
    SCREEN_COUNT=$(find design -name "desktop.html" | wc -l)
    echo "  ✅ 设计稿已就绪（${SCREEN_COUNT} 个页面）"
  elif [ -f "design/stitch-prompts.md" ]; then
    echo "  ⚠️  仅有 Stitch 提示词，无真实设计稿"
    issues+=("NO_DESIGN_SCREENS:design/ 目录只有提示词，建议先配置 Stitch MCP 生成真实设计稿")
  elif [ -f "docs/design-spec.md" ]; then
    echo "  ⚠️  只有文字规范，无设计稿（将基于规范实现）"
  else
    echo "  ❌ 既无设计稿也无设计规范"
    issues+=("NO_DESIGN_AT_ALL:设计阶段产出物缺失，无法开始实现")
  fi

  # 4. 环境变量（NEXT_PUBLIC_* 等）
  echo "检测前端环境变量..."
  NEXT_PUBLIC_MISSING=()
  if [ -f ".env.example" ]; then
    while IFS= read -r line; do
      [[ "$line" =~ ^#.*$ || -z "$line" ]] && continue
      VAR=$(echo "$line" | cut -d= -f1)
      if [[ "$VAR" == NEXT_PUBLIC_* ]]; then
        VAL=$(grep "^${VAR}=" .env 2>/dev/null | cut -d= -f2-)
        [ -z "$VAL" ] && NEXT_PUBLIC_MISSING+=("$VAR")
      fi
    done < .env.example
  fi
  if [ ${#NEXT_PUBLIC_MISSING[@]} -gt 0 ]; then
    echo "  ⚠️  缺少公共环境变量：${NEXT_PUBLIC_MISSING[*]}"
    issues+=("NEXT_PUBLIC_VARS_MISSING:${NEXT_PUBLIC_MISSING[*]}")
  fi

  # 5. API 地址配置
  if [ -f "docs/arch-decision.md" ] && grep -qi "trpc\|api" docs/arch-decision.md; then
    echo "检测 API 连接配置..."
    # 支持 monorepo + 单仓库多种路径模式
    API_CLIENT=$(find . -maxdepth 5 \
      \( -path "*/lib/trpc.ts" -o -path "*/lib/trpc/client.ts" \
         -o -path "*/lib/api.ts" -o -path "*/utils/request.ts" \
         -o -path "*/utils/http.ts" -o -path "*/utils/api.ts" \
         -o -path "*/services/index.ts" -o -path "*/api/index.ts" \
         -o -path "*/src/lib/trpc.ts" -o -path "*/src/utils/request.ts" \
         -o -path "*/src/api.ts" \) \
      -not -path "*/node_modules/*" 2>/dev/null | head -1)
    if [ -n "$API_CLIENT" ]; then
      echo "  ✅ API 客户端已配置（${API_CLIENT}）"
    else
      echo "  ⚠️  API 客户端路径不在预设列表中，手动确认"
      echo "  （单仓库或使用非标准路径的项目跳过此检查）"
    fi
  fi

  printf '%s\n' "${issues[@]}"
}
```

### FE 环境询问模板

```
## ⚙️ 需要你的决定：前端环境有 {N} 个问题

{如果 FE_DEPS_MISSING}
**问题 {N}：前端依赖未安装**

选项：
  A) 现在自动安装（推荐）
     bun install（或 npm install）
  B) 我手动安装后告诉你

{如果 NO_DESIGN_SCREENS（只有 stitch-prompts.md）}
**问题 {N}：没有真实 HTML 设计稿**
发现 design/stitch-prompts.md，但没有真实的 HTML 设计稿文件。

选项：
  A) 现在配置 Stitch MCP 并生成设计稿（推荐）
     我来引导你完成 Stitch 配置，然后自动生成
  B) 使用 stitch-prompts.md 中的提示词手动生成
     前往 https://stitch.withgoogle.com，粘贴提示词，
     把生成的 HTML 下载后放入 design/{page}/desktop.html
  C) 跳过设计稿，直接基于 docs/design-spec.md 实现
     注意：没有设计稿时视觉对比功能不可用

{如果 NEXT_PUBLIC_VARS_MISSING}
**问题 {N}：缺少前端公共环境变量**
缺少：{变量名列表}

选项：
  A) 告诉我每个变量的值，我来写入 .env
  B) 我手动编辑 .env 文件
  C) 先跳过，实现不依赖这些变量的部分

---
请回复每个问题的选择，或直接说"帮我处理"
```

---

## 模块 D：通用工具检测

适用于任何 Agent 遇到工具缺失时。

### 检测函数

```bash
check_tool() {
  local tool="$1"
  local install_hint="$2"

  if command -v "$tool" &>/dev/null; then
    echo "✅ $tool 已安装（$(which $tool)）"
    return 0
  else
    echo "❌ $tool 未找到"
    echo ""
    echo "需要安装 $tool 才能继续。"
    echo "$install_hint"
    echo ""
    echo "是否现在安装？（是/否/手动安装后告诉我）"
    return 1
  fi
}

# 使用示例
check_tool "docker" "安装 Docker Desktop：https://www.docker.com/products/docker-desktop"
check_tool "psql" "安装 PostgreSQL 客户端：brew install postgresql 或 apt install postgresql-client"
check_tool "playwright" "安装：bunx playwright install"
```

### 询问标准格式

所有环境询问都遵循此格式：

```
## ⚙️ 缺少 {工具名}

**原因**：{为什么需要这个工具}
**影响**：{如果不装，哪些功能无法进行}

**安装选项**：
  A) 自动安装：{具体命令}
  B) 手动安装：{文档链接或步骤}
  C) 跳过：{跳过后的影响说明}

请回复 A、B 或 C
```

---

## 执行后必须做的事

无论环境检测结果如何，在向用户报告时：

1. **清晰列出** 阻塞问题（必须解决才能继续）和 警告问题（可以跳过）
2. **给出明确选项**，不让用户猜测该怎么做
3. **用户选择后立即执行**，执行后打印结果
4. **所有安装记录到** `state/agent-log.jsonl`：
   ```bash
   node scripts/workflow.js log-agent \
     '{"agent":"env-check","action":"install_postgres","status":"OK","note":"docker local"}'
   ```
5. **验证安装成功**后才继续工作流

---

## 接力

环境检测完成后：
- **全部 ✅** → 返回调用方（env-check 是前置步骤，完成后继续调用者主流程）
- **有 ❌** → 停止，解决依赖后重跑本检测，通过后才能继续
