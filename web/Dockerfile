# 第 1 阶段：Node 构建环境
FROM node:20-alpine AS builder

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# 注入构建时的环境变量（确保和真实域名/IP对齐）
ENV VITE_API_BASE_URL=/api
RUN npm run build

# 第 2 阶段：Nginx 服务环境
FROM nginx:alpine

# 移除默认的 nginx 配置
RUN rm /etc/nginx/conf.d/default.conf

# 复制我们自定义的 Nginx 配置
COPY nginx.conf /etc/nginx/conf.d/

# 将第一阶段构建产物复制到 Nginx 默认静态目录
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
