import asyncio
import os
import subprocess
from typing import List, Dict

_ffmpeg_initialized = False

def ensure_ffmpeg():
    global _ffmpeg_initialized
    if not _ffmpeg_initialized:
        try:
            import static_ffmpeg
            static_ffmpeg.add_paths()
        except Exception as e:
            print(f"[FFmpeg] static_ffmpeg init note: {e}")
        _ffmpeg_initialized = True

async def run_ffmpeg(args: List[str]):
    """Helper to run FFmpeg using subprocess.run in a thread pool for Windows stability."""
    ensure_ffmpeg()
    cmd = ["ffmpeg"] + args
    print(f"[FFmpeg] Running: {' '.join(cmd)}")
    
    def _run():
        res = subprocess.run(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding='utf-8',
            errors='ignore'
        )
        if res.returncode != 0:
            print(f"[FFmpeg Error] {res.stderr}")
            raise RuntimeError(f"FFmpeg failed with code {res.returncode}: {res.stderr}")
        return res.stdout

    return await asyncio.to_thread(_run)

async def extract_audio_for_ml(video_path: str, output_wav_path: str):
    """
    Extracts 16kHz mono WAV from video. 
    Required format for faster-whisper and pyannote.audio.
    """
    args = [
        "-y", # overwrite
        "-i", video_path,
        "-vn", # no video
        "-acodec", "pcm_s16le", # WAV format
        "-ar", "16000", # 16 kHz
        "-ac", "1", # mono
        output_wav_path
    ]
    await run_ffmpeg(args)
    return output_wav_path

async def cut_scene_lossless(video_path: str, start_time: str, end_time: str, output_path: str):
    """
    Losslessly cuts a scene from a video (no re-encoding).
    start_time and end_time can be in seconds or HH:MM:SS format.
    """
    args = [
        "-y",
        "-ss", str(start_time),
        "-to", str(end_time),
        "-i", video_path,
        "-c", "copy",
        output_path
    ]
    await run_ffmpeg(args)
    return output_path

async def mix_final_scene(
    original_video_path: str, 
    takes: List[Dict], 
    output_path: str,
    original_volume: float = 0.1
):
    """
    Mixes the recorded user audio takes over the original video.
    takes = [
        {"path": "take1.wav", "start_ms": 1500},
        {"path": "take2.wav", "start_ms": 4200}
    ]
    """
    if not takes:
        return original_video_path
        
    args = ["-y", "-i", original_video_path]
    
    filter_complex = []
    
    # Lower original volume and normalize to stereo
    filter_complex.append(f"[0:a]aformat=channel_layouts=stereo,volume={original_volume}[bg];")
    mix_elements = "[bg]"
    
    for i, take in enumerate(takes):
        args.extend(["-i", take["path"]])
        input_idx = i + 1
        delay_ms = int(take["start_ms"])
        
        # Normalize each take to stereo and apply delay
        filter_complex.append(f"[{input_idx}:a]aformat=channel_layouts=stereo,adelay={delay_ms}|{delay_ms}[a{input_idx}];")
        mix_elements += f"[a{input_idx}]"
        
    num_inputs = len(takes) + 1
    
    # Mix all audio streams together
    amix_str = f"{''.join(filter_complex)}{mix_elements}amix=inputs={num_inputs}:duration=first:dropout_transition=2[aout]"
    
    args.extend([
        "-filter_complex", amix_str,
        "-map", "0:v",     # Keep the original video stream
        "-map", "[aout]",  # Use the newly mixed audio stream
        "-c:v", "copy",    # Do not re-encode video (fast)
        "-c:a", "aac",     # Encode audio to AAC
        output_path
    ])
    
    await run_ffmpeg(args)
    return output_path
