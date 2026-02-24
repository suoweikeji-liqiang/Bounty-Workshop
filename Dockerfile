# 后端构建镜像
FROM python:3.11-slim

WORKDIR /app

# 设置时区，防止日志时间错乱
ENV TZ=Asia/Shanghai
RUN ln -snf /usr/share/zoneinfo/$TZ /etc/localtime && echo $TZ > /etc/timezone

# 复制依赖定义并安装
COPY pyproject.toml ./
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -e .

# 复制整个后端代码
COPY . .

# 暴露 FastAPI 端口
EXPOSE 8000

# 启动 Uvicorn 服务器
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
