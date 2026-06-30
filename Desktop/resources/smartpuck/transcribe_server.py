import os
import sys

# Configure local Hugging Face cache directory inside the project to avoid polluting C drive
if not os.environ.get("HF_HOME"):
    os.environ["HF_HOME"] = os.path.join(os.path.dirname(os.path.abspath(__file__)), "models")

import tempfile
import traceback
import subprocess
import shutil
import asyncio
from typing import Optional, Tuple

# Auto-resolve Windows DLL search paths for pip-installed nvidia-cu12 packages
if sys.platform == "win32":
    for lib in ["cublas", "cudnn", "cuda_nvrtc", "cuda_runtime"]:
        try:
            import importlib
            mod = importlib.import_module(f"nvidia.{lib}")
            if hasattr(mod, "__path__"):
                lib_bin = os.path.join(list(mod.__path__)[0], "bin")
                if os.path.isdir(lib_bin):
                    os.add_dll_directory(lib_bin)
                    print(f"[SmartPuck STT] Added Windows DLL directory: {lib_bin}")
        except Exception:
            pass
from fastapi import FastAPI, UploadFile, File, Query, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from faster_whisper import WhisperModel
from pydantic import BaseModel, Field
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


class LocalTranscriptionRequest(BaseModel):
    audio_path: str
    model_name: str = "auto"
    language: Optional[str] = None
    denoise_mode: str = "auto"  # "off", "auto", "strong"
    normalize: bool = True
    beam_size: int = Field(default=5, ge=1, le=10)

