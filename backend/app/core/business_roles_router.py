"""Job-role presets API (Settings → Team).

GET /api/v1/business-roles/                     - presets, permission matrix, members
PUT /api/v1/business-roles/users/{user_id}/     - assign a preset to a member
"""

from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select

from app.core.audit import audit_log
from app.core.business_roles import PRESETS, business_matrix, preset_of
from app.dependencies import CurrentUserId, RequirePermission, SessionDep

router = APIRouter(tags=["business-roles"])


class AssignPreset(BaseModel):
    preset: str = Field(pattern="^(" + "|".join(PRESETS) + ")$")


def _member(user: Any) -> dict[str, Any]:
    return {
        "id": str(user.id),
        "email": user.email,
        "full_name": user.full_name,
        "role": user.role,
        "is_active": user.is_active,
        "preset": preset_of(user.metadata_),
    }


@router.get("/business-roles/", dependencies=[Depends(RequirePermission("users.read"))])
async def get_business_roles(session: SessionDep) -> dict[str, Any]:
    from app.modules.users.models import User

    users = (await session.execute(select(User).where(User.deleted_at.is_(None)).order_by(User.email))).scalars().all()
    return {**business_matrix(), "members": [_member(u) for u in users]}


@router.put("/business-roles/users/{user_id}/", dependencies=[Depends(RequirePermission("users.update"))])
async def assign_business_role(
    user_id: uuid.UUID, body: AssignPreset, session: SessionDep, actor_id: CurrentUserId
) -> dict[str, Any]:
    from app.modules.users.models import User

    user = await session.get(User, user_id)
    if user is None or user.deleted_at is not None:
        raise HTTPException(status_code=404, detail="User not found")
    spec = PRESETS[body.preset]
    if user.role == "admin" and spec["role"] != "admin":
        admins = await session.scalar(
            select(func.count())
            .select_from(User)
            .where(User.role == "admin", User.is_active.is_(True), User.deleted_at.is_(None))
        )
        if (admins or 0) <= 1:
            raise HTTPException(status_code=409, detail="Cannot remove the last owner")
    before = {"role": user.role, "preset": preset_of(user.metadata_)}
    metadata = dict(user.metadata_ or {})
    metadata["business_role"] = body.preset
    user.metadata_ = metadata
    user.role = spec["role"]
    await audit_log(
        session,
        action="assign_role",
        entity_type="user",
        entity_id=str(user.id),
        user_id=str(actor_id),
        details={"before": before, "after": {"role": user.role, "preset": body.preset}},
    )
    await session.commit()
    return _member(user)
