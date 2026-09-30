import gc
import torch
from faster_whisper import WhisperModel
from app.core.config import settings

def transcribe_audio(audio_path: str, model_size: str = "small"):
    """
    Transcribes audio using faster-whisper.
    Loads the model, processes audio, and immediately unloads the model to free VRAM.
    We use 'small' or 'medium' model_size.
    """
    print(f"[Transcriber] Attempting transcription on {settings.CUDA_DEVICE} ({settings.COMPUTE_TYPE})...")
    
    try:
        model = WhisperModel(
            model_size, 
            device=settings.CUDA_DEVICE, 
            compute_type=settings.COMPUTE_TYPE
        )
        segments, info = model.transcribe(audio_path, beam_size=5, word_timestamps=True)
        # Force evaluation of generator to ensure CUDA doesn't fail later
        segments = list(segments)
    except Exception as e:
        print(f"[Transcriber] CUDA failed ({e}). Falling back to CPU/int8...")
        model = WhisperModel(
            model_size, 
            device="cpu", 
            compute_type="int8"
        )
        segments, info = model.transcribe(audio_path, beam_size=5, word_timestamps=True)
        segments = list(segments)
    
    print(f"[Transcriber] Parsing segments...")
    results = []
    for segment in segments:
        words = [{"word": w.word, "start": w.start, "end": w.end} for w in segment.words] if segment.words else []
        results.append({
            "start": segment.start,
            "end": segment.end,
            "text": segment.text.strip(),
            "words": words
        })
        
    print(f"[Transcriber] Transcription complete. Freeing VRAM...")
    
    # ----------------------------------------------------
    # CRITICAL VRAM RECLAMATION (RTX 3060 6GB constraint)
    # ----------------------------------------------------
    del model
    gc.collect()
    if torch.cuda.is_available():
        torch.cuda.empty_cache()
        
    return {
        "language": info.language,
        "language_probability": info.language_probability,
        "segments": results
    }