MODEL_PROFILES = {
    "auto": {
        "model": "small",
        "label": "Khmer + English auto",
        "language": None,
        "note": "Pause-aware bilingual routing to English and Khmer specialists.",
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


cuda_disabled = False


def get_model(resolved_model: str, force_cpu: bool = False):
    global cuda_disabled

    # Detect if CUDA (GPU) is available in ctranslate2
    device = "cpu"
    if not force_cpu and not cuda_disabled:
        try:
            import ctranslate2
            if ctranslate2.get_cuda_device_count() > 0:
                device = "cuda"
        except Exception:
            pass

    cache_key = (resolved_model, device)
    if cache_key in model_cache:
        return model_cache[cache_key]

    compute_type = "float16" if device == "cuda" else "int8"
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


def average_logprob(result: dict) -> float:
    segments = result.get("segments", [])
    return sum(s.get("avg_logprob", -1.0) for s in segments) / len(segments) if segments else -1.0


def contains_khmer(text: str) -> bool:
    return any("\u1780" <= char <= "\u17ff" for char in (text or ""))


def prefer_khmer_result(original: dict, khmer_result: dict) -> bool:
    return original.get("language") == "km"


def should_upgrade_uncertain_multilingual(profile_key: str, result: dict) -> bool:
    return (
        profile_key == "auto"
        and result.get("language") != "km"
        and float(result.get("language_probability") or 0) < 0.80
    )


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


df_model_cache = None
DENOISE_ATTEN_LIMIT_DB = float(os.getenv("SMARTPUCK_DENOISE_ATTEN_DB", "32"))

def get_df_model():
    global df_model_cache
    if df_model_cache is not None:
        return df_model_cache
    print("[SmartPuck STT] Initializing DeepFilterNet model...")
    try:
        from df.enhance import init_df
        import torch
    except ImportError:
        raise HTTPException(
            status_code=500,
            detail=(
                "DeepFilterNet (df) package is not installed. "
                "To use denoising, please run: pip install deepfilternet"
            )
        )
    model, df_state, _ = init_df()
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    if device.type == "cuda":
        print(f"[SmartPuck STT] Moving DeepFilterNet model to GPU ({torch.cuda.get_device_name(0)})...")
        model = model.to(device).eval()
    else:
        print("[SmartPuck STT] DeepFilterNet model loaded on CPU.")
    df_model_cache = (model, df_state, device)
    print("[SmartPuck STT] DeepFilterNet model loaded successfully.")
    return df_model_cache

def run_denoising(input_wav_48k: str, output_wav_48k: str):
    try:
        import torch
        import soundfile as sf
        from df.enhance import enhance
    except ImportError:
        raise HTTPException(
            status_code=500,
            detail=(
                "DeepFilterNet (df) package is not installed. "
                "To use denoising, please run: pip install deepfilternet"
            )
        )

    model, df_state, device = get_df_model()
    data, samplerate = sf.read(input_wav_48k)
    audio_tensor = torch.from_numpy(data).float()
    if audio_tensor.ndim == 1:
        audio_tensor = audio_tensor.unsqueeze(0)
    elif audio_tensor.shape[0] > audio_tensor.shape[1]:
        audio_tensor = audio_tensor.T

    # Moderate suppression keeps speech natural while reducing fan/static noise.
    print(f"[SmartPuck STT] DeepFilterNet attenuation limit: {DENOISE_ATTEN_LIMIT_DB:g} dB")
    audio_tensor = audio_tensor.to(device)
    enhanced_tensor = enhance(
        model, df_state, audio_tensor, atten_lim_db=DENOISE_ATTEN_LIMIT_DB
    )
    enhanced_data = enhanced_tensor.squeeze(0).cpu().numpy()
    sf.write(output_wav_48k, enhanced_data, 48000)


def preprocess_audio(audio_path: str, denoise_mode: str, normalize: bool, denoised_output_path: Optional[str] = None) -> Tuple[str, list]:
    temp_files = []
    current_path = audio_path
    should_denoise = (denoise_mode == "strong")

    try:
        if normalize or should_denoise:
            if should_denoise:
                # Resample/normalize to 48kHz mono WAV
                fd, temp_48k = tempfile.mkstemp(suffix="_48k.wav")
                os.close(fd)
                temp_files.append(temp_48k)

                filter_str = "anull"
                cmd = [
                    "ffmpeg", "-y", "-i", current_path,
                    "-filter:a", filter_str,
                    "-ar", "48000", "-ac", "1",
                    temp_48k
                ]
                print(f"[SmartPuck STT] Resampling & normalizing to 48k: {cmd}")
                subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True)

                # Run DeepFilterNet denoising
                fd, denoised_48k = tempfile.mkstemp(suffix="_denoised_48k.wav")
                os.close(fd)
                temp_files.append(denoised_48k)

                print("[SmartPuck STT] Running DeepFilterNet3 speech enhancement...")
                run_denoising(temp_48k, denoised_48k)

                # Resample back to 16kHz for Whisper
                fd, final_16k = tempfile.mkstemp(suffix="_final_16k.wav")
                os.close(fd)
                temp_files.append(final_16k)

                cmd_16k = [
                    "ffmpeg", "-y", "-i", denoised_48k,
                    "-filter:a", (
                        "acompressor=threshold=-24dB:ratio=3:attack=20:release=250:makeup=2dB,"
                        "loudnorm=I=-16:TP=-1.5:LRA=7"
                    ) if normalize else "anull",
                    "-ar", "16000", "-ac", "1",
                    final_16k
                ]
                subprocess.run(cmd_16k, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True)
                current_path = final_16k

                # Save a persistent copy of resampled denoised audio if requested
                if denoised_output_path:
                    print(f"[SmartPuck STT] Copying final denoised 16kHz WAV to persistent path: {denoised_output_path}")
                    try:
                        shutil.copy2(final_16k, denoised_output_path)
                    except Exception as copy_err:
                        print(f"[SmartPuck STT] Failed to copy denoised file: {copy_err}")
            else:
                # Just normalize and resample to 16kHz
                fd, normalized_16k = tempfile.mkstemp(suffix="_norm_16k.wav")
                os.close(fd)
                temp_files.append(normalized_16k)

                cmd = [
                    "ffmpeg", "-y", "-i", current_path,
                    "-filter:a", (
                        "acompressor=threshold=-24dB:ratio=3:attack=20:release=250:makeup=2dB,"
                        "loudnorm=I=-16:TP=-1.5:LRA=7"
                    ),
                    "-ar", "16000", "-ac", "1",
                    normalized_16k
                ]
                print(f"[SmartPuck STT] Normalizing & resampling to 16k: {cmd}")
                subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True)
                current_path = normalized_16k
                if denoised_output_path:
                    try:
                        shutil.copy2(normalized_16k, denoised_output_path)
                    except Exception as copy_err:
                        print(f"[SmartPuck STT] Failed to persist normalized audio: {copy_err}")

        return current_path, temp_files
    except Exception as e:
        for f in temp_files:
            if os.path.exists(f):
                try: os.remove(f)
                except: pass
        raise e

