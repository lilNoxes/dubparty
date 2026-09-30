import gc
import torch
from pyannote.audio import Pipeline
from app.core.config import settings

def diarize_audio(audio_path: str):
    """
    Diarizes audio (detects who spoke when) using pyannote.audio.
    Loads the pipeline, processes audio, and immediately unloads to free VRAM.
    """
    if not settings.HF_AUTH_TOKEN:
        raise ValueError(
            "HF_AUTH_TOKEN is missing in .env! "
            "Diarization requires a HuggingFace token. "
            "Make sure you accepted the terms at https://hf.co/pyannote/speaker-diarization-3.1"
        )

    print(f"[Diarizer] Loading PyAnnote Speaker Diarization pipeline...")
    
    # Load pipeline
    pipeline = Pipeline.from_pretrained(
        "pyannote/speaker-diarization-3.1",
        token=settings.HF_AUTH_TOKEN
    )
    
    import soundfile as sf
    data, sample_rate = sf.read(audio_path)
    waveform = torch.from_numpy(data).float()
    if waveform.ndim == 1:
        waveform = waveform.unsqueeze(0)
    else:
        waveform = waveform.t()
        
    audio_input = {"waveform": waveform, "sample_rate": sample_rate}

    # Send pipeline to GPU if available, else CPU
    try:
        if settings.CUDA_DEVICE == "cuda" and torch.cuda.is_available():
            pipeline.to(torch.device("cuda"))
            print(f"[Diarizer] Running diarization on {audio_path} using CUDA...")
            diarization = pipeline(audio_input)
        else:
            print(f"[Diarizer] Running diarization on {audio_path} using CPU...")
            diarization = pipeline(audio_input)
    except Exception as e:
        print(f"[Diarizer] CUDA failed ({e}). Falling back to CPU...")
        pipeline.to(torch.device("cpu"))
        diarization = pipeline(audio_input)
    
    results = []
    annotation = getattr(diarization, "speaker_diarization", diarization)
    for turn, _, speaker in annotation.itertracks(yield_label=True):
        results.append({
            "start": round(turn.start, 3),
            "end": round(turn.end, 3),
            "speaker": speaker # e.g. "SPEAKER_00"
        })
        
    print(f"[Diarizer] Diarization complete. Freeing VRAM...")
    
    # ----------------------------------------------------
    # CRITICAL VRAM RECLAMATION (RTX 3060 6GB constraint)
    # ----------------------------------------------------
    del pipeline
    gc.collect()
    if torch.cuda.is_available():
        torch.cuda.empty_cache()
        
    return results
