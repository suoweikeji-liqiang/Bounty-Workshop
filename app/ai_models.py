from __future__ import annotations
import os

from cryptography.fernet import Fernet
from datetime import datetime
from typing import TYPE_CHECKING, Optional

from sqlalchemy import select
from sqlmodel import Session

from app.models import AIModel

if TYPE_CHECKING:
    from app.schemas import AIModelCreate, AIModelUpdate

ENCRYPTION_KEY = os.environ.get(
    "AI_ENCRYPTION_KEY",
    Fernet.generate_key().decode() if hasattr(Fernet.generate_key(), "decode") else Fernet.generate_key(),
)

_cipher = Fernet(ENCRYPTION_KEY.encode() if isinstance(ENCRYPTION_KEY, str) else ENCRYPTION_KEY)


def encrypt_api_key(api_key: str) -> str:
    return _cipher.encrypt(api_key.encode()).decode()


def decrypt_api_key(encrypted: str) -> str:
    return _cipher.decrypt(encrypted.encode()).decode()


def create_ai_model(session: Session, actor_id: int, payload: "AIModelCreate") -> AIModel:
    if payload.is_default:
        existing_defaults = session.exec(
            select(AIModel).where(AIModel.is_default is True)
        ).all()
        for model in existing_defaults:
            model.is_default = False

    encrypted_api_key = encrypt_api_key(payload.api_key)

    model = AIModel(
        name=payload.name,
        provider=payload.provider,
        api_base_url=payload.api_base_url,
        api_key_encrypted=encrypted_api_key,
        model=payload.model,
        is_default=payload.is_default,
        enabled=payload.enabled,
        max_tokens=payload.max_tokens,
        temperature=payload.temperature,
        timeout=payload.timeout,
    )
    session.add(model)
    session.commit()
    session.refresh(model)
    return model


def list_ai_models(session: Session) -> list[AIModel]:
    return session.exec(select(AIModel).order_by(AIModel.created_at.desc())).all()


def get_ai_model(session: Session, model_id: int) -> Optional[AIModel]:
    return session.get(AIModel, model_id)


def get_default_model(session: Session) -> Optional[AIModel]:
    model = session.exec(
        select(AIModel).where(AIModel.is_default is True, AIModel.enabled is True)
    ).first()
    if model:
        return model
    return session.exec(
        select(AIModel).where(AIModel.enabled is True).order_by(AIModel.created_at.desc())
    ).first()


def update_ai_model(
    session: Session, actor_id: int, model_id: int, payload: "AIModelUpdate"
) -> AIModel:
    model = session.get(AIModel, model_id)
    if model is None:
        raise ValueError(f"Model {model_id} not found")

    if payload.is_default and not model.is_default:
        existing_defaults = session.exec(
            select(AIModel).where(AIModel.is_default is True, AIModel.id != model_id)
        ).all()
        for m in existing_defaults:
            m.is_default = False

    update_data = payload.model_dump(exclude_unset=True)
    if "api_key" in update_data and update_data["api_key"]:
        update_data["api_key_encrypted"] = encrypt_api_key(update_data.pop("api_key"))

    for key, value in update_data.items():
        if key != "api_key":
            setattr(model, key, value)

    model.updated_at = datetime.utcnow()
    session.commit()
    session.refresh(model)
    return model


def delete_ai_model(session: Session, model_id: int) -> None:
    model = session.get(AIModel, model_id)
    if model is None:
        raise ValueError(f"Model {model_id} not found")
    session.delete(model)
    session.commit()
