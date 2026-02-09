# Bounty Workshop Linux 部署说明

本文档提供一套可直接落地的 Linux（Ubuntu 22.04/24.04）部署方案，包含后端、前端、Nginx、systemd、HTTPS 与日常运维。

## 1. 部署架构

- 前端：Vite 打包后的静态文件（`web/dist`），由 Nginx 提供。
- 后端：FastAPI（`uvicorn`），由 systemd 托管。
- 数据库：SQLite（默认 `data/app.db`）。
- 附件存储：本地目录（默认 `data/storage`）或 S3/MinIO。

推荐域名规划：

- 前端：`https://bounty.example.com`
- 后端 API：`https://bounty.example.com/api/*`（Nginx 反向代理到 `127.0.0.1:8000`）

## 2. 服务器准备

```bash
sudo apt update
sudo apt install -y git python3.11 python3.11-venv python3-pip nginx curl
```

安装 Node.js（用于前端构建，建议 20 LTS）：

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node -v
npm -v
```

## 3. 拉取代码与目录约定

```bash
sudo mkdir -p /opt/bounty-workshop
sudo chown -R $USER:$USER /opt/bounty-workshop
cd /opt/bounty-workshop
git clone https://github.com/suoweikeji-liqiang/Bounty-Workshop.git .
```

## 4. 后端部署

```bash
cd /opt/bounty-workshop
python3.11 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -e .[dev]
```

手工启动验证：

```bash
source /opt/bounty-workshop/.venv/bin/activate
uvicorn app.main:app --host 127.0.0.1 --port 8000
```

健康检查：

```bash
curl http://127.0.0.1:8000/health
```

预期返回：`{"status":"ok"}`

## 5. 环境变量配置

创建环境变量文件 `/etc/bounty-workshop.env`：

```bash
sudo tee /etc/bounty-workshop.env >/dev/null <<'EOF'
# ===== 基础 =====
APP_DB_PATH=/opt/bounty-workshop/data/app.db
ATTACHMENT_STORAGE_DIR=/opt/bounty-workshop/data/storage

# 前端域名（逗号分隔）
CORS_ALLOW_ORIGINS=https://bounty.example.com

# 认证（生产务必改强随机密钥）
AUTH_TOKEN_SECRET=change-this-to-a-strong-random-secret
AUTH_TOKEN_TTL_MINUTES=1440

# 定时任务
ENABLE_BACKGROUND_JOBS=true
ENABLE_FEISHU_SYNC_JOB=true

# 限流（默认已启用）
RATE_LIMIT_ENABLED=true
RATE_LIMIT_TASK_CLAIM_LIMIT=30
RATE_LIMIT_TASK_CLAIM_WINDOW_SECONDS=60
RATE_LIMIT_DELIVERABLE_SUBMIT_LIMIT=20
RATE_LIMIT_DELIVERABLE_SUBMIT_WINDOW_SECONDS=60

# 飞书（默认 mock；联调真实环境时改为 http 并补齐参数）
FEISHU_PROVIDER=mock
# FEISHU_PROVIDER=http
# FEISHU_APP_ID=xxx
# FEISHU_APP_SECRET=xxx
# FEISHU_AUTHORIZE_URL=...
# FEISHU_TOKEN_URL=...
# FEISHU_PROFILE_URL=...
# FEISHU_DEPARTMENTS_URL=...
# FEISHU_USERS_URL=...
# FEISHU_REDIRECT_URI=https://bounty.example.com/api/auth/feishu/callback

# 对象存储（可选，默认 local）
# ATTACHMENT_STORAGE_BACKEND=s3
# ATTACHMENT_S3_BUCKET=your-bucket
# ATTACHMENT_S3_ENDPOINT_URL=http://127.0.0.1:9000
# ATTACHMENT_S3_REGION=us-east-1
# ATTACHMENT_S3_ACCESS_KEY_ID=xxx
# ATTACHMENT_S3_SECRET_ACCESS_KEY=yyy
# ATTACHMENT_OBJECT_PREFIX=attachments
EOF
```

## 6. systemd 托管后端

创建服务文件 `/etc/systemd/system/bounty-workshop.service`：

```ini
[Unit]
Description=Bounty Workshop FastAPI
After=network.target

[Service]
Type=simple
User=www-data
Group=www-data
WorkingDirectory=/opt/bounty-workshop
EnvironmentFile=/etc/bounty-workshop.env
ExecStart=/opt/bounty-workshop/.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

创建数据目录并授权：

```bash
sudo mkdir -p /opt/bounty-workshop/data/storage
sudo chown -R www-data:www-data /opt/bounty-workshop/data
```

启动服务：

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now bounty-workshop
sudo systemctl status bounty-workshop
```

查看日志：

```bash
journalctl -u bounty-workshop -f
```

## 7. 前端构建与发布

前端 API 基础地址建议设置为 `/api`（同域部署）：

```bash
cd /opt/bounty-workshop/web
npm ci
VITE_API_BASE_URL=/api npm run build
```

## 8. Nginx 配置（同域）

创建 `/etc/nginx/sites-available/bounty-workshop`：

```nginx
server {
    listen 80;
    server_name bounty.example.com;

    root /opt/bounty-workshop/web/dist;
    index index.html;

    # 前端静态资源
    location / {
        try_files $uri /index.html;
    }

    # 后端 API 反向代理
    location /api/ {
        proxy_pass http://127.0.0.1:8000/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

启用配置：

```bash
sudo ln -sf /etc/nginx/sites-available/bounty-workshop /etc/nginx/sites-enabled/bounty-workshop
sudo nginx -t
sudo systemctl reload nginx
```

## 9. HTTPS（Let’s Encrypt）

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d bounty.example.com
```

证书自动续期检查：

```bash
sudo certbot renew --dry-run
```

## 10. 部署后检查清单

- `curl https://bounty.example.com/api/health` 返回 `status=ok`
- 浏览器可打开前端首页并完成登录
- 登录后可读取 `/me`、提交问题、查看任务大厅
- `journalctl -u bounty-workshop` 无持续报错

## 11. 升级流程

```bash
cd /opt/bounty-workshop
git pull
source .venv/bin/activate
python -m pip install -e .[dev]
cd web
npm ci
VITE_API_BASE_URL=/api npm run build
sudo systemctl restart bounty-workshop
sudo systemctl reload nginx
```

## 12. 备份与恢复

备份：

```bash
mkdir -p /opt/backups/bounty-workshop
cp /opt/bounty-workshop/data/app.db /opt/backups/bounty-workshop/app-$(date +%F-%H%M%S).db
tar -czf /opt/backups/bounty-workshop/storage-$(date +%F-%H%M%S).tar.gz -C /opt/bounty-workshop/data storage
```

恢复（示例）：

```bash
sudo systemctl stop bounty-workshop
cp /opt/backups/bounty-workshop/app-YYYY-MM-DD-HHMMSS.db /opt/bounty-workshop/data/app.db
sudo chown www-data:www-data /opt/bounty-workshop/data/app.db
sudo systemctl start bounty-workshop
```

## 13. 常见问题

- 401 未授权：确认前端已登录并携带 Bearer Token。
- 403 权限不足：检查当前用户角色（admin/reviewer/acceptor/employee）。
- 429 请求过多：触发限流，稍后重试或调整 `RATE_LIMIT_*`。
- 跨域报错：检查 `CORS_ALLOW_ORIGINS` 与实际访问域名是否一致。
- 上传失败：检查 `data/storage` 权限或 S3 配置是否完整。

