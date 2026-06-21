import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database import get_db
from middleware.auth import CurrentUser, get_current_user, require_write_access
from models.real_estate.entity import BusinessLine, Entity, EntityType, Project

router = APIRouter(prefix="/api/real-estate/entities", tags=["real-estate"])


class EntityCreate(BaseModel):
    entity_name: str
    entity_type: str
    business_line: str
    ein: str | None = None
    formation_state: str | None = None
    parent_entity_id: str | None = None
    is_active: bool = True


def _entity_dict(e: Entity, children=None):
    return {
        "id": str(e.id),
        "entity_name": e.entity_name,
        "entity_type": e.entity_type.value,
        "business_line": e.business_line.value,
        "ein": e.ein,
        "formation_state": e.formation_state,
        "parent_entity_id": str(e.parent_entity_id) if e.parent_entity_id else None,
        "is_active": e.is_active,
        "children": children or [],
    }


@router.get("")
def list_entities(
    business_line: str | None = None,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    q = db.query(Entity).filter(Entity.tenant_id == current_user.tenant_id)
    if business_line:
        q = q.filter(Entity.business_line == BusinessLine(business_line))
    entities = q.order_by(Entity.entity_name).all()
    return [_entity_dict(e) for e in entities]


@router.get("/{entity_id}")
def get_entity(
    entity_id: uuid.UUID,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    entity = (
        db.query(Entity)
        .filter(Entity.id == entity_id, Entity.tenant_id == current_user.tenant_id)
        .first()
    )
    if not entity:
        raise HTTPException(status_code=404, detail="Entity not found")
    children = (
        db.query(Entity)
        .filter(Entity.parent_entity_id == entity.id, Entity.tenant_id == current_user.tenant_id)
        .all()
    )
    return _entity_dict(entity, [_entity_dict(c) for c in children])


@router.post("")
def create_entity(
    body: EntityCreate,
    current_user: CurrentUser = Depends(require_write_access()),
    db: Session = Depends(get_db),
):
    entity = Entity(
        tenant_id=current_user.tenant_id,
        entity_name=body.entity_name,
        entity_type=EntityType(body.entity_type),
        business_line=BusinessLine(body.business_line),
        ein=body.ein,
        formation_state=body.formation_state,
        parent_entity_id=uuid.UUID(body.parent_entity_id) if body.parent_entity_id else None,
        is_active=body.is_active,
        created_by=current_user.user_id,
    )
    db.add(entity)
    db.commit()
    db.refresh(entity)
    return _entity_dict(entity)


@router.put("/{entity_id}")
def update_entity(
    entity_id: uuid.UUID,
    body: EntityCreate,
    current_user: CurrentUser = Depends(require_write_access()),
    db: Session = Depends(get_db),
):
    entity = (
        db.query(Entity)
        .filter(Entity.id == entity_id, Entity.tenant_id == current_user.tenant_id)
        .first()
    )
    if not entity:
        raise HTTPException(status_code=404, detail="Entity not found")
    entity.entity_name = body.entity_name
    entity.entity_type = EntityType(body.entity_type)
    entity.business_line = BusinessLine(body.business_line)
    entity.ein = body.ein
    entity.formation_state = body.formation_state
    entity.is_active = body.is_active
    db.commit()
    return _entity_dict(entity)
