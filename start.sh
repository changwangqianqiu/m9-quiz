#!/bin/bash
# M9 答题系统 - 一键启动脚本
# 用法: bash /workspace/quiz-app/start.sh

cd /workspace/quiz-app

echo "🔍 检查端口 8000..."
# 如果端口已被占用，先释放
lsof -ti:8000 | xargs kill -9 2>/dev/null
sleep 1

echo "🚀 启动服务器..."
nohup python3 -m uvicorn server:app --host 0.0.0.0 --port 8000 > /tmp/quiz-server.log 2>&1 &
sleep 2

# 检查是否启动成功
if lsof -i:8000 | grep -q LISTEN; then
    echo ""
    echo "✅ 服务器启动成功！"
    echo "📡 访问地址: http://localhost:8000"
    echo ""
else
    echo "❌ 启动失败，查看日志: tail -20 /tmp/quiz-server.log"
fi
