#!/bin/bash
# M9 Quiz App - Deploy to Render Guide
# 使用方法：
#   1. 在 GitHub 上创建新仓库（见下方步骤）
#   2. 运行：bash deploy.sh

echo "========================================="
echo "  M9 英语题库 - Render 部署脚本"
echo "========================================="
echo ""
echo "📋 部署前准备步骤："
echo ""
echo "Step 1: 创建 GitHub 仓库"
echo "  1. 访问 https://github.com/new"
echo "  2. 仓库名输入：m9-quiz"
echo "  3. 选择 Public（公开）"
echo "  4. 不要勾选 'Initialize this repository'"
echo "  5. 点击 'Create repository'"
echo ""
echo "Step 2: 获取 GitHub Token"
echo "  1. 访问 https://github.com/settings/tokens/new"
echo "  2. Note 输入：render-deploy"
echo "  3. Expiration 选择：90 days"
echo "  4. 勾选 repo 权限（全部）"
echo "  5. 点击 'Generate token'"
echo "  6. 复制生成的 token（以 ghp_ 开头）"
echo ""

read -p "📝 请输入你的 GitHub 用户名: " GH_USER
read -p "📝 请输入你的 GitHub 仓库名 (默认: m9-quiz): " GH_REPO
GH_REPO=${GH_REPO:-m9-quiz}
read -sp "🔑 请输入你的 GitHub Personal Access Token (ghp_xxx): " GH_TOKEN
echo ""

if [ -z "$GH_TOKEN" ]; then
  echo "❌ Token 不能为空"
  exit 1
fi

echo ""
echo "🚀 开始推送代码到 GitHub..."

cd "$(dirname "$0")"

# Configure git
git config user.email "deploy@m9quiz.com" 2>/dev/null
git config user.name "M9 Quiz Deploy" 2>/dev/null

# Add remote and push
git remote remove origin 2>/dev/null
git remote add origin https://${GH_USER}:${GH_TOKEN}@github.com/${GH_USER}/${GH_REPO}.git

echo "  → 推送到 origin/main..."
git branch -M main 2>/dev/null || git checkout -B main 2>/dev/null
git push -f origin main 2>&1

if [ $? -eq 0 ]; then
  echo ""
  echo "✅ 代码已成功推送到 GitHub!"
  echo "   → https://github.com/${GH_USER}/${GH_REPO}"
  echo ""
  echo "🎯 下一步：部署到 Render"
  echo "  1. 访问 https://render.com/deploy"
  echo "  2. 选择 'Deploy a Web Service'"
  echo "  3. 连接你的 GitHub 账号"
  echo "  4. 选择 ${GH_REPO} 仓库"
  echo "  5. 使用以下配置："
  echo "     - Runtime: Python 3"
  echo "     - Build Command: pip install -r requirements.txt"
  echo "     - Start Command: uvicorn server:app --host 0.0.0.0 --port \$PORT"
  echo ""
  echo "  6. 点击 'Create Web Service'"
  echo ""
  echo "🎉 部署完成后，你的应用将运行在："
  echo "   https://${GH_REPO}.onrender.com"
else
  echo ""
  echo "❌ 推送失败，请检查："
  echo "  - GitHub 用户名是否正确"
  echo "  - 仓库名是否正确"
  echo "  - Token 是否有效（需要 repo 权限）"
  echo "  - 仓库是否已创建"
fi
