# 🌟 优化：使用国内加速源拉取基础镜像
FROM docker.1panel.live/library/python:3.11-slim

WORKDIR /app

# 设置时区，防止日志时间错乱
ENV TZ=Asia/Shanghai
RUN ln -snf /usr/share/zoneinfo/$TZ /etc/localtime && echo $TZ > /etc/timezone

# 复制依赖定义并安装
COPY pyproject.toml ./

# 🌟 优化：使用阿里云 Pip 镜像源保证下载速度
RUN pip config set global.index-url https://mirrors.aliyun.com/pypi/simple/ && \
    pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -e .

# 复制整个后端代码
COPY . .

# 暴露 FastAPI 端口
EXPOSE 8000

# 启动 Uvicorn 服务器
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