def run_transcription(
    temp_path: str,
    file_name: str,
    profile_key: str,
    language_override: Optional[str],
    denoise_mode: str = "off",
    normalize: bool = False,
    denoised_output_path: Optional[str] = None,
    force_cpu: bool = False,
    original_audio_path: Optional[str] = None,
    skip_denoise_if_uncertain: bool = False,
    beam_size: int = 5,
):
    if profile_key == "auto" and not language_override:
        return run_bilingual_transcription(
            temp_path,
            file_name,
            denoise_mode=denoise_mode,
            normalize=normalize,
            denoised_output_path=denoised_output_path,
            force_cpu=force_cpu,
            original_audio_path=original_audio_path,
            beam_size=beam_size,
        )

    if denoise_mode == "auto":
        raw_output_path = f"{denoised_output_path}.normalized-candidate" if denoised_output_path else None
        denoised_output_candidate = f"{denoised_output_path}.denoised-candidate" if denoised_output_path else None

        def select_processed_audio(source_path: Optional[str]):
            if not denoised_output_path or not source_path:
                return
            try:
                shutil.copy2(source_path, denoised_output_path)
            except Exception as copy_err:
                print(f"[SmartPuck STT] Failed to select processed audio: {copy_err}")
            finally:
                for candidate in (raw_output_path, denoised_output_candidate):
                    if candidate and os.path.exists(candidate):
                        try:
                            os.remove(candidate)
                        except OSError:
                            pass

        print("[SmartPuck STT] Denoise mode is 'auto'. Running first-pass raw/normalized transcription...")
        raw_result = run_transcription_inner(
            temp_path, file_name, profile_key, language_override,
            denoise_mode="off", normalize=normalize,
            denoised_output_path=raw_output_path, force_cpu=force_cpu,
            original_audio_path=original_audio_path,
            beam_size=1  # Fast language identification routing pass
        )

        # Calculate raw avg logprob
        raw_segments = raw_result.get("segments", [])
        raw_avg = sum(s.get("avg_logprob", -1.0) for s in raw_segments) / len(raw_segments) if raw_segments else -1.0
        print(f"[SmartPuck STT] Raw transcript avg logprob: {raw_avg:.4f}")

        # Classification/Routing early exit to prevent redundant denoising
        if skip_denoise_if_uncertain and profile_key == "auto":
            is_khmer = (raw_result.get("language") == "km" and float(raw_result.get("language_probability") or 0) >= 0.35)
            is_uncertain = (raw_result.get("language") != "km" and float(raw_result.get("language_probability") or 0) < 0.80)
            if is_khmer or is_uncertain:
                print("[SmartPuck STT] Routing pass completed. Bypassing first-pass denoise to run on target model.")
                raw_result["denoise_applied"] = False
                raw_result["raw_avg_logprob"] = raw_avg
                select_processed_audio(raw_output_path)
                return raw_result

        # If low confidence, trigger denoise
        if raw_avg < -0.35:
            print(f"[SmartPuck STT] Confidence {raw_avg:.4f} < -0.35. Triggering DeepFilterNet3 denoising...")
            denoised_result = run_transcription_inner(
                temp_path, file_name, profile_key, language_override,
                denoise_mode="strong", normalize=normalize,
                denoised_output_path=denoised_output_candidate, force_cpu=force_cpu,
                original_audio_path=original_audio_path,
                beam_size=beam_size
            )

            denoised_segments = denoised_result.get("segments", [])
            denoised_avg = sum(s.get("avg_logprob", -1.0) for s in denoised_segments) / len(denoised_segments) if denoised_segments else -1.0
            print(f"[SmartPuck STT] Denoised transcript avg logprob: {denoised_avg:.4f}")

            # Segment log-probability has small run-to-run variance. Keep the
            # cleaner audio when ASR confidence is effectively tied.
            if denoised_avg >= raw_avg - 0.03:
                print("[SmartPuck STT] Denoised transcript is better. Selecting denoised transcript.")
                denoised_result["denoise_applied"] = True
                denoised_result["raw_avg_logprob"] = raw_avg
                denoised_result["denoised_avg_logprob"] = denoised_avg
                select_processed_audio(denoised_output_candidate)
                return denoised_result
            else:
                print("[SmartPuck STT] Raw transcript has better/equal confidence. Selecting raw transcript.")
                raw_result["denoise_applied"] = False
                raw_result["raw_avg_logprob"] = raw_avg
                raw_result["denoised_avg_logprob"] = denoised_avg
                select_processed_audio(raw_output_path)
                return raw_result
        else:
            print("[SmartPuck STT] Raw transcript confidence is good. Skipping denoise.")
            raw_result["denoise_applied"] = False
            raw_result["raw_avg_logprob"] = raw_avg
            select_processed_audio(raw_output_path)
            # If the raw_result was computed with beam_size=1 and they requested beam_size > 1,
            # we should compute it with the requested beam_size to be accurate.
            if beam_size > 1:
                print(f"[SmartPuck STT] Re-transcribing raw with requested beam_size={beam_size}...")
                raw_result = run_transcription_inner(
                    temp_path, file_name, profile_key, language_override,
                    denoise_mode="off", normalize=normalize,
                    denoised_output_path=raw_output_path, force_cpu=force_cpu,
                    original_audio_path=original_audio_path,
                    beam_size=beam_size
                )
                raw_result["denoise_applied"] = False
                raw_result["raw_avg_logprob"] = raw_avg
            return raw_result

    return run_transcription_inner(
        temp_path, file_name, profile_key, language_override,
        denoise_mode=denoise_mode, normalize=normalize,
        denoised_output_path=denoised_output_path, force_cpu=force_cpu,
        original_audio_path=original_audio_path,
        beam_size=beam_size
    )


