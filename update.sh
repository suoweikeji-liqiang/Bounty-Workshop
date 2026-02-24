#!/bin/bash
# Bounty Workshop 自动化升级脚本
# 该脚本需要以 root 权限运行

set -e

# 配置项
APP_DIR="/opt/bounty-workshop"

echo "============================================="
echo "开始升级 Bounty Workshop 代码及服务..."
echo "============================================="

if [ "$EUID" -ne 0 ]; then
  echo "请使用 root 权限运行此脚本 (例如: sudo ./update.sh)"
  exit 1
fi

echo "1. 拉取最新代码..."
cd ${APP_DIR}
sudo -u $SUDO_USER git pull

echo "2. 更新后端依赖..."
sudo -u $SUDO_USER bash -c "source .venv/bin/activate && python -m pip install -e .[dev]"

echo "3. 重新编译前端代码..."
cd ${APP_DIR}/web
sudo -u $SUDO_USER npm ci
sudo -u $SUDO_USER VITE_API_BASE_URL=/api npm run build

echo "4. 重启相关服务..."
systemctl restart bounty-workshop
systemctl reload nginx

echo "============================================="
echo "✅ 升级完成！"
echo "服务已重启，请检查服务状态: systemctl status bounty-workshop"
echo "============================================="
