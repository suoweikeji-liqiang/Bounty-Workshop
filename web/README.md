# Bounty Workshop Frontend

揭榜挂帅任务管理系统前端（React + Vite + TypeScript）。

## 启动

```bash
npm install
npm run dev
```

默认访问：`http://127.0.0.1:5173`

## 环境变量

创建 `web/.env`：

```bash
VITE_API_BASE_URL=http://127.0.0.1:8000
```

## 当前页面

- 仪表盘：总览、排行、趋势、分布
- 问题池：问题提交 + 我的问题列表
- 任务大厅：待揭榜列表 + 成果提交入口
- 执行闭环：我的揭榜、待验收处理、激励确认
- 附件中心：上传、元数据查询、实体附件查询、下载
- 飞书集成：登录链接、回调、手动同步、部门查看、同步频率配置

## 权限与登录态

- 前端通过 `GET /me` 获取当前用户档案与角色
- 使用 `X-User-Id` 作为会话切换键（保存在本地）
- 页面级守卫：
  - `飞书集成` 仅 `admin/reviewer/acceptor`
- 按钮级权限：
  - 飞书页面中的“同步”和“频率保存”仅 `admin`
  - 执行闭环中的“验收提交”仅 `admin/acceptor`
  - 执行闭环中的“激励确认”仅 `admin/reviewer`

## 构建

```bash
npm run build
```