def run_bilingual_transcription(
    temp_path: str,
    file_name: str,
    denoise_mode: str = "off",
    normalize: bool = False,
    denoised_output_path: Optional[str] = None,
    force_cpu: bool = False,
    original_audio_path: Optional[str] = None,
    beam_size: int = 5,
):
    """Route short speech islands to English or Khmer specialist models."""
    from faster_whisper.audio import decode_audio
    from faster_whisper.vad import VadOptions, get_speech_timestamps

    # "auto" denoising used to run whole-file ASR two or three times. For the
    # bilingual path, preserve the source waveform and reserve DeepFilterNet
    # for explicit strong denoising; specialist passes are faster and safer.
    preprocessing_mode = "strong" if denoise_mode == "strong" else "off"
    # Dynamic compression/loudness normalization created false speech at the
    # head of the benchmark clip and damaged quiet Khmer words. Specialists
    # work from the original waveform; explicit strong mode still denoises.
    if denoised_output_path and os.path.exists(denoised_output_path):
        try:
            os.remove(denoised_output_path)
        except OSError:
            pass
    processed_path, temp_files = preprocess_audio(
        temp_path, preprocessing_mode, False, denoised_output_path
    )

    try:
        audio = decode_audio(processed_path, sampling_rate=16000)
        speech_chunks = get_speech_timestamps(
            audio,
            VadOptions(
                threshold=0.3,
                neg_threshold=0.15,
                min_speech_duration_ms=100,
                min_silence_duration_ms=250,
                speech_pad_ms=180,
                max_speech_duration_s=4.0,
            ),
        )

        guide = get_model(MODEL_PROFILES["auto"]["model"], force_cpu=force_cpu)
        english = get_model(MODEL_PROFILES["english-fast"]["model"], force_cpu=force_cpu)
        khmer = get_model(MODEL_PROFILES["khmer-better"]["model"], force_cpu=force_cpu)

        routed_chunks = {"en": [], "km": []}
        route_counts = {"en": 0, "km": 0}
        duration = len(audio) / 16000
        specialist_beam = min(3, beam_size)

        import numpy as np

        # Language ID only needs the encoder and language-token logits. Batch
        # those directly instead of generating guide transcripts we discard.
        for batch_start in range(0, len(speech_chunks), 16):
            batch_chunks = speech_chunks[batch_start : batch_start + 16]
            features = []
            for chunk in batch_chunks:
                chunk_audio = audio[chunk["start"] : chunk["end"]]
                padded_audio = np.pad(
                    chunk_audio,
                    (0, guide.feature_extractor.n_samples - len(chunk_audio)),
                )
                features.append(guide.feature_extractor(padded_audio)[..., :-1])

            language_results = guide.model.detect_language(
                guide.encode(np.stack(features))
            )
            for chunk, candidates in zip(batch_chunks, language_results):
                language_token, guide_probability = candidates[0]
                guide_language = language_token[2:-2]

                # Khmer is often mislabeled as Vietnamese/Tamil, while English
                # is consistently English. The product targets these two.
                route = "en" if guide_language == "en" and guide_probability >= 0.45 else "km"
                route_counts[route] += 1
                routed_chunks[route].append({
                    "start": chunk["start"] / 16000,
                    "end": chunk["end"] / 16000,
                    "route_language": guide_language,
                    "route_probability": float(guide_probability),
                })
            if speech_chunks:
                routed_count = min(batch_start + len(batch_chunks), len(speech_chunks))
                progress = int(40 * routed_count / len(speech_chunks))
                path_to_log = original_audio_path or temp_path
                print(f"[SmartPuck STT] Progress: {progress}% for {path_to_log}", flush=True)

        # Specialist chunks are independent, so batch them on one cached model
        # instead of launching hundreds of tiny GPU decoding calls serially.
        from faster_whisper import BatchedInferencePipeline

        output_segments = []
        completed_specialists = 0
        active_specialists = sum(bool(chunks) for chunks in routed_chunks.values())
        for route, model in (("en", english), ("km", khmer)):
            route_chunks = routed_chunks[route]
            if not route_chunks:
                continue
            pipeline = BatchedInferencePipeline(model=model)
            segments_iter, _ = pipeline.transcribe(
                audio,
                language=route,
                task="transcribe",
                clip_timestamps=[
                    {"start": chunk["start"], "end": chunk["end"]}
                    for chunk in route_chunks
                ],
                batch_size=8,
                beam_size=specialist_beam,
                condition_on_previous_text=False,
                compression_ratio_threshold=2.4,
                log_prob_threshold=-1.0,
                no_speech_threshold=0.6,
                temperature=0,
            )
            for segment in segments_iter:
                text = segment.text.strip()
                if not text:
                    continue
                routing = min(
                    route_chunks,
                    key=lambda chunk: abs(chunk["start"] - segment.start),
                )
                output_segments.append({
                    "start": round(segment.start, 2),
                    "end": round(segment.end, 2),
                    "text": text,
                    "avg_logprob": round(segment.avg_logprob, 4),
                    "language": route,
                    "route_language": routing["route_language"],
                    "route_probability": round(routing["route_probability"], 4),
                })
            completed_specialists += 1
            # Reserve the final 5% for desktop persistence/status finalization.
            progress = 40 + int(55 * completed_specialists / active_specialists)
            path_to_log = original_audio_path or temp_path
            print(f"[SmartPuck STT] Progress: {progress}% for {path_to_log}", flush=True)

        output_segments.sort(key=lambda segment: (segment["start"], segment["end"]))
        full_text_parts = [segment["text"] for segment in output_segments]

        return {
            "profile": "auto",
            "profile_label": MODEL_PROFILES["auto"]["label"],
            "model": "small guide + small.en + whisper-small-khmer",
            "language": "mixed" if route_counts["en"] and route_counts["km"] else ("en" if route_counts["en"] else "km"),
            "language_probability": 1.0 if output_segments else 0.0,
            "segments": output_segments,
            "full_text": " ".join(full_text_parts),
            "quality_flags": transcript_quality_flags(output_segments, "mixed", 1.0),
            "route_counts": route_counts,
        }
    finally:
        for path in temp_files:
            if os.path.exists(path):
                try:
                    os.remove(path)
                except OSError:
                    pass

