from __future__ import annotations

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

router = APIRouter(tags=["websocket"])


async def _socket(websocket: WebSocket, channel: str) -> None:
    service = websocket.app.state.telemetry_service
    await service.hub.connect(channel, websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        service.hub.disconnect(channel, websocket)
    except Exception:
        service.hub.disconnect(channel, websocket)


@router.websocket("/ws/telemetry")
async def telemetry_socket(websocket: WebSocket) -> None:
    await _socket(websocket, "telemetry")


@router.websocket("/ws/strategy")
async def strategy_socket(websocket: WebSocket) -> None:
    await _socket(websocket, "strategy")


@router.websocket("/ws/recommendations")
async def recommendations_socket(websocket: WebSocket) -> None:
    await _socket(websocket, "recommendations")
