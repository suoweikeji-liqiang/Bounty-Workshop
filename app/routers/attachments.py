from __future__ import annotations

import os

from fastapi import APIRouter, Depends, File, Query, UploadFile
from fastapi import HTTPException
from fastapi.responses import RedirectResponse, StreamingResponse
from sqlmodel import Session

from app.attachments import (
    attachment_to_read,
    create_attachment,
    ensure_attachment_access,
    ensure_entity_attachment_access,
    get_attachment_or_404,
    get_presigned_download_url,
    get_s3_object_stream,
    list_attachments_by_entity,
    local_file_path,
)
from app.auth import get_current_user_id, get_user_roles
from app.db import get_session
from app.schemas import AttachmentPresignRead, AttachmentRead

router = APIRouter(tags=["attachments"])

_MAX_UPLOAD_BYTES = int(os.getenv("MAX_UPLOAD_SIZE_MB", "50")) * 1024 * 1024


@router.post("/attachments/upload", response_model=AttachmentRead)
async def post_attachment_upload(
    file: UploadFile = File(...),
    session: Session = Depends(get_session),
    actor_id: int = Depends(get_current_user_id),
) -> AttachmentRead:
    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = await file.read(256 * 1024)
        if not chunk:
            break
        total += len(chunk)
        if total > _MAX_UPLOAD_BYTES:
            raise HTTPException(
                status_code=413,
                detail=f"文件大小超过限制 ({_MAX_UPLOAD_BYTES // (1024 * 1024)}MB)",
            )
        chunks.append(chunk)
    content = b"".join(chunks)
    return create_attachment(
        session=session,
        uploader_user_id=actor_id,
        filename=file.filename or "file.bin",
        content_type=file.content_type,
        content=content,
    )


@router.get("/attachments/{attachment_id}", response_model=AttachmentRead)
def get_attachment_metadata(
    attachment_id: int,
    session: Session = Depends(get_session),
    actor_id: int = Depends(get_current_user_id),
) -> AttachmentRead:
    attachment = get_attachment_or_404(session, attachment_id)
    actor_roles = get_user_roles(session, actor_id)
    ensure_attachment_access(session, actor_id, actor_roles, attachment)
    return attachment_to_read(attachment)


@router.get("/attachments/{attachment_id}/download", response_model=None)
def get_attachment_download(
    attachment_id: int,
    expires_in: int = Query(default=3600, ge=60, le=86400),
    session: Session = Depends(get_session),
    actor_id: int = Depends(get_current_user_id),
) -> StreamingResponse:
    attachment = get_attachment_or_404(session, attachment_id)
    actor_roles = get_user_roles(session, actor_id)
    ensure_attachment_access(session, actor_id, actor_roles, attachment)
    media = attachment.content_type or "application/octet-stream"
    disposition = f'attachment; filename="{attachment.filename}"'
    if attachment.storage_backend == "s3":
        body = get_s3_object_stream(attachment)
        headers = {"Content-Disposition": disposition}
        if attachment.size_bytes:
            headers["Content-Length"] = str(attachment.size_bytes)
        return StreamingResponse(body.iter_chunks(256 * 1024), media_type=media, headers=headers)
    if attachment.storage_backend != "local":
        raise HTTPException(status_code=501, detail="不支持的存储后端")
    file_path = local_file_path(attachment.object_key)
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="附件文件不存在")
    payload = file_path.read_bytes()
    return StreamingResponse(
        iter([payload]),
        media_type=media,
        headers={
            "Content-Disposition": disposition,
            "Content-Length": str(len(payload)),
        },
    )


@router.get("/attachments/{attachment_id}/presign", response_model=AttachmentPresignRead)
def get_attachment_presign(
    attachment_id: int,
    expires_in: int = Query(default=3600, ge=60, le=86400),
    session: Session = Depends(get_session),
    actor_id: int = Depends(get_current_user_id),
) -> AttachmentPresignRead:
    attachment = get_attachment_or_404(session, attachment_id)
    actor_roles = get_user_roles(session, actor_id)
    ensure_attachment_access(session, actor_id, actor_roles, attachment)
    if attachment.storage_backend != "s3":
        raise HTTPException(status_code=400, detail="仅 s3 附件支持预签名")
    url = get_presigned_download_url(attachment, expires_in=expires_in)
    return AttachmentPresignRead(attachment_id=attachment_id, url=url, expires_in=expires_in)


@router.get("/entities/{entity_type}/{entity_id}/attachments", response_model=list[AttachmentRead])
def get_entity_attachments(
    entity_type: str,
    entity_id: int,
    session: Session = Depends(get_session),
    actor_id: int = Depends(get_current_user_id),
) -> list[AttachmentRead]:
    if entity_type not in {"problem", "deliverable"}:
        raise HTTPException(status_code=400, detail="entity_type 仅支持 problem 或 deliverable")
    actor_roles = get_user_roles(session, actor_id)
    ensure_entity_attachment_access(session, actor_id, actor_roles, entity_type, entity_id)
    return list_attachments_by_entity(session, entity_type=entity_type, entity_id=entity_id)
