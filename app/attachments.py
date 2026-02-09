from __future__ import annotations

import hashlib
import os
import uuid
from dataclasses import dataclass
from pathlib import Path

from fastapi import HTTPException
from sqlmodel import Session, select

from app.models import Attachment
from app.schemas import AttachmentRead


DEFAULT_STORAGE_DIR = Path("data/storage")
DEFAULT_STORAGE_BACKEND = "local"
DEFAULT_PRESIGNED_EXPIRES = 3600


@dataclass
class SavedObject:
    object_key: str
    content_type: str
    size_bytes: int
    checksum_sha256: str
    storage_backend: str
    bucket: str | None


def _storage_backend() -> str:
    backend = os.getenv("ATTACHMENT_STORAGE_BACKEND", DEFAULT_STORAGE_BACKEND).strip().lower()
    if backend not in {"local", "s3"}:
        raise HTTPException(status_code=500, detail="ATTACHMENT_STORAGE_BACKEND 仅支持 local 或 s3")
    return backend


def _storage_dir() -> Path:
    custom = os.getenv("ATTACHMENT_STORAGE_DIR")
    return Path(custom) if custom else DEFAULT_STORAGE_DIR


def _object_prefix() -> str:
    prefix = os.getenv("ATTACHMENT_OBJECT_PREFIX", "attachments")
    return prefix.strip("/ ")


def _build_object_key(filename: str) -> str:
    ext = Path(filename).suffix
    key = f"{uuid.uuid4().hex}{ext}"
    prefix = _object_prefix()
    return f"{prefix}/{key}" if prefix else key


def _checksum(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def _s3_bucket() -> str:
    bucket = os.getenv("ATTACHMENT_S3_BUCKET")
    if not bucket:
        raise HTTPException(status_code=500, detail="缺少 ATTACHMENT_S3_BUCKET 配置")
    return bucket


def _create_s3_client():
    try:
        import boto3
    except ImportError as exc:
        raise HTTPException(status_code=500, detail="未安装 boto3，无法使用 s3 存储") from exc

    return boto3.client(
        "s3",
        endpoint_url=os.getenv("ATTACHMENT_S3_ENDPOINT_URL"),
        region_name=os.getenv("ATTACHMENT_S3_REGION"),
        aws_access_key_id=os.getenv("ATTACHMENT_S3_ACCESS_KEY_ID"),
        aws_secret_access_key=os.getenv("ATTACHMENT_S3_SECRET_ACCESS_KEY"),
    )


def _save_local_file(filename: str, content_type: str | None, content: bytes) -> SavedObject:
    key = _build_object_key(filename)
    base_dir = _storage_dir()
    base_dir.mkdir(parents=True, exist_ok=True)
    target = base_dir / key
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(content)
    return SavedObject(
        object_key=key,
        content_type=content_type or "application/octet-stream",
        size_bytes=len(content),
        checksum_sha256=_checksum(content),
        storage_backend="local",
        bucket=None,
    )


def _save_s3_file(filename: str, content_type: str | None, content: bytes) -> SavedObject:
    bucket = _s3_bucket()
    key = _build_object_key(filename)
    client = _create_s3_client()
    try:
        client.put_object(
            Bucket=bucket,
            Key=key,
            Body=content,
            ContentType=content_type or "application/octet-stream",
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"S3 上传失败: {exc}") from exc
    return SavedObject(
        object_key=key,
        content_type=content_type or "application/octet-stream",
        size_bytes=len(content),
        checksum_sha256=_checksum(content),
        storage_backend="s3",
        bucket=bucket,
    )


def save_file(filename: str, content_type: str | None, content: bytes) -> SavedObject:
    backend = _storage_backend()
    if backend == "local":
        return _save_local_file(filename=filename, content_type=content_type, content=content)
    return _save_s3_file(filename=filename, content_type=content_type, content=content)


def local_file_path(object_key: str) -> Path:
    return _storage_dir() / object_key


def get_presigned_download_url(attachment: Attachment, expires_in: int = DEFAULT_PRESIGNED_EXPIRES) -> str:
    if attachment.storage_backend != "s3":
        raise HTTPException(status_code=400, detail="仅 s3 附件支持预签名链接")
    bucket = attachment.bucket or _s3_bucket()
    client = _create_s3_client()
    try:
        return client.generate_presigned_url(
            "get_object",
            Params={"Bucket": bucket, "Key": attachment.object_key},
            ExpiresIn=expires_in,
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"S3 预签名生成失败: {exc}") from exc


def attachment_to_read(attachment: Attachment) -> AttachmentRead:
    return AttachmentRead(
        id=attachment.id,
        filename=attachment.filename,
        content_type=attachment.content_type,
        size_bytes=attachment.size_bytes,
        checksum_sha256=attachment.checksum_sha256,
        storage_backend=attachment.storage_backend,
        bucket=attachment.bucket,
        uploader_user_id=attachment.uploader_user_id,
        entity_type=attachment.entity_type,
        entity_id=attachment.entity_id,
        download_url=f"/attachments/{attachment.id}/download",
        created_at=attachment.created_at,
    )


def create_attachment(
    session: Session,
    uploader_user_id: int,
    filename: str,
    content_type: str | None,
    content: bytes,
) -> AttachmentRead:
    if not filename:
        raise HTTPException(status_code=400, detail="文件名不能为空")
    if not content:
        raise HTTPException(status_code=400, detail="空文件不允许上传")
    saved = save_file(filename=filename, content_type=content_type, content=content)
    attachment = Attachment(
        object_key=saved.object_key,
        filename=filename,
        content_type=saved.content_type,
        size_bytes=saved.size_bytes,
        checksum_sha256=saved.checksum_sha256,
        storage_backend=saved.storage_backend,
        bucket=saved.bucket,
        uploader_user_id=uploader_user_id,
    )
    session.add(attachment)
    session.commit()
    session.refresh(attachment)
    return attachment_to_read(attachment)


def get_attachment_or_404(session: Session, attachment_id: int) -> Attachment:
    attachment = session.get(Attachment, attachment_id)
    if attachment is None:
        raise HTTPException(status_code=404, detail="附件不存在")
    return attachment


def list_attachments_by_entity(
    session: Session,
    entity_type: str,
    entity_id: int,
) -> list[AttachmentRead]:
    rows = session.exec(
        select(Attachment)
        .where(Attachment.entity_type == entity_type, Attachment.entity_id == entity_id)
        .order_by(Attachment.created_at.asc())
    ).all()
    return [attachment_to_read(item) for item in rows]


def bind_attachments(
    session: Session,
    attachment_ids: list[int],
    entity_type: str,
    entity_id: int,
) -> list[str]:
    if not attachment_ids:
        return []
    deduplicated = list(dict.fromkeys(attachment_ids))
    rows = session.exec(select(Attachment).where(Attachment.id.in_(deduplicated))).all()
    if len(rows) != len(deduplicated):
        raise HTTPException(status_code=400, detail="部分附件不存在")
    urls: list[str] = []
    for item in rows:
        item.entity_type = entity_type
        item.entity_id = entity_id
        urls.append(f"/attachments/{item.id}/download")
    return urls

