# 🌟 优化：使用国内加速源拉取基础镜像
FROM docker.1ms.run/library/python:3.11-slim

WORKDIR /app

# 设置时区，防止日志时间错乱
ENV TZ=Asia/Shanghai
RUN ln -snf /usr/share/zoneinfo/$TZ /etc/localtime && echo $TZ > /etc/timezone

# 🌟 优化：使用阿里云 Pip 镜像源
RUN pip config set global.index-url https://mirrors.aliyun.com/pypi/simple/ && \
    pip install --no-cache-dir --upgrade pip

# 🌟 优化：先装依赖再拷代码，改业务代码不会重新装依赖
COPY pyproject.toml ./
RUN mkdir -p app && touch app/__init__.py && \
    pip install --no-cache-dir .

# 复制整个后端代码，再装一次只装包本身（秒完成）
COPY . .
RUN pip install --no-cache-dir --no-deps .

# 暴露 FastAPI 端口
EXPOSE 8000

# 启动 Uvicorn 服务器
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
