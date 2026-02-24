# Bounty Workshop 部署指南 (Docker推荐)

本文档提供一套基于 Docker 的极简部署方案，适用于任何支持 Docker 的环境（如 Linux 物理机、云主机、TNAS/群晖等 NAS 平台）。

由于本项目的单体微服务轻量化特性，Docker 化部署是目前维护成本最低、体验最完整的最佳实践。通过 `docker-compose` 能够全自动挂载以下所有关联服务模块的联合通信：
- 前端（基于 Nginx，内部静态页面服务并转发代理）
- 后端 API（FastAPI 提供问题、任务大厅、看板及系统作业支持）
- 内置附件对象存储中心（附带一个专供系统使用的 MinIO，自动完成文件桶建与跨域策略绑定）

## 1. 部署准备条件

请确保您的目标服务器/NAS上已正确安装并运行：
- **Docker**
- **Docker Compose**

部署所需资料仅仅为您开发工作台上的那个最新代码库（即本地本工程的代码文件夹）。把它通过 SSH 拖拽或上传到服务器即可。

> **⚠️ 注意：** 
> 传输或打包代码库时，请勿把您这边的庞大本地环境目录一起传过去，浪费您宝贵的 NAS 硬盘和部署时间。
> **请务必过滤包含但不限于以下目录：**
> - `web/node_modules/` （本地前端包）
> - `web/dist/`
> - `.venv/` （本地 Python 包环境）
>
> *(注：我们在代码库中配置的 `.dockerignore` 已经能覆盖部分打包防泄漏场景，确保本地安全上传才是真。)*

## 2. 🚀 一键编译启动

在目标操作系统（例如 TNAS）中打开终端终端，进入到刚才传输上传的代码根目录（和 `docker-compose.yml` 处在同一级目录）：

```bash
cd /您服务器里的部署途径/Bounty-Workshop/
```

执行如下命令开始全自动拉取依赖（初次非常慢）和自动拉起所有服务器及容器：

```bash
docker-compose up -d --build
```

构建并部署成功后，控制台上会自动输出成功启动以下服务。您可以使用 `docker ps` 进行确认查询这四个容器正常运行中：
1. `bounty-minio` ：附件存放管理系统
2. `bounty-backend` ：项目后端控制中心
3. `bounty-frontend` ：项目用户展现交互侧（监听映射到主机的 81 端口）

## 3. 登录与安全检查口

部署完成了！在内网的任何一台电脑的浏览器中打开：

- **系统使用入口：** `http://<您的服务器物理IP>:81` 
- **系统底层附件管理平台：** `http://<您的服务器物理IP>:8001` 
  - 默认登录安全账号：`bounty_admin`
  - 默认登录安全密码：`bounty_password`

如果有自定义端口的需求、需要换密码或是使用内网域名的需要，都可以直接打开并编辑修改 `docker-compose.yml` 后再度重启使用即可！

## 4. 后续开发迭代后的升级

如果此代码有继续新的迭代修改功能：
1. 请先用修改好的本地文件覆盖到您服务器下的原项目文件夹文件。
2. 在服务器的代码路径下跑一遍代码编译重组和无感重启即可：
   ```bash
   docker-compose up -d --build
   ```

*(因为我们挂载映射了 `./data` 实体目录，数据无丢失烦恼！)*

## 5. （高级/联调）配置您的真实「飞书应用验证」

当前系统的 `docker-compose.yml` 默认是以无需飞书申请的 `FEISHU_PROVIDER=mock` 测试模拟账户跑通业务。
如果需要换作真实的、接入您公司的飞书审批通知体系内网验证的话，请停止服务器然后进去修改 `docker-compose.yml` 环境常量：

```yaml
      - FEISHU_PROVIDER=http
      - FEISHU_APP_ID=您的飞书APP_ID
      - FEISHU_APP_SECRET=您的飞书APP_SECRET
      - FEISHU_AUTHORIZE_URL=https://open.feishu.cn/open-apis/authen/v1/index
      - FEISHU_TOKEN_URL=https://open.feishu.cn/open-apis/authen/v1/access_token
      - FEISHU_PROFILE_URL=https://open.feishu.cn/open-apis/authen/v1/user_info
      - FEISHU_DEPARTMENTS_URL=https://open.feishu.cn/open-apis/contact/v3/departments
      - FEISHU_USERS_URL=https://open.feishu.cn/open-apis/contact/v3/users
      - FEISHU_REDIRECT_URI=http://<您的服务器IP>:81/auth/feishu/callback
```

保存 `docker-compose.yml` 之后再次运行 `docker-compose up -d` 这个真实的对接状态即可正式启用工作！
