import os
import json
from google import genai
from google.genai import types
from app.core.config import settings

def format_speaker_fallback(speaker_id: str, custom_characters: list = None, speaker_index: int = 0) -> str:
    if custom_characters and speaker_index < len(custom_characters):
        return custom_characters[speaker_index].strip()
    if speaker_id.startswith("SPEAKER_"):
        try:
            num = int(speaker_id.split("_")[1]) + 1
            return f"Персонаж {num}"
        except Exception:
            pass
    return f"Персонаж {speaker_index + 1}"

def enrich_manifest_with_llm(manifest_lines: list, custom_characters: list = None) -> list:
    """
    Takes the raw aligned lines (speaker, text, start, end) and uses Gemini 2.5 Flash
    to determine character names and acting cues, with smart fallback to clean character names.
    """
    # Track unique speakers in order of appearance
    unique_speakers = []
    for line in manifest_lines:
        spk = line.get("speaker", "SPEAKER_00")
        if spk not in unique_speakers:
            unique_speakers.append(spk)

    speaker_to_index = {spk: idx for idx, spk in enumerate(unique_speakers)}

    api_key = settings.GEMINI_API_KEY
    if not api_key or api_key == "your_api_key_here":
        print("GEMINI_API_KEY not found or default. Using clean character naming fallback...")
        return apply_fallback_enrichment(manifest_lines, unique_speakers, custom_characters)

    client = genai.Client(api_key=api_key)

    script_text = ""
    for line in manifest_lines:
        script_text += f'[{line["speaker"]}] ({line["start"]}-{line["end"]}): {line["text"]}\n'

    custom_hint = ""
    if custom_characters:
        custom_hint = f"Подсказка: в сцене участвуют персонажи: {', '.join(custom_characters)}."

    prompt = f"""
    Ты — профессиональный ИИ-режиссер дубляжа. 
    Ниже приведена транскрипция отрывка из фильма. 
    Звук был обработан нейросетью, которая разметила спикеров как 'SPEAKER_00', 'SPEAKER_01' и т.д.
    {custom_hint}

    Твои задачи:
    1. Понять по контексту разговора, кто эти персонажи (их имена, пол или архетипы, например "Северус Снейп", "Гарри Поттер", "Шрек").
    2. Для каждой реплики придумать **подсказку по интонации (acting cue)**, чтобы игроку было проще и веселее ее озвучивать. 
       Например: "[Шепотом, с паникой]", "[Громко, с сарказмом]", "[Плача]".
    3. Выдать немного адаптированный, красивый текст реплики (убрать слова-паразиты, если нейросеть ошиблась, сделать текст читаемым для суфлера).

    Выведи ТОЛЬКО валидный JSON строго в таком формате:
    [
      {{
        "speaker_id": "SPEAKER_00",
        "character_name": "СЕВЕРУС СНЕЙП",
        "acting_cue": "[Холодно, с презрением]",
        "clean_text": "..."
      }}
    ]

    Вот сценарий:
    {script_text}
    """

    try:
        response = client.models.generate_content(
            model='gemini-2.5-flash',
            contents=prompt,
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
            ),
        )
        
        llm_data = json.loads(response.text)
        enrichment_map = {item["speaker_id"]: item for item in llm_data}
        
        enriched_lines = []
        for line in manifest_lines:
            spk = line["speaker"]
            spk_idx = speaker_to_index.get(spk, 0)
            default_role = format_speaker_fallback(spk, custom_characters, spk_idx)
            
            enrichment = enrichment_map.get(spk)
            if enrichment and enrichment.get("character_name"):
                line["role_name"] = enrichment["character_name"]
                line["acting_cue"] = enrichment.get("acting_cue", "[Уверенно]")
                line["clean_text"] = enrichment.get("clean_text", line["text"])
            else:
                line["role_name"] = default_role
                line["acting_cue"] = "[Спокойно]"
                line["clean_text"] = line["text"]
                
            enriched_lines.append(line)
            
        return enriched_lines

    except Exception as e:
        print(f"LLM Enrichment note ({e}). Applying clean character naming fallback...")
        return apply_fallback_enrichment(manifest_lines, unique_speakers, custom_characters)

def apply_fallback_enrichment(manifest_lines: list, unique_speakers: list, custom_characters: list = None) -> list:
    speaker_to_index = {spk: idx for idx, spk in enumerate(unique_speakers)}
    enriched_lines = []
    
    for line in manifest_lines:
        text = line.get("text", "")
        cue = "[Спокойно]"
        if "?" in text:
            cue = "[С удивлением]"
        elif "!" in text:
            cue = "[Эмоционально, громко]"
        elif "..." in text:
            cue = "[Задумчиво, с паузой]"
            
        spk = line.get("speaker", "SPEAKER_00")
        spk_idx = speaker_to_index.get(spk, 0)
        
        line["role_name"] = format_speaker_fallback(spk, custom_characters, spk_idx)
        line["acting_cue"] = cue
        line["clean_text"] = text
        enriched_lines.append(line)
        
    return enriched_lines