def run_transcription_inner(
    temp_path: str,
    file_name: str,
    profile_key: str,
    language_override: Optional[str],
    denoise_mode: str = "off",
    normalize: bool = False,
    denoised_output_path: Optional[str] = None,
    force_cpu: bool = False,
    original_audio_path: Optional[str] = None,
    beam_size: int = 5,
):
    global cuda_disabled
    _, profile = resolve_profile(profile_key)
    resolved_model = profile["model"]
    language = language_override or profile.get("language")

    processed_path, temp_files = preprocess_audio(temp_path, denoise_mode, normalize, denoised_output_path)

    try:
        model = get_model(resolved_model, force_cpu=force_cpu)

        print(
            f"[SmartPuck STT] Transcribing file: {file_name} "
            f"(profile={profile_key}, model={resolved_model}, lang={language}, denoise={denoise_mode}, normalize={normalize}, beam_size={beam_size})..."
        )

        segments_iter, info = model.transcribe(
            processed_path,
            language=language,
            task="transcribe",
            vad_filter=True,
            beam_size=beam_size,
            word_timestamps=False,
            condition_on_previous_text=False,
            compression_ratio_threshold=2.4,
            log_prob_threshold=-1.0,
            no_speech_threshold=0.6,
        )

        output_segments = []
        full_text_parts = []
        duration = info.duration
        for segment in segments_iter:
            text = segment.text.strip()
            if text:
                output_segments.append({
                    "start": round(segment.start, 2),
                    "end": round(segment.end, 2),
                    "text": text,
                    "avg_logprob": round(segment.avg_logprob, 4),
                })
                full_text_parts.append(text)
            if duration and duration > 0:
                progress_percent = min(100, int((segment.end / duration) * 100))
                path_to_log = original_audio_path or temp_path
                print(f"[SmartPuck STT] Progress: {progress_percent}% for {path_to_log}", flush=True)
    except Exception as e:
        import ctranslate2
        cuda_available = False
        try:
            cuda_available = ctranslate2.get_cuda_device_count() > 0
        except Exception:
            pass

        if not force_cpu and cuda_available:
            print(f"[SmartPuck STT] GPU/CUDA execution failed ({e}). Disabling CUDA globally and retrying with CPU fallback...")
            cuda_disabled = True
            cuda_keys = [k for k in model_cache.keys() if k[1] == "cuda"]
            for k in cuda_keys:
                del model_cache[k]
            for f in temp_files:
                if os.path.exists(f):
                    try: os.remove(f)
                    except: pass
            return run_transcription_inner(
                temp_path, file_name, profile_key, language_override,
                denoise_mode=denoise_mode, normalize=normalize,
                denoised_output_path=denoised_output_path, force_cpu=True,
                original_audio_path=original_audio_path,
                beam_size=beam_size
            )
        else:
            raise e
    finally:
        for f in temp_files:
            if os.path.exists(f):
                try: os.remove(f)
                except: pass

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
    denoise_mode: str = Query("auto"),
    normalize: bool = Query(True),
    beam_size: int = Query(5, ge=1, le=10),
):
    suffix = os.path.splitext(file.filename)[1] if file.filename else ".mp3"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as temp_file:
        content = await file.read()
        temp_file.write(content)
        temp_path = temp_file.name

    try:
        profile_key, _ = resolve_profile(model_name)

        loop = asyncio.get_running_loop()
        result = await loop.run_in_executor(
            None,
            lambda: run_transcription(
                temp_path,
                file.filename,
                profile_key,
                language,
                denoise_mode=denoise_mode,
                normalize=normalize,
                original_audio_path=temp_path,
                skip_denoise_if_uncertain=True,
                beam_size=beam_size
            )
        )

        if should_reroute_to_khmer(
            profile_key,
            result["language"],
            result["language_probability"],
        ):
            print("[SmartPuck STT] Auto detected Khmer. Rerouting to khmer-better profile...")
            khmer_result = await loop.run_in_executor(
                None,
                lambda: run_transcription(
                    temp_path,
                    file.filename,
                    "khmer-better",
                    "km",
                    denoise_mode=denoise_mode,
                    normalize=normalize,
                    original_audio_path=temp_path,
                    beam_size=beam_size
                )
            )
            khmer_result["routed_from"] = result
            if prefer_khmer_result(result, khmer_result):
                result = khmer_result
        elif should_upgrade_uncertain_multilingual(profile_key, result):
            print("[SmartPuck STT] Uncertain non-Khmer language. Comparing multilingual turbo...")
            turbo_result = await loop.run_in_executor(
                None,
                lambda: run_transcription(
                    temp_path,
                    file.filename,
                    "high-quality",
                    None,
                    denoise_mode=denoise_mode,
                    normalize=normalize,
                    original_audio_path=temp_path,
                    beam_size=beam_size
                )
            )
            turbo_result["routed_from"] = result
            if average_logprob(turbo_result) > average_logprob(result):
                result = turbo_result

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


