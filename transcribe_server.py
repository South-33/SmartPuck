import os
import tempfile
import traceback
from typing import Optional
from fastapi import FastAPI, UploadFile, File, Query, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from faster_whisper import WhisperModel
import uvicorn

app = FastAPI(
    title="SmartPuck Local Transcription Server",
    description="Local speech-to-text service running faster-whisper",
    version="1.0.0"
)

# Enable CORS for the local nextjs frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allow all for local dev ease, or customize to localhost ports
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Model cache to avoid reloading the model on every transcription request.
model_cache = {}

MODEL_PROFILES = {
    "auto": {
        "model": "small",
        "label": "Auto guide",
        "language": None,
        "note": "Small multilingual guide. Rerun Khmer with khmer-better when detected.",
    },
    "english-fast": {
        "model": "small.en",
        "label": "English fast",
        "language": "en",
        "note": "Small English-only model for cheap laptop defaults.",
    },
    "english": {
        "model": "small.en",
        "label": "English fast",
        "language": "en",
        "note": "Alias for english-fast.",
    },
    "khmer-better": {
        "model": "PhanithLIM/whisper-small-khmer-ct2",
        "label": "Khmer better",
        "language": "km",
        "note": "Khmer-specific small CT2 model.",
    },
    "khmer": {
        "model": "PhanithLIM/whisper-small-khmer-ct2",
        "label": "Khmer better",
        "language": "km",
        "note": "Alias for khmer-better.",
    },
    "khmer-tiny": {
        "model": "PhanithLIM/whisper-tiny-khmer-ct2",
        "label": "Khmer tiny",
        "language": "km",
        "note": "Lower-resource Khmer experiment.",
    },
    "high-quality": {
        "model": "turbo",
        "label": "High quality fallback",
        "language": None,
        "note": "Large-v3-turbo fallback for mixed or uncertain audio.",
    },
    "turbo": {
        "model": "turbo",
        "label": "High quality fallback",
        "language": None,
        "note": "Alias for high-quality.",
    },
    "small": {
        "model": "small",
        "label": "Small multilingual",
        "language": None,
        "note": "Built-in faster-whisper small model.",
    },
    "base": {
        "model": "base",
        "label": "Base multilingual",
        "language": None,
        "note": "Built-in faster-whisper base model.",
    },
}


def resolve_profile(model_name: str):
    key = (model_name or "auto").lower()
    profile = MODEL_PROFILES.get(key)
    if profile:
        return key, profile
    return key, {
        "model": model_name,
        "label": model_name,
        "language": None,
        "note": "Custom faster-whisper model id.",
    }


def get_model(resolved_model: str):

    # Detect if CUDA (GPU) is available in ctranslate2
    device = "cpu"
    try:
        import ctranslate2
        if ctranslate2.get_cuda_device_count() > 0:
            device = "cuda"
    except Exception:
        pass

    cache_key = (resolved_model, device)
    if cache_key in model_cache:
        return model_cache[cache_key]

    compute_type = "int8_float16" if device == "cuda" else "int8"
    print(f"[SmartPuck STT] Loading model '{resolved_model}' on device '{device}' with compute_type '{compute_type}'...")

    try:
        model = WhisperModel(resolved_model, device=device, compute_type=compute_type)
        model_cache[cache_key] = model
        return model
    except Exception as e:
        print(f"[SmartPuck STT] Failed to load model '{resolved_model}' on GPU: {e}")
        if device == "cuda":
            print("[SmartPuck STT] Retrying load on CPU fallback...")
            try:
                model = WhisperModel(resolved_model, device="cpu", compute_type="int8")
                model_cache[(resolved_model, "cpu")] = model
                return model
            except Exception as cpu_err:
                raise HTTPException(status_code=500, detail=f"CPU fallback failed: {cpu_err}")
        else:
            raise HTTPException(status_code=500, detail=f"Model load failed: {e}")


