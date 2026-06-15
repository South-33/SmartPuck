import os
import tempfile
import traceback
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

# Model cache to avoid reloading the model on every transcription request
model_cache = {}

def get_model(model_name: str):
    # Map user-friendly model queries to faster-whisper / Hugging Face names
    model_mapping = {
        "turbo": "turbo",
        "large-v3-turbo": "turbo",
        "medium": "medium",
        "small": "small",
        "base": "base",
        "khmer": "Tnaot/whisper-large-v3-khmer-ct2"
    }
    resolved_model = model_mapping.get(model_name.lower(), model_name)

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
        "loaded_models": list(model_cache.keys())
    }

@app.post("/transcribe")
async def transcribe(
    file: UploadFile = File(...),
    model_name: str = Query("turbo"),
    language: str = Query(None), # e.g. "km" for Khmer, or None for auto-detect
):
    suffix = os.path.splitext(file.filename)[1] if file.filename else ".mp3"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as temp_file:
        content = await file.read()
        temp_file.write(content)
        temp_path = temp_file.name

    try:
        # Load the requested model (cached)
        model = get_model(model_name)
        
        print(f"[SmartPuck STT] Transcribing file: {file.filename} (model={model_name}, lang={language})...")

        # Run transcription
        segments, info = model.transcribe(
            temp_path,
            language=language,
            task="transcribe",
            vad_filter=True,
            beam_size=5
        )

        output_segments = []
        full_text_parts = []
        for segment in segments:
            text = segment.text.strip()
            if text:
                output_segments.append({
                    "start": round(segment.start, 2),
                    "end": round(segment.end, 2),
                    "text": text
                })
                full_text_parts.append(text)

        full_text = " ".join(full_text_parts)
        print(f"[SmartPuck STT] Complete. Detected language: {info.language} ({info.language_probability:.2f})")

        return {
            "language": info.language,
            "language_probability": round(info.language_probability, 4),
            "segments": output_segments,
            "full_text": full_text
        }
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
