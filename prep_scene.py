import os
import sys
import argparse
import asyncio
import json
import shutil

# Ensure backend directory is in sys.path
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
BACKEND_DIR = os.path.join(BASE_DIR, "backend")
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

from app.core.ffmpeg_tools import extract_audio_for_ml, cut_scene_lossless
from app.api.media import align_transcription_with_diarization
from app.api.llm import enrich_manifest_with_llm

STORAGE_MOVIES = os.path.join(BASE_DIR, "storage", "movies")
os.makedirs(STORAGE_MOVIES, exist_ok=True)

async def prepare_scene(
    video_source: str, 
    start_time: str = None, 
    end_time: str = None, 
    characters_str: str = None,
    output_name: str = None,
    whisper_model: str = "small"
):
    print("=" * 60)
    print("🎬 DubParty: Подготовка сцены для игры")
    print("=" * 60)

    if not os.path.exists(video_source):
        # Maybe it's located in storage/movies/
        alt_path = os.path.join(STORAGE_MOVIES, video_source)
        if os.path.exists(alt_path):
            video_source = alt_path
        else:
            raise FileNotFoundError(f"Файл не найден: {video_source}")

    base_filename = os.path.basename(video_source)
    name_no_ext, ext = os.path.splitext(base_filename)

    if output_name:
        final_video_name = output_name if output_name.endswith(".mp4") else f"{output_name}.mp4"
    elif start_time or end_time:
        final_video_name = f"{name_no_ext}_cut.mp4"
    else:
        final_video_name = f"{name_no_ext}.mp4"

    target_video_path = os.path.join(STORAGE_MOVIES, final_video_name)

    # 1. Cut scene if timestamps provided
    if start_time and end_time:
        print(f"\n✂️ [1/5] Нарезка сцены с {start_time} по {end_time} без потери качества...")
        await cut_scene_lossless(video_source, start_time, end_time, target_video_path)
    else:
        print(f"\n📁 [1/5] Использование видео целиком...")
        if os.path.abspath(video_source) != os.path.abspath(target_video_path):
            shutil.copy2(video_source, target_video_path)

    # 2. Extract audio
    audio_wav_path = target_video_path.rsplit(".", 1)[0] + "_audio.wav"
    print(f"🎵 [2/5] Извлечение аудио для нейросетей (16kHz WAV)...")
    await extract_audio_for_ml(target_video_path, audio_wav_path)

    # 3. Transcribe with Whisper (RTX 3060)
    print(f"🗣️ [3/5] Распознавание речи через faster-whisper ({whisper_model})...")
    from app.ml.transcriber import transcribe_audio
    transcription = transcribe_audio(audio_wav_path, model_size=whisper_model)
    segments = transcription.get("segments", [])
    print(f"   ✓ Распознано реплик: {len(segments)}")

    # 4. Diarization with PyAnnote (RTX 3060)
    print(f"👥 [4/5] Разделение голосов по спикерам (PyAnnote diarization)...")
    from app.ml.diarizer import diarize_audio
    diarization = diarize_audio(audio_wav_path)
    aligned_lines = align_transcription_with_diarization(segments, diarization)

    # Parse custom characters if supplied
    custom_chars = [c.strip() for c in characters_str.split(",")] if characters_str else None

    # 5. Enrichment & Character Naming
    print(f"🎭 [5/5] Назначение персонажей и режиссерских подсказок...")
    enriched_lines = enrich_manifest_with_llm(aligned_lines, custom_characters=custom_chars)

    # Summary of characters
    unique_roles = []
    for l in enriched_lines:
        r = l.get("role_name", "Персонаж")
        if r not in unique_roles:
            unique_roles.append(r)

    # 6. Save Manifest
    manifest_data = {
        "video_filename": final_video_name,
        "characters": unique_roles,
        "lines": enriched_lines
    }

    manifest_path = target_video_path.rsplit(".", 1)[0] + "_manifest.json"
    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump(manifest_data, f, indent=2, ensure_ascii=False)

    # Clean up temp WAV
    if os.path.exists(audio_wav_path):
        os.remove(audio_wav_path)

    print("\n" + "=" * 60)
    print(f"🎉 СЦЕНА УСПЕШНО ГОТОВА!")
    print(f"📹 Видео: {final_video_name}")
    print(f"📄 Манифест: {os.path.basename(manifest_path)}")
    print(f"👥 Роли в сцене ({len(unique_roles)}): {', '.join(unique_roles)}")
    print(f"💬 Всего фраз: {len(enriched_lines)}")
    print("=" * 60 + "\n")

def main():
    parser = argparse.ArgumentParser(description="Подготовка сцены фильма для DubParty на локальном GPU.")
    parser.add_argument("video", help="Путь к исходному видеофайлу")
    parser.add_argument("--start", help="Время начала (секунды или ЧЧ:ММ:СС, например: 00:01:15)", default=None)
    parser.add_argument("--end", help="Время окончания (секунды или ЧЧ:ММ:СС, например: 00:03:45)", default=None)
    parser.add_argument("--characters", "-c", help="Имена персонажей через запятую, например: 'Шрек, Осел, Фиона'", default=None)
    parser.add_argument("--output", "-o", help="Имя итогового файла (например: shrek_dinner.mp4)", default=None)
    parser.add_argument("--model", "-m", help="Размер модели faster-whisper (tiny, base, small, medium)", default="small")

    args = parser.parse_args()

    asyncio.run(prepare_scene(
        video_source=args.video,
        start_time=args.start,
        end_time=args.end,
        characters_str=args.characters,
        output_name=args.output,
        whisper_model=args.model
    ))

if __name__ == "__main__":
    main()