def should_reroute_to_khmer(profile_key: str, detected_language: Optional[str], language_probability: float):
    if profile_key != "auto":
        return False
    return detected_language == "km" and language_probability >= 0.35


def transcript_quality_flags(segments, language: Optional[str], language_probability: float):
    flags = []
    if language_probability < 0.5:
        flags.append("low_language_confidence")
    if not segments:
        flags.append("empty_transcript")
    repeated_short_segments = 0
    previous = None
    for segment in segments:
        text = segment.get("text", "")
        if previous and text == previous and len(text) < 80:
            repeated_short_segments += 1
        previous = text
    if repeated_short_segments >= 3:
        flags.append("repeated_segments")
    return flags


def run_transcription(temp_path: str, file_name: str, profile_key: str, language_override: Optional[str]):
    _, profile = resolve_profile(profile_key)
    resolved_model = profile["model"]
    language = language_override or profile.get("language")
    model = get_model(resolved_model)

    print(
        f"[SmartPuck STT] Transcribing file: {file_name} "
        f"(profile={profile_key}, model={resolved_model}, lang={language})..."
    )

    segments_iter, info = model.transcribe(
        temp_path,
        language=language,
        task="transcribe",
        vad_filter=True,
        beam_size=5,
        word_timestamps=False,
        condition_on_previous_text=False,
        compression_ratio_threshold=2.4,
        log_prob_threshold=-1.0,
        no_speech_threshold=0.6,
    )

    output_segments = []
    full_text_parts = []
    for segment in segments_iter:
        text = segment.text.strip()
        if text:
            output_segments.append({
                "start": round(segment.start, 2),
                "end": round(segment.end, 2),
                "text": text,
            })
            full_text_parts.append(text)

    language_probability = round(float(info.language_probability or 0), 4)
    return {
        "profile": profile_key,
        "profile_label": profile["label"],
        "model": resolved_model,
        "language": info.language,
        "language_probability": language_probability,
        "segments": output_segments,
        "full_text": " ".join(full_text_parts),
        "quality_flags": transcript_quality_flags(output_segments, info.language, language_probability),
    }

@app.get("/health")
async def health():
    # Helper to check if CUDA is detected
    cuda_detected = False
    try:
        import ctranslate2
        cuda_detected = ctranslate2.get_cuda_device_count() > 0
    except Exception:
        pass
    return {
        "status": "healthy",
        "cuda_detected": cuda_detected,
        "profiles": {
            key: {
                "label": value["label"],
                "model": value["model"],
                "language": value["language"],
                "note": value["note"],
            }
            for key, value in MODEL_PROFILES.items()
        },
        "loaded_models": list(model_cache.keys())
    }

@app.post("/transcribe")
async def transcribe(
    file: UploadFile = File(...),
    model_name: str = Query("auto"),
    language: str = Query(None), # e.g. "km" for Khmer, or None for auto-detect
):
    suffix = os.path.splitext(file.filename)[1] if file.filename else ".mp3"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as temp_file:
        content = await file.read()
        temp_file.write(content)
        temp_path = temp_file.name

    try:
        profile_key, _ = resolve_profile(model_name)
        result = run_transcription(temp_path, file.filename, profile_key, language)

        if should_reroute_to_khmer(
            profile_key,
            result["language"],
            result["language_probability"],
        ):
            print("[SmartPuck STT] Auto detected Khmer. Rerouting to khmer-better profile...")
            khmer_result = run_transcription(temp_path, file.filename, "khmer-better", "km")
            khmer_result["routed_from"] = result
            result = khmer_result

        print(
            f"[SmartPuck STT] Complete. language={result['language']} "
            f"prob={result['language_probability']:.2f} profile={result['profile']}"
        )
        return result
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Transcription failed: {str(e)}")
    finally:
        if os.path.exists(temp_path):
            try:
                os.remove(temp_path)
            except Exception:
                pass

if __name__ == "__main__":
    uvicorn.run("transcribe_server:app", host="127.0.0.1", port=8000, reload=True)
