#!/bin/bash
# setup-stitch.sh — Google Stitch MCP 一键配置
#
# 用法：bash scripts/setup-stitch.sh

set -e

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║    Google Stitch MCP 配置向导             ║"
echo "╚══════════════════════════════════════════╝"
echo ""
echo "Stitch 是 Google 的 AI UI 设计工具，通过 MCP 接入后"
echo "Designer Agent 可以自动生成真实的 HTML 设计稿。"
echo ""

# 检查 Claude Code 是否安装
if ! command -v claude &> /dev/null; then
  echo "❌ 未找到 claude 命令，请先安装 Claude Code："
  echo "   npm install -g @anthropic-ai/claude-code"
  exit 1
fi

echo "选择配置方式："
echo ""
echo "  1) API Key 方式（推荐，最简单）"
echo "     需要：Stitch API Key"
echo "     获取：https://stitch.withgoogle.com → Settings → API Keys"
echo ""
echo "  2) 第三方代理方式（解决 OAuth bug，自动 token 续期）"
echo "     需要：Google Cloud 项目 + gcloud CLI"
echo ""
echo "  3) 跳过（之后手动配置）"
echo ""
read -p "请输入选择 [1/2/3]: " choice

case $choice in
  1)
    echo ""
    read -p "请粘贴你的 Stitch API Key: " api_key
    if [ -z "$api_key" ]; then
      echo "❌ API Key 不能为空"
      exit 1
    fi

    claude mcp add stitch \
      --transport http \
      "https://stitch.googleapis.com/mcp" \
      --header "X-Goog-Api-Key: $api_key" \
      -s user

    echo ""
    echo "✅ Stitch MCP 已配置（API Key 方式）"
    ;;

  2)
    echo ""
    echo "正在安装 @_davideast/stitch-mcp..."
    npx @_davideast/stitch-mcp init

    echo ""
    echo "✅ Stitch MCP 已配置（代理方式）"
    ;;

  3)
    echo ""
    echo "跳过配置。你可以之后运行："
    echo "  bash scripts/setup-stitch.sh"
    echo "或手动参考 design/README.md 进行配置。"
    exit 0
    ;;

  *)
    echo "无效选择"
    exit 1
    ;;
esac

echo ""
echo "═══════════════════════════════════════════"
echo "验证配置..."
echo ""

# 简单验证
claude mcp list 2>/dev/null | grep -q "stitch" && \
  echo "✅ stitch 已出现在 MCP 服务器列表" || \
  echo "⚠️  请检查配置是否正确"

echo ""
echo "下一步："
echo "  在 Claude Code 中运行：/generate-stitch-designs"
echo "  Designer Agent 将自动调用 Stitch 生成设计稿到 design/ 目录"
echo ""
