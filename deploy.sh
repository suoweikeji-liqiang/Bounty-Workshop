#!/bin/bash
# Bounty Workshop 自动化部署脚本 (Ubuntu 22.04/24.04)
# 该脚本需要以 root 权限运行

set -e

# 配置项
APP_DIR="/Volume1/data/bounty-workshop"
REPO_URL="https://github.com/suoweikeji-liqiang/Bounty-Workshop.git"
DOMAIN="192.168.1.144"
FRONTEND_PORT="81"
BACKEND_PORT="8000"
APP_USER="www-data"

echo "============================================="
echo "开始部署 Bounty Workshop (要求 Ubuntu 系统)..."
echo "============================================="

if [ "$EUID" -ne 0 ]; then
  echo "请使用 root 权限运行此脚本 (例如: sudo ./deploy.sh)"
  exit 1
fi

echo "0. 检查端口占用情况..."
function check_port_in_use {
    local port=$1
    if ss -ltn | grep -q ":$port "; then
        echo "错误: 端口 $port 已经被占用，无法继续部署。请修改配置项中的端口或停止占用该端口的服务。"
        exit 1
    fi
}
check_port_in_use ${FRONTEND_PORT}
check_port_in_use ${BACKEND_PORT}
echo "端口检查通过。"

echo "1. 安装基础依赖..."
apt update
apt install -y git python3.11 python3.11-venv python3-pip nginx curl

echo "2. 安装 Node.js 20 LTS..."
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs
node -v
npm -v

echo "3. 准备应用目录与拉取代码..."
mkdir -p ${APP_DIR}
chown -R $SUDO_USER:$SUDO_USER ${APP_DIR}
cd ${APP_DIR}
if [ ! -d ".git" ]; then
    sudo -u $SUDO_USER git clone ${REPO_URL} .
else
    echo "代码库已存在，拉取最新代码..."
    sudo -u $SUDO_USER git pull
fi

echo "4. 配置后端环境并安装依赖..."
sudo -u $SUDO_USER python3.11 -m venv .venv
sudo -u $SUDO_USER bash -c "source .venv/bin/activate && python -m pip install --upgrade pip"
sudo -u $SUDO_USER bash -c "source .venv/bin/activate && python -m pip install -e .[dev]"

echo "5. 生成环境变量配置文件..."
cat > /etc/bounty-workshop.env <<EOF
# ===== 基础 =====
APP_DB_PATH=${APP_DIR}/data/app.db
ATTACHMENT_STORAGE_DIR=${APP_DIR}/data/storage

# 前端域名（根据实际修改）
CORS_ALLOW_ORIGINS=https://${DOMAIN},http://${DOMAIN}

# 认证（建议修改）
AUTH_TOKEN_SECRET=$(openssl rand -hex 32)
AUTH_TOKEN_TTL_MINUTES=1440

# 定时任务
ENABLE_BACKGROUND_JOBS=true
ENABLE_FEISHU_SYNC_JOB=true

# 限流
RATE_LIMIT_ENABLED=true
RATE_LIMIT_TASK_CLAIM_LIMIT=30
RATE_LIMIT_TASK_CLAIM_WINDOW_SECONDS=60
RATE_LIMIT_DELIVERABLE_SUBMIT_LIMIT=20
RATE_LIMIT_DELIVERABLE_SUBMIT_WINDOW_SECONDS=60

# 飞书（模拟模式）
FEISHU_PROVIDER=mock
EOF
chmod 600 /etc/bounty-workshop.env

echo "6. 配置 Systemd 托管服务..."
cat > /etc/systemd/system/bounty-workshop.service <<EOF
[Unit]
Description=Bounty Workshop FastAPI
After=network.target

[Service]
Type=simple
User=${APP_USER}
Group=${APP_USER}
WorkingDirectory=${APP_DIR}
EnvironmentFile=/etc/bounty-workshop.env
ExecStart=${APP_DIR}/.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port ${BACKEND_PORT}
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

echo "准备数据目录权限..."
mkdir -p ${APP_DIR}/data/storage
chown -R ${APP_USER}:${APP_USER} ${APP_DIR}/data

systemctl daemon-reload
systemctl enable bounty-workshop
systemctl restart bounty-workshop

echo "7. 编译前端代码..."
cd ${APP_DIR}/web
sudo -u $SUDO_USER npm ci
sudo -u $SUDO_USER VITE_API_BASE_URL=/api npm run build

echo "8. 配置 Nginx 反向代理..."
cat > /etc/nginx/sites-available/bounty-workshop <<EOF
server {
    listen ${FRONTEND_PORT};
    server_name ${DOMAIN};

    root ${APP_DIR}/web/dist;
    index index.html;

    # 前端静态资源路由
    location / {
        try_files \$uri /index.html;
    }

    # 后端 API 反向代理
    location /api/ {
        proxy_pass http://127.0.0.1:${BACKEND_PORT}/;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF

ln -sf /etc/nginx/sites-available/bounty-workshop /etc/nginx/sites-enabled/bounty-workshop
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

echo "============================================="
echo "✅ 部署完成！"
echo "后端服务已通过 Systemd 运行在后台。"
echo "请确保服务器安全组已开放 80 端口。"
echo "如果您需要配置真实域名和 HTTPS，请修改 Nginx 配置并运行 certbot。"
echo "系统运行日志可通过命令查看: journalctl -u bounty-workshop -f"
echo "============================================="
