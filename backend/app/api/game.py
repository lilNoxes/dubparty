import os
import uuid
import json
from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from typing import Dict, List

from app.core.ffmpeg_tools import mix_final_scene

router = APIRouter()

STORAGE_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(__file__)))), "storage")
TAKES_DIR = os.path.join(STORAGE_DIR, "takes")
MOVIES_DIR = os.path.join(STORAGE_DIR, "movies")
SCENES_DIR = os.path.join(STORAGE_DIR, "scenes")

# In-memory store for game rooms. 
rooms: Dict[str, Dict] = {}

@router.post("/create")
def create_room(manifest_filename: str):
    """Creates a new game lobby for a specific movie scene."""
    manifest_path = os.path.join(MOVIES_DIR, manifest_filename)
    if not os.path.exists(manifest_path):
        raise HTTPException(status_code=404, detail="Manifest not found")
        
    with open(manifest_path, "r", encoding="utf-8") as f:
        manifest_data = json.load(f)

    room_code = uuid.uuid4().hex[:4].upper()
    rooms[room_code] = {
        "manifest": manifest_data,
        "takes": [],
        "status": "lobby"
    }
    return {"room_code": room_code, "status": "created"}

@router.get("/{room_code}")
def get_room_state(room_code: str):
    if room_code not in rooms:
        raise HTTPException(status_code=404, detail="Room not found")
    return rooms[room_code]

@router.post("/{room_code}/upload_take")
async def upload_take(
    room_code: str, 
    line_id: int = Form(...), 
    start_ms: int = Form(...), 
    file: UploadFile = File(...)
):
    if room_code not in rooms:
        raise HTTPException(status_code=404, detail="Room not found")
        
    # the frontend currently sends .webm from browsers
    ext = file.filename.split('.')[-1] if '.' in file.filename else 'webm'
    take_filename = f"{room_code}_line{line_id}_{uuid.uuid4().hex[:6]}.{ext}"
    take_path = os.path.join(TAKES_DIR, take_filename)
    
    with open(take_path, "wb") as buffer:
        buffer.write(await file.read())
        
    take_record = {
        "path": take_path,
        "start_ms": start_ms
    }
    
    rooms[room_code]["takes"].append(take_record)
    
    return {"status": "success"}

@router.post("/{room_code}/reset")
def reset_room_takes(room_code: str):
    """Resets recorded takes to allow re-recording the same scene."""
    if room_code not in rooms:
        raise HTTPException(status_code=404, detail="Room not found")
    rooms[room_code]["takes"] = []
    rooms[room_code]["status"] = "lobby"
    return {"status": "success", "message": "Room takes cleared"}

@router.post("/{room_code}/mix")
async def mix_room_scene(room_code: str):
    if room_code not in rooms:
        raise HTTPException(status_code=404, detail="Room not found")
        
    room = rooms[room_code]
    video_filename = room["manifest"]["video_filename"]
    original_video_path = os.path.join(MOVIES_DIR, video_filename)
    
    output_filename = f"{room_code}_final.mp4"
    output_path = os.path.join(SCENES_DIR, output_filename)
    
    try:
        await mix_final_scene(
            original_video_path=original_video_path,
            takes=room["takes"],
            output_path=output_path,
            original_volume=0.1
        )
        room["status"] = "finished"
        room["final_video_url"] = f"/media/scenes/{output_filename}"
        return {"status": "success", "url": room["final_video_url"]}
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
