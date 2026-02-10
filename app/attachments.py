from __future__ import annotations

import hashlib
import os
import uuid
from dataclasses import dataclass
from pathlib import Path

from fastapi import HTTPException
from sqlmodel import Session, select

from app.enums import Role
from app.models import Attachment
from app.models import Claim
from app.models import Deliverable
from app.models import Problem
from app.models import Task
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
        raise HTTPException(status_code=500, detail="ATTACHMENT_STORAGE_BACKEND supports only local or s3")
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
        raise HTTPException(status_code=500, detail="missing ATTACHMENT_S3_BUCKET")
    return bucket


def _create_s3_client():
    try:
        import boto3
    except ImportError as exc:
        raise HTTPException(status_code=500, detail="boto3 is required for s3 attachment storage") from exc

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
        raise HTTPException(status_code=502, detail=f"s3 upload failed: {exc}") from exc
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
        raise HTTPException(status_code=400, detail="presigned urls are only available for s3 attachments")
    bucket = attachment.bucket or _s3_bucket()
    client = _create_s3_client()
    try:
        return client.generate_presigned_url(
            "get_object",
            Params={"Bucket": bucket, "Key": attachment.object_key},
            ExpiresIn=expires_in,
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"s3 presign failed: {exc}") from exc


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
        raise HTTPException(status_code=400, detail="filename is required")
    if not content:
        raise HTTPException(status_code=400, detail="empty file is not allowed")
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
        raise HTTPException(status_code=404, detail="attachment not found")
    return attachment


def _can_access_problem(
    session: Session,
    actor_id: int,
    actor_roles: set[Role],
    problem_id: int,
) -> bool:
    problem = session.get(Problem, problem_id)
    if problem is None:
        return False
    return actor_id == problem.submitter_id or Role.ADMIN in actor_roles or Role.REVIEWER in actor_roles


def _can_access_deliverable(
    session: Session,
    actor_id: int,
    actor_roles: set[Role],
    deliverable_id: int,
) -> bool:
    deliverable = session.get(Deliverable, deliverable_id)
    if deliverable is None:
        return False
    claim = session.get(Claim, deliverable.claim_id)
    if claim is None:
        return False
    task = session.get(Task, claim.task_id)
    if task is None:
        return False
    return (
        actor_id == claim.lead_user_id
        or actor_id == task.accepter_id
        or Role.ADMIN in actor_roles
        or Role.REVIEWER in actor_roles
    )


def ensure_entity_attachment_access(
    session: Session,
    actor_id: int,
    actor_roles: set[Role],
    entity_type: str,
    entity_id: int,
) -> None:
    if entity_type == "problem":
        if _can_access_problem(session, actor_id, actor_roles, entity_id):
            return
        raise HTTPException(status_code=403, detail="permission denied for problem attachments")
    if entity_type == "deliverable":
        if _can_access_deliverable(session, actor_id, actor_roles, entity_id):
            return
        raise HTTPException(status_code=403, detail="permission denied for deliverable attachments")
    raise HTTPException(status_code=400, detail="unsupported attachment entity_type")


def ensure_attachment_access(
    session: Session,
    actor_id: int,
    actor_roles: set[Role],
    attachment: Attachment,
) -> None:
    if attachment.entity_type is None or attachment.entity_id is None:
        if (
            actor_id == attachment.uploader_user_id
            or Role.ADMIN in actor_roles
            or Role.REVIEWER in actor_roles
        ):
            return
        raise HTTPException(status_code=403, detail="permission denied for unbound attachment")

    ensure_entity_attachment_access(
        session=session,
        actor_id=actor_id,
        actor_roles=actor_roles,
        entity_type=attachment.entity_type,
        entity_id=attachment.entity_id,
    )


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
        raise HTTPException(status_code=400, detail="some attachments do not exist")
    urls: list[str] = []
    for item in rows:
        item.entity_type = entity_type
        item.entity_id = entity_id
        urls.append(f"/attachments/{item.id}/download")
    return urls
