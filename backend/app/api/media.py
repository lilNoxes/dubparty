import os
import json
from fastapi import APIRouter, UploadFile, File, BackgroundTasks, HTTPException
from typing import List, Dict

from app.core.ffmpeg_tools import extract_audio_for_ml

router = APIRouter()

STORAGE_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(__file__)))), "storage")
MOVIES_DIR = os.path.join(STORAGE_DIR, "movies")
SCENES_DIR = os.path.join(STORAGE_DIR, "scenes")

def align_transcription_with_diarization(segments: List[Dict], diarization: List[Dict]) -> List[Dict]:
    """
    Assigns each transcribed segment to a speaker by calculating overlap.
    """
    aligned_lines = []
    
    for seg in segments:
        seg_start = seg["start"]
        seg_end = seg["end"]
        
        best_speaker = "UNKNOWN"
        max_overlap = 0
        
        for d in diarization:
            # Calculate overlap duration
            overlap_start = max(seg_start, d["start"])
            overlap_end = min(seg_end, d["end"])
            overlap = max(0, overlap_end - overlap_start)
            
            if overlap > max_overlap:
                max_overlap = overlap
                best_speaker = d["speaker"]
                
        aligned_lines.append({
            "start": round(seg_start, 3),
            "end": round(seg_end, 3),
            "speaker": best_speaker,
            "text": seg["text"]
        })
        
    return aligned_lines

async def process_video_task(video_filename: str):
    video_path = os.path.join(MOVIES_DIR, video_filename)
    audio_path = video_path.rsplit(".", 1)[0] + "_audio.wav"
    manifest_path = video_path.rsplit(".", 1)[0] + "_manifest.json"
    
    try:
        # 1. Extract audio
        print(f"[{video_filename}] Extracting audio...")
        await extract_audio_for_ml(video_path, audio_path)
        
        # 2. Transcribe (Lazy import for cloud compatibility)
        print(f"[{video_filename}] Transcribing...")
        try:
            from app.ml.transcriber import transcribe_audio
            transcription_result = transcribe_audio(audio_path, model_size="small")
        except ImportError:
            raise RuntimeError("faster-whisper is not installed. Use prep_scene.py on your local PC.")
        
        # 3. Diarize (Lazy import for cloud compatibility)
        print(f"[{video_filename}] Diarizing...")
        try:
            from app.ml.diarizer import diarize_audio
            diarization_result = diarize_audio(audio_path)
        except ImportError:
            raise RuntimeError("pyannote.audio is not installed. Use prep_scene.py on your local PC.")
        
        # 4. Align
        print(f"[{video_filename}] Aligning...")
        lines = align_transcription_with_diarization(transcription_result["segments"], diarization_result)
        
        # 4.5 LLM Enrichment (Gemini 2.5 Flash)
        print(f"[{video_filename}] AI Enrichment (Gemini)...")
        from app.api.llm import enrich_manifest_with_llm
        lines = enrich_manifest_with_llm(lines)
        
        # 5. Save manifest
        manifest = {
            "video_filename": video_filename,
            "lines": lines
        }
        with open(manifest_path, "w", encoding="utf-8") as f:
            json.dump(manifest, f, indent=2, ensure_ascii=False)
            
        print(f"[{video_filename}] Processing complete. Manifest saved.")
        
    except Exception as e:
        print(f"[{video_filename}] Error during processing: {e}")

@router.post("/upload")
async def upload_video(background_tasks: BackgroundTasks, file: UploadFile = File(...)):
    """Uploads a video and kicks off the background ML processing."""
    file_path = os.path.join(MOVIES_DIR, file.filename)
    with open(file_path, "wb") as buffer:
        buffer.write(await file.read())
        
    background_tasks.add_task(process_video_task, file.filename)
    
    return {
        "status": "success", 
        "message": "Video uploaded and processing started.",
        "filename": file.filename
    }

@router.get("/manifests")
def list_manifests():
    """Lists all processed videos and their manifests with full metadata for the scene library."""
    manifests = []
    if os.path.exists(MOVIES_DIR):
        for f in os.listdir(MOVIES_DIR):
            if f.endswith("_manifest.json") or (f.endswith(".json") and f != "demo.json"):
                try:
                    with open(os.path.join(MOVIES_DIR, f), "r", encoding="utf-8") as mf:
                        data = json.load(mf)
                        data["manifest_filename"] = f
                        
                        # Infer unique characters if not explicitly defined
                        if "characters" not in data or not data["characters"]:
                            chars = []
                            for line in data.get("lines", []):
                                r = line.get("role_name", "Персонаж")
                                if r not in chars:
                                    chars.append(r)
                            data["characters"] = chars
                            
                        # Infer duration in seconds
                        lines = data.get("lines", [])
                        data["lines_count"] = len(lines)
                        if lines:
                            data["duration_sec"] = round(max(l.get("end", 0) for l in lines))
                        else:
                            data["duration_sec"] = 0
                            
                        # Human-readable title
                        video_fn = data.get("video_filename", f)
                        clean_title = video_fn.rsplit(".", 1)[0].replace("_cut", "").replace("[720p]", "").replace("[1080p]", "").strip()
                        data["title"] = clean_title
                        data["video_url"] = f"/media/movies/{video_fn}"
                        
                        manifests.append(data)
                except Exception as e:
                    print(f"Error loading manifest {f}: {e}")
    return manifests


from pydantic import BaseModel

class ManifestUpdateData(BaseModel):
    manifest_filename: str
    manifest_data: dict

@router.post("/manifests/update")
def update_manifest(data: ManifestUpdateData):
    file_path = os.path.join(MOVIES_DIR, data.manifest_filename)
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Manifest not found")
        
    with open(file_path, "w", encoding="utf-8") as f:
        json.dump(data.manifest_data, f, indent=2, ensure_ascii=False)
        
    return {"status": "success", "message": "Manifest updated successfully"}
