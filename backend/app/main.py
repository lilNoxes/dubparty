import os
import sys
from typing import List

# Ensure backend directory is in sys.path for robust imports across environments
BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="DubParty API", version="1.0.0")

# Enable CORS for local network access
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Setup paths
BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
FRONTEND_DIR = os.path.join(BASE_DIR, "frontend")
STORAGE_DIR = os.path.join(BASE_DIR, "storage")

# Mount static files for frontend and storage
app.mount("/host", StaticFiles(directory=os.path.join(FRONTEND_DIR, "host"), html=True), name="host")
app.mount("/mobile", StaticFiles(directory=os.path.join(FRONTEND_DIR, "mobile"), html=True), name="mobile")
app.mount("/media", StaticFiles(directory=STORAGE_DIR), name="media")

from fastapi.responses import RedirectResponse
from app.api.media import router as media_router
from app.api.game import router as game_router

@app.get("/")
def root():
    return RedirectResponse(url="/host/")

app.include_router(media_router, prefix="/api/media", tags=["media"])
app.include_router(game_router, prefix="/api/game", tags=["game"])

# Simple WebSocket connection manager for real-time room sync
class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        self.active_connections.remove(websocket)

    async def broadcast(self, message: dict):
        for connection in self.active_connections:
            await connection.send_json(message)

manager = ConnectionManager()

@app.websocket("/ws/{room_id}/{client_id}")
async def websocket_endpoint(websocket: WebSocket, room_id: str, client_id: str):
    await manager.connect(websocket)
    await manager.broadcast({"action": "player_joined", "room_id": room_id, "player": client_id})
    try:
        while True:
            data = await websocket.receive_json()
            # Broadcast the state change to everyone
            await manager.broadcast({"room_id": room_id, "client_id": client_id, "data": data})
    except WebSocketDisconnect:
        manager.disconnect(websocket)
        await manager.broadcast({"action": "player_left", "room_id": room_id, "player": client_id})

@app.get("/api/health")
def health_check():
    return {"status": "ok", "message": "DubParty backend is running"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
