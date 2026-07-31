from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field


router = APIRouter(prefix="/api/team-sharing", tags=["team-sharing"])


class TeamSharingConfiguration(BaseModel):
    cloud_url: str
    session_code: str = Field(min_length=8, max_length=8)
    access_key: str = Field(min_length=20, max_length=128)
    display_name: str = Field(min_length=1, max_length=80)


class PublishingRequest(BaseModel):
    force: bool = False


@router.get("/status")
def status(request: Request):
    return request.app.state.team_sharing_service.as_dict()


@router.post("/configure")
def configure(body: TeamSharingConfiguration, request: Request):
    try:
        return request.app.state.team_sharing_service.configure(
            body.cloud_url,
            body.session_code,
            body.access_key,
            body.display_name,
        )
    except (ValueError, RuntimeError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/start")
async def start(body: PublishingRequest, request: Request):
    try:
        return await request.app.state.team_sharing_service.start(force=body.force)
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/stop")
async def stop(request: Request):
    return await request.app.state.team_sharing_service.stop()

