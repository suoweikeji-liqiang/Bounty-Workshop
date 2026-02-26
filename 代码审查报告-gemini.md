# 代码审查报告 - Bounty Workshop 核心工程结构 (gemini)

## ⚡ 核心评估
项目整体架构清晰，前后端分离和 RBAC 权限控制实现得非常扎实，但在密钥管理、大文件处理以及核心模块的体积膨胀方面存在需要优化的技术债。

## ⚠️ 严重问题 (Blockers)

1. **硬编码的初始化密码与 JWT 密钥 (Security)**
   - **问题**：`app/main.py` 的 `lifespan` 中硬编码了超级管理员的初始密码 `admin123`；`app/auth.py` 中硬编码了后备 JWT 密钥 `bounty-workshop-dev-secret`。
   - **原因**：这会将系统最脆弱的入口暴露在代码仓库中。即使 `lifespan` 提示了立刻修改密码，但在自动化部署场景下，这极大增加了被爆破或越权接管的风险。
   - **建议**：必须强制应用通过环境变量配置初始管理员密码（如 `INIT_ADMIN_PASSWORD`）和密钥（如 `AUTH_TOKEN_SECRET`），并在缺少密钥时拒绝启动。

2. **附件上传存在内存溢出 (OOM) 风险 (Logic/Performance)**
   - **问题**：在 `app/main.py` 的 `/attachments/upload` 接口中，使用了 `content = await file.read()` 一次性将用户上传的文件全部读入内存。
   - **原因**：如果用户上传了 GB 级别的超大视频或压缩包，后端服务器内存将瞬间被撑爆，系统将陷入 OOM 崩溃，这不仅是性能问题，更是潜在的 DOS 攻击漏洞。
   - **建议**：如果是直接存入本地或 MinIO，应使用流式传输（Streaming/Chunking）直接将 `file.file` 的文件描述符管道送入目标存储，而非读入变量。

3. **缺省状态下的 SQLite 并发门槛 (Performance)**
   - **问题**：`app/db.py` 采用了 SQLite，配置了 `check_same_thread: False`。
   - **原因**：FastAPI 是高并发的异步框架，而在高并发写入场景中，SQLite 的默认锁机制容易报 `Database is locked` 错误。
   - **建议**：如果使用 SQLite，必须在 engine 配置中开启 WAL（Write-Ahead Logging）模式，并增加 `timeout` 参数（如 `timeout=15`）以容忍短暂的锁等待。

## 💡 优化建议 (Suggestions)

1. **巨型单体文件拆分（Controller/Router重构）**
   - **原因**：`app/main.py`（~1500行）和 `app/services.py`（~1600行）已经成为非常臃肿的神仙对象 (God Objects)。随着迭代，这里的代码合并冲突率会急剧上升。
   - **建议**：使用 FastAPI 的 `APIRouter`，将 `main.py` 按领域模型（如 users, problems, tasks, feishu）拆分成多个独立的 router 文件。同理，`services.py` 也应该按照业务域拆分。

2. **[nit] 前端巨型 CSS 文件优化**
   - **原因**：`web/src/index.css` 达到了 24KB。对于单一文件这已经相当庞大，且没有局部作用域，容易引发样式冲突。
   - **建议**：未来重构时可考虑使用 CSS Modules（`*.module.css`）或者 Tailwind CSS 进行组件化样式隔离。

3. **[nit] HTTP 监听中间件的异常吞没**
   - **原因**：`main.py` 的 `log_requests` 中间件捕获异常后直接 `raise`，尽管能在终端里打出 Error，但这会导致客户端直接收到一个缺乏上下文的 500 而没有任何 JSON 结构的反馈。
   - **建议**：FastAPI 层面最好配置全局的 `Exception Handler`，使得所有未捕获异常都能稳定返回标准格式的 `{"detail": "Internal Server Error"}`。

## ✅ 亮点总结

- **权限控制双层把关极度规范**：在后端通过 `Depends(require_roles)` 进行了严密的接口级拦截，同时前端 `App.tsx` 中的 `<Guard>` 组件实现了路由和可视区域级别的访问控制，这种 Defense In Depth（纵深防御）的设计极其出色！
- **ORM 利用得当，防范了 SQLi**：全面使用了 SQLModel (基于 SQLAlchemy) 的 ORM 模型，没有发现拼写原生字符串 SQL (`eval` 或 `f"SELECT"`) 的反模式，这从根源上消除了 SQL 注入的大部分风险。
- **Type Hint 与 Pydantic 深度结合**：从 `schemas.py` 来看，数据验证和 Schema 定义非常详尽严谨，利用了 FastAPI 和 Pydantic 的最优特质，保证了进出接口的数据始终符合预期。

## 🛠️ 修正代码示例

**针对附件上传 OOM 的修复 (`app/main.py` 或相关文件)：**

```python
# 修复前：
# content = await file.read()
# attachment = create_attachment(..., content=content)

# 修复后 (以将文件写入本地为例，如果是对接 S3/Minio Boto3 也支持 file-like object 直传):
import shutil

@app.post("/attachments/upload", response_model=AttachmentRead)
async def post_attachment_upload(
    file: UploadFile = File(...),
    session: Session = Depends(get_session),
    actor_id: int = Depends(get_current_user_id),
):
    # 此处假设 create_attachment 已经被改造为接收 file.file 并在内部流式传输
    # 不要使用 await file.read()，如果是本地存储：
    # with open(local_path, "wb") as buffer:
    #     shutil.copyfileobj(file.file, buffer)
    
    attachment = create_attachment_from_stream(
        session=session,
        uploader_user_id=actor_id,
        filename=file.filename or "file.bin",
        content_type=file.content_type,
        file_stream=file.file, # 传递 SpooledTemporaryFile 文件流指针
    )
    return attachment
```

**针对 SQLite 并发问题的修复 (`app/db.py`)：**

```python
from sqlalchemy import create_engine, event

DATABASE_URL = f"sqlite:///{DB_PATH}"

# 增加 timeout 参数
engine = create_engine(
    DATABASE_URL, 
    connect_args={
        "check_same_thread": False,
        "timeout": 15
    }
)

# 强制开启 SQLite 的 WAL 模式以提升并发读写能力
@event.listens_for(engine, "connect")
def set_sqlite_pragma(dbapi_connection, connection_record):
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA synchronous=NORMAL")
    cursor.close()
```