@app.post("/transcribe-local")
def transcribe_local(request: LocalTranscriptionRequest):
    audio_path = os.path.abspath(request.audio_path)
    if not os.path.isfile(audio_path):
        raise HTTPException(status_code=404, detail="Audio file not found.")

    try:
        profile_key, _ = resolve_profile(request.model_name)
        recording_dir = os.path.dirname(audio_path)
        denoised_dest = os.path.join(recording_dir, "recording.processed.wav")

        result = run_transcription(
            audio_path,
            os.path.basename(audio_path),
            profile_key,
            request.language,
            denoise_mode=request.denoise_mode,
            normalize=request.normalize,
            denoised_output_path=denoised_dest,
            original_audio_path=audio_path,
            skip_denoise_if_uncertain=True,
            beam_size=request.beam_size
        )
        if should_reroute_to_khmer(
            profile_key,
            result["language"],
            result["language_probability"],
        ):
            khmer_result = run_transcription(
                audio_path,
                os.path.basename(audio_path),
                "khmer-better",
                "km",
                denoise_mode=request.denoise_mode,
                normalize=request.normalize,
                denoised_output_path=denoised_dest,
                original_audio_path=audio_path,
                beam_size=request.beam_size
            )
            khmer_result["routed_from"] = result
            if prefer_khmer_result(result, khmer_result):
                result = khmer_result
        elif should_upgrade_uncertain_multilingual(profile_key, result):
            print("[SmartPuck STT] Uncertain non-Khmer language. Comparing multilingual turbo...")
            turbo_result = run_transcription(
                audio_path,
                os.path.basename(audio_path),
                "high-quality",
                None,
                denoise_mode=request.denoise_mode,
                normalize=request.normalize,
                denoised_output_path=denoised_dest,
                original_audio_path=audio_path,
                beam_size=request.beam_size
            )
            turbo_result["routed_from"] = result
            if average_logprob(turbo_result) > average_logprob(result):
                result = turbo_result
        # The bilingual path intentionally avoids loudness normalization when
        # the source is already clean. Still persist a stable 16 kHz PCM review
        # waveform so the original and pipeline input are both inspectable.
        if not os.path.isfile(denoised_dest):
            subprocess.run(
                [
                    "ffmpeg", "-y", "-i", audio_path,
                    "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le",
                    denoised_dest,
                ],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                check=True,
            )
        return result
    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Transcription failed: {str(e)}")

if __name__ == "__main__":
    port = int(os.environ.get("SMARTPUCK_TRANSCRIPTION_PORT", "8765"))
    uvicorn.run(app, host="127.0.0.1", port=port, reload=False)
