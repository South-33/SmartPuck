import os
import sys
import threading

# Limit OpenMP threads to 1 to prevent thread pool collision & CPU thrashing
# when both PyTorch (DeepFilterNet) and CTranslate2 (Whisper) are loaded together.
os.environ["OMP_NUM_THREADS"] = "1"
os.environ["MKL_NUM_THREADS"] = "1"
os.environ["KMP_DUPLICATE_LIB_OK"] = "TRUE"

model_cache_lock = threading.Lock()
diarization_cache = {}
diarization_lock = threading.Lock()

# Configure local Hugging Face cache directory inside the project to avoid polluting C drive
if not os.environ.get("HF_HOME"):
    os.environ["HF_HOME"] = os.path.join(os.path.dirname(os.path.abspath(__file__)), "models")

import tempfile
import traceback
import subprocess
import shutil
import asyncio
import urllib.request
import tarfile
import wave
import time
import numpy as np
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
    diarize: bool = False

MODEL_PROFILES = {
    "auto": {
        "model": "small",
        "label": "Khmer + English auto",
        "language": None,
        "note": "Pause-aware bilingual routing to English and Khmer specialists.",
    },
    "english-fast": {
        "model": "small",
        "label": "English fast",
        "language": "en",
        "note": "Small English-only model for cheap laptop defaults.",
    },
    "english": {
        "model": "small",
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

    with model_cache_lock:
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
                cuda_disabled = True
                try:
                    model = WhisperModel(resolved_model, device="cpu", compute_type="int8")
                    model_cache[(resolved_model, "cpu")] = model
                    return model
                except Exception as cpu_err:
                    raise HTTPException(status_code=500, detail=f"CPU fallback failed: {cpu_err}")
            else:
                raise HTTPException(status_code=500, detail=f"Model load failed: {e}")


def ensure_diarization_models(model_dir: str):
    """Automatically download and extract speaker diarization ONNX models if not present."""
    os.makedirs(model_dir, exist_ok=True)
    
    seg_tar_path = os.path.join(model_dir, "segmentation.tar.bz2")
    seg_model_dir = os.path.join(model_dir, "sherpa-onnx-pyannote-segmentation-3-0")
    seg_model_path = os.path.join(seg_model_dir, "model.onnx")
    embed_model_path = os.path.join(model_dir, "eres2net.onnx")
    
    seg_url = "https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-segmentation-models/sherpa-onnx-pyannote-segmentation-3-0.tar.bz2"
    embed_url = "https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx"
    
    # Download and extract segmentation model
    if not os.path.exists(seg_model_path):
        if not os.path.exists(seg_tar_path):
            print(f"[SmartPuck STT] Downloading speaker segmentation model from {seg_url}...", flush=True)
            tmp_seg_tar = seg_tar_path + ".tmp"
            urllib.request.urlretrieve(seg_url, tmp_seg_tar)
            os.rename(tmp_seg_tar, seg_tar_path)
        print(f"[SmartPuck STT] Extracting speaker segmentation model...", flush=True)
        with tarfile.open(seg_tar_path, "r:bz2") as tar:
            tar.extractall(path=model_dir)
        try:
            os.remove(seg_tar_path)
        except Exception:
            pass
            
    # Download embedding model
    if not os.path.exists(embed_model_path):
        print(f"[SmartPuck STT] Downloading speaker embedding model from {embed_url}...", flush=True)
        tmp_embed = embed_model_path + ".tmp"
        urllib.request.urlretrieve(embed_url, tmp_embed)
        os.rename(tmp_embed, embed_model_path)
        
    return seg_model_path, embed_model_path


def run_speaker_diarization(audio_path: str, provider: str = "cpu") -> Optional[list]:
    """Extract speaker segments from audio using sherpa-onnx diarization."""
    try:
        import sherpa_onnx
    except ImportError:
        print("[SmartPuck STT] Warning: sherpa-onnx is not installed. Skipping speaker diarization.", flush=True)
        return None
        
    try:
        # Determine model cache directory
        current_dir = os.path.dirname(os.path.abspath(__file__))
        model_dir = os.path.join(current_dir, "diarization_models")
        
        # Download models if needed
        seg_model_path, embed_model_path = ensure_diarization_models(model_dir)
        
        samples = None
        temp_wav = None
        try:
            # Check if input is already a 16kHz mono PCM WAV to bypass redundant FFmpeg downsampling
            is_16k_wav = False
            if audio_path.endswith(".wav"):
                try:
                    with wave.open(audio_path, "rb") as w:
                        if w.getnchannels() == 1 and w.getframerate() == 16000:
                            is_16k_wav = True
                except Exception:
                    pass

            target_path = audio_path
            if not is_16k_wav:
                temp_wav = os.path.join(tempfile.gettempdir(), f"temp_diar_{int(time.time())}.wav")
                cmd = [
                    "ffmpeg", "-y", "-i", audio_path,
                    "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le",
                    temp_wav
                ]
                subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
                target_path = temp_wav

            with wave.open(target_path, "rb") as w:
                params = w.getparams()
                frames = w.readframes(params.nframes)
                samples = np.frombuffer(frames, dtype=np.int16).astype(np.float32) / 32768.0
        finally:
            if temp_wav and os.path.exists(temp_wav):
                try: os.remove(temp_wav)
                except OSError: pass

        # Set up config
        pyannote_config = sherpa_onnx.OfflineSpeakerSegmentationPyannoteModelConfig(model=seg_model_path)
        seg_config = sherpa_onnx.OfflineSpeakerSegmentationModelConfig(
            pyannote=pyannote_config,
            provider=provider,
            num_threads=4
        )
        embed_config = sherpa_onnx.SpeakerEmbeddingExtractorConfig(
            model=embed_model_path,
            provider=provider,
            num_threads=4
        )
        clustering_config = sherpa_onnx.FastClusteringConfig(
            num_clusters=-1,  # Auto clustering
            threshold=0.70
        )
        
        config = sherpa_onnx.OfflineSpeakerDiarizationConfig(
            segmentation=seg_config,
            embedding=embed_config,
            clustering=clustering_config
        )
        
        # Cache the OfflineSpeakerDiarization instance to avoid compiling ONNX models on every request
        cache_key = (seg_model_path, embed_model_path, provider)
        with diarization_lock:
            if cache_key in diarization_cache:
                sd = diarization_cache[cache_key]
            else:
                sd = sherpa_onnx.OfflineSpeakerDiarization(config)
                diarization_cache[cache_key] = sd
        
        import threading
        duration = len(samples) / 16000.0
        estimated_diar_time = max(2.0, duration / 30.0)
        stop_event = threading.Event()
        
        def diar_progress_loop():
            start_time = time.time()
            while not stop_event.is_set():
                elapsed = time.time() - start_time
                ratio = min(0.99, elapsed / estimated_diar_time)
                progress = 90 + int(9 * ratio)
                print(f"[SmartPuck STT] Progress: {progress}% | Stage: Diarizing Speakers for {audio_path}", flush=True)
                stop_event.wait(0.5)
                
        progress_thread = threading.Thread(target=diar_progress_loop, daemon=True)
        progress_thread.start()
        
        t_start = time.time()
        try:
            result = sd.process(samples=samples)
        finally:
            stop_event.set()
            progress_thread.join(timeout=1.0)
            
        print(f"[SmartPuck STT] Speaker diarization finished in {time.time() - t_start:.2f}s (detected {result.num_speakers} speakers).", flush=True)
        
        raw_segments = result.sort_by_start_time()
        return [
            {"start": s.start, "end": s.end, "speaker": int(s.speaker)}
            for s in raw_segments
        ]
    except Exception as err:
        print(f"[SmartPuck STT] Warning: Diarization failed gracefully: {err}", flush=True)
        traceback.print_exc()
        return None


def should_reroute_to_khmer(profile_key: str, detected_language: Optional[str], language_probability: float):
    # The new unified hybrid bilingual pipeline handles English and Khmer in a single pass.
    # We never need to reroute.
    return False


def average_logprob(result: dict) -> float:
    segments = result.get("segments", [])
    if not segments:
        return -1.0
    total = 0.0
    for s in segments:
        val = s.get("avg_logprob", -1.0)
        # Apply a +0.45 calibration boost to Khmer segments because the fine-tuned
        # specialist model naturally yields lower log probabilities than the generalist
        # English base model even on correct transcriptions.
        if s.get("language") == "km" or s.get("route_language") == "km":
            val += 0.45
        total += val
    return total / len(segments)


def contains_khmer(text: str) -> bool:
    return any("\u1780" <= char <= "\u17ff" for char in (text or ""))


def prefer_khmer_result(original: dict, khmer_result: dict) -> bool:
    return original.get("language") == "km"


def should_upgrade_uncertain_multilingual(profile_key: str, result: dict) -> bool:
    # Disable upgrade pass since the hybrid pipeline already runs specialist models.
    return False


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
DENOISE_ATTEN_LIMIT_DB = float(os.getenv("SMARTPUCK_DENOISE_ATTEN_DB", "12"))
ENABLE_PURE_ENGLISH_EARLY_EXIT = True
VOCAL_NORMALIZE_FILTER = (
    "highpass=f=80,"
    "lowpass=f=7600,"
    "loudnorm=I=-24:TP=-2.0:LRA=12"
)

def run_ffmpeg_denoising(input_wav_48k: str, output_wav_48k: str) -> str:
    print("[SmartPuck STT] DeepFilterNet unavailable. Using FFmpeg speech denoise fallback.", flush=True)
    cmd = [
        "ffmpeg", "-y", "-i", input_wav_48k,
        "-filter:a", "highpass=f=80,lowpass=f=7600,afftdn=nf=-25:nt=w",
        "-ar", "48000", "-ac", "1",
        output_wav_48k,
    ]
    subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
    return "ffmpeg-afftdn"

def get_df_model():
    global df_model_cache
    with model_cache_lock:
        if df_model_cache is not None:
            return df_model_cache
    print("[SmartPuck STT] Initializing DeepFilterNet model on CPU...")
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
    # Force CPU device for DeepFilterNet to save GPU VRAM and prevent Windows VRAM paging
    os.environ["DEVICE"] = "cpu"
    model, df_state, _ = init_df()
    device = torch.device("cpu")
    model = model.to(device).eval()
    df_model_cache = (model, df_state, device)
    print("[SmartPuck STT] DeepFilterNet model loaded successfully on CPU.")
    return df_model_cache

def run_denoising(input_wav_48k: str, output_wav_48k: str):
    try:
        import torch
        import soundfile as sf
        from df.enhance import enhance
    except ImportError:
        return run_ffmpeg_denoising(input_wav_48k, output_wav_48k)

    try:
        model, df_state, device = get_df_model()
    except HTTPException:
        return run_ffmpeg_denoising(input_wav_48k, output_wav_48k)
    data, samplerate = sf.read(input_wav_48k)
    audio_tensor = torch.from_numpy(data).float()
    if audio_tensor.ndim == 1:
        audio_tensor = audio_tensor.unsqueeze(0)
    elif audio_tensor.shape[0] > audio_tensor.shape[1]:
        audio_tensor = audio_tensor.T

    # Moderate suppression keeps speech natural while reducing fan/static noise.
    print(f"[SmartPuck STT] DeepFilterNet attenuation limit: {DENOISE_ATTEN_LIMIT_DB:g} dB")
    # DeepFilterNet enhance() expects the input audio_tensor to be on the CPU
    with torch.inference_mode():
        enhanced_tensor = enhance(
            model, df_state, audio_tensor, atten_lim_db=DENOISE_ATTEN_LIMIT_DB
        )
    enhanced_data = enhanced_tensor.squeeze(0).cpu().numpy()
    sf.write(output_wav_48k, enhanced_data, 48000)
    return "deepfilternet"


def preprocess_audio(audio_path: str, denoise_mode: str, normalize: bool, denoised_output_path: Optional[str] = None) -> Tuple[str, list, str]:
    temp_files = []
    current_path = audio_path
    should_denoise = (denoise_mode == "strong")
    denoise_engine = "none"

    try:
        if normalize or should_denoise:
            if should_denoise:
                # Resample raw to 48kHz mono WAV (no dynamic normalization pre-denoise)
                fd, temp_48k = tempfile.mkstemp(suffix="_48k.wav")
                os.close(fd)
                temp_files.append(temp_48k)

                cmd = [
                    "ffmpeg", "-y", "-i", current_path,
                    "-ar", "48000", "-ac", "1",
                    temp_48k
                ]
                print(f"[SmartPuck STT] Resampling raw to 48k: {cmd}")
                subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)

                # Run DeepFilterNet denoising
                fd, denoised_48k = tempfile.mkstemp(suffix="_denoised_48k.wav")
                os.close(fd)
                temp_files.append(denoised_48k)

                print("[SmartPuck STT] Running DeepFilterNet3 speech enhancement...")
                denoise_engine = run_denoising(temp_48k, denoised_48k)

                # Resample back to 16kHz for Whisper
                fd, final_16k = tempfile.mkstemp(suffix="_final_16k.wav")
                os.close(fd)
                temp_files.append(final_16k)

                cmd_16k = [
                    "ffmpeg", "-y", "-i", denoised_48k,
                ]
                if normalize:
                    cmd_16k.extend(["-filter:a", VOCAL_NORMALIZE_FILTER])
                cmd_16k.extend(["-ar", "16000", "-ac", "1", final_16k])
                subprocess.run(cmd_16k, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
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
                    "-filter:a", VOCAL_NORMALIZE_FILTER,
                    "-ar", "16000", "-ac", "1",
                    normalized_16k
                ]
                print(f"[SmartPuck STT] Normalizing & resampling to 16k: {cmd}")
                subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
                current_path = normalized_16k
                if denoised_output_path:
                    try:
                        shutil.copy2(normalized_16k, denoised_output_path)
                    except Exception as copy_err:
                        print(f"[SmartPuck STT] Failed to persist normalized audio: {copy_err}")

        return current_path, temp_files, denoise_engine
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
                select_processed_audio(raw_output_path)
            else:
                select_processed_audio(raw_output_path)
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
    """Route speech segments dynamically using hybrid contiguous block grouping."""
    if denoise_mode == "auto":
        raw_output_path = f"{denoised_output_path}.normalized-candidate" if denoised_output_path else None
        denoised_output_candidate = f"{denoised_output_path}.denoised-candidate" if denoised_output_path else None

        def select_processed_audio(source_path: Optional[str]):
            if not denoised_output_path or not source_path:
                return
            try:
                shutil.copy2(source_path, denoised_output_path)
            except Exception as copy_err:
                print(f"[SmartPuck STT] Failed to select bilingual processed audio: {copy_err}")
            finally:
                for candidate in (raw_output_path, denoised_output_candidate):
                    if candidate and os.path.exists(candidate):
                        try:
                            os.remove(candidate)
                        except OSError:
                            pass

        print("[SmartPuck STT] Bilingual denoise mode is 'auto'. Running first-pass normalized transcription...", flush=True)
        raw_result = run_bilingual_transcription(
            temp_path,
            file_name,
            denoise_mode="off",
            normalize=normalize,
            denoised_output_path=raw_output_path,
            force_cpu=force_cpu,
            original_audio_path=original_audio_path,
            beam_size=min(3, beam_size),
        )
        raw_avg = average_logprob(raw_result)
        route_counts = raw_result.get("route_counts") or {}
        total_routes = sum(int(route_counts.get(key, 0) or 0) for key in ("en", "km", "ambiguous"))
        ambiguous_routes = int(route_counts.get("ambiguous", 0) or 0)
        khmer_routes = int(route_counts.get("km", 0) or 0)
        route_confused = total_routes > 0 and (
            ambiguous_routes / total_routes >= 0.25 or
            (raw_result.get("language") == "mixed" and khmer_routes > 0 and raw_avg < -0.25)
        )
        print(f"[SmartPuck STT] Bilingual raw transcript avg logprob: {raw_avg:.4f}", flush=True)

        if raw_avg < -0.35 or route_confused:
            reason = "low confidence" if raw_avg < -0.35 else "language-route confusion"
            print(f"[SmartPuck STT] Running bilingual denoising pass due to {reason} (avg={raw_avg:.4f}, routes={route_counts})...", flush=True)
            denoised_result = run_bilingual_transcription(
                temp_path,
                file_name,
                denoise_mode="strong",
                normalize=normalize,
                denoised_output_path=denoised_output_candidate,
                force_cpu=force_cpu,
                original_audio_path=original_audio_path,
                beam_size=beam_size,
            )
            denoised_avg = average_logprob(denoised_result)
            print(f"[SmartPuck STT] Bilingual denoised transcript avg logprob: {denoised_avg:.4f}", flush=True)
            if denoised_avg >= raw_avg - 0.03:
                denoised_result["denoise_applied"] = True
                denoised_result["raw_avg_logprob"] = raw_avg
                denoised_result["denoised_avg_logprob"] = denoised_avg
                select_processed_audio(denoised_output_candidate)
                return denoised_result

            raw_result["denoise_applied"] = False
            raw_result["raw_avg_logprob"] = raw_avg
            raw_result["denoised_avg_logprob"] = denoised_avg
            select_processed_audio(raw_output_path)
            return raw_result

        raw_result["denoise_applied"] = False
        raw_result["raw_avg_logprob"] = raw_avg
        select_processed_audio(raw_output_path)
        return raw_result

    from faster_whisper.audio import decode_audio
    from faster_whisper.vad import VadOptions, get_speech_timestamps

    preprocessing_mode = "strong" if denoise_mode == "strong" else "off"
    if denoised_output_path and os.path.exists(denoised_output_path):
        try:
            os.remove(denoised_output_path)
        except OSError:
            pass
            
    path_to_log = original_audio_path or temp_path
    print(f"[SmartPuck STT] Progress: 0% | Stage: Analyzing Audio for {path_to_log}", flush=True)
    
    processed_path, temp_files, denoise_engine = preprocess_audio(
        temp_path, preprocessing_mode, normalize, denoised_output_path
    )
    print(f"[SmartPuck STT] Progress: 5% | Stage: Analyzing Audio for {path_to_log}", flush=True)

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

        if not speech_chunks:
            return {
                "profile": "auto",
                "profile_label": MODEL_PROFILES["auto"]["label"],
                "model": "small guide + small.en + whisper-small-khmer",
                "language": "en",
                "language_probability": 0.0,
                "segments": [],
                "full_text": "",
                "quality_flags": [],
                "route_counts": {"en": 0, "km": 0},
                "denoise_applied": denoise_mode == "strong",
                "denoise_engine": denoise_engine,
            }

        guide = get_model(MODEL_PROFILES["auto"]["model"], force_cpu=force_cpu)
        english = None
        khmer = None

        classified_chunks = []
        route_counts = {"en": 0, "km": 0, "ambiguous": 0}
        specialist_beam = min(3, beam_size)

        import numpy as np

        # Step 1: Language Identification on VAD chunks
        for batch_start in range(0, len(speech_chunks), 16):
            batch_chunks = speech_chunks[batch_start : batch_start + 16]
            features = []
            for chunk in batch_chunks:
                chunk_audio = audio[chunk["start"] : chunk["end"]]
                chunk_audio = chunk_audio[:guide.feature_extractor.n_samples]
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
                # The guide model is often uncertain on short, weirdly-spoken
                # chunks. Confident English/Khmer can go straight to the
                # specialist; uncertainty gets a small dual-model comparison.
                if guide_language == "km" and guide_probability >= 0.35:
                    route = "km"
                elif guide_language == "en" and guide_probability >= 0.60:
                    route = "en"
                else:
                    route = "ambiguous"
                route_counts[route] += 1
                classified_chunks.append({
                    "start": chunk["start"],
                    "end": chunk["end"],
                    "lang": route,
                    "route_language": guide_language,
                    "route_probability": float(guide_probability)
                })

            if speech_chunks:
                routed_count = min(batch_start + len(batch_chunks), len(speech_chunks))
                progress = 5 + int(15 * routed_count / len(speech_chunks))
                path_to_log = original_audio_path or temp_path
                print(f"[SmartPuck STT] Progress: {progress}% | Stage: Classifying Languages for {path_to_log}", flush=True)

        en_ratio = route_counts["en"] / len(speech_chunks)
        km_ratio = route_counts["km"] / len(speech_chunks)
        ambiguous_ratio = route_counts["ambiguous"] / len(speech_chunks)
        khmer_dominant = route_counts["km"] > max(route_counts["en"] * 2, 8)
        english_dominant = route_counts["en"] >= 3 and route_counts["km"] == 0
        english_dominant_longform = route_counts["en"] >= 8 and route_counts["km"] == 0

        # Step 2: Pure-Language Early Exits
        if ENABLE_PURE_ENGLISH_EARLY_EXIT and ((en_ratio >= 0.85 and ambiguous_ratio <= 0.10) or english_dominant_longform):
            # Pure English continuous run
            print("[SmartPuck STT] Audio classified as pure English. Running continuous English model without VAD...", flush=True)
            english = get_model(MODEL_PROFILES["english-fast"]["model"], force_cpu=force_cpu)
            segments_iter, info = english.transcribe(
                processed_path,
                language="en",
                task="transcribe",
                vad_filter=False,
                beam_size=specialist_beam,
                condition_on_previous_text=False,
                compression_ratio_threshold=2.4,
                log_prob_threshold=-1.0,
                no_speech_threshold=0.6,
            )
            output_segments = []
            duration = len(audio) / 16000
            for segment in segments_iter:
                text = segment.text.strip()
                if text:
                    output_segments.append({
                        "start": round(segment.start, 2),
                        "end": round(segment.end, 2),
                        "text": text,
                        "avg_logprob": round(segment.avg_logprob, 4),
                        "language": "en",
                        "route_language": "en",
                        "route_probability": 1.0,
                    })
                if duration > 0:
                    progress = min(89, 20 + int(70 * segment.end / duration))
                    print(f"[SmartPuck STT] Progress: {progress}% | Stage: Transcribing (English) for {path_to_log}", flush=True)
            path_to_log = original_audio_path or temp_path
            print(f"[SmartPuck STT] Progress: 90% | Stage: Diarizing Speakers for {path_to_log}", flush=True)

            output_segments.sort(key=lambda s: s["start"])
            full_text_parts = [s["text"] for s in output_segments]
            return {
                "profile": "auto",
                "profile_label": MODEL_PROFILES["auto"]["label"],
                "model": f"auto-routed ({MODEL_PROFILES['english-fast']['model']})",
                "language": "en",
                "language_probability": round(float(info.language_probability or 1.0), 4),
                "segments": output_segments,
                "full_text": " ".join(full_text_parts),
                "quality_flags": transcript_quality_flags(output_segments, "en", 1.0),
                "route_counts": route_counts,
                "denoise_applied": denoise_mode == "strong",
                "denoise_engine": denoise_engine,
            }

        if km_ratio >= 0.85 and ambiguous_ratio <= 0.10:
            # Pure Khmer chunk-by-chunk run for completeness
            print("[SmartPuck STT] Audio classified as pure Khmer. Running chunk-by-chunk Khmer specialist...", flush=True)
            khmer = get_model(MODEL_PROFILES["khmer-better"]["model"], force_cpu=force_cpu)
            from faster_whisper import BatchedInferencePipeline
            pipeline = BatchedInferencePipeline(model=khmer)
            segments_iter, _ = pipeline.transcribe(
                audio,
                language="km",
                task="transcribe",
                clip_timestamps=[
                    {"start": chunk["start"] / 16000, "end": chunk["end"] / 16000}
                    for chunk in classified_chunks
                ],
                batch_size=8,
                beam_size=specialist_beam,
                condition_on_previous_text=False,
                compression_ratio_threshold=2.4,
                log_prob_threshold=-1.0,
                no_speech_threshold=0.6,
                temperature=0,
            )
            output_segments = []
            duration = len(audio) / 16000
            for segment in segments_iter:
                text = segment.text.strip()
                if text:
                    routing = min(
                        classified_chunks,
                        key=lambda chunk: abs((chunk["start"] / 16000) - segment.start),
                    )
                    output_segments.append({
                        "start": round(segment.start, 2),
                        "end": round(segment.end, 2),
                        "text": text,
                        "avg_logprob": round(segment.avg_logprob, 4),
                        "language": "km",
                        "route_language": routing["route_language"],
                        "route_probability": round(routing["route_probability"], 4),
                    })
                if duration > 0:
                    progress = min(89, 20 + int(70 * segment.end / duration))
                    print(f"[SmartPuck STT] Progress: {progress}% | Stage: Transcribing (Khmer) for {path_to_log}", flush=True)
            path_to_log = original_audio_path or temp_path
            print(f"[SmartPuck STT] Progress: 90% | Stage: Diarizing Speakers for {path_to_log}", flush=True)

            output_segments.sort(key=lambda s: s["start"])
            full_text_parts = [s["text"] for s in output_segments]
            return {
                "profile": "auto",
                "profile_label": MODEL_PROFILES["auto"]["label"],
                "model": f"auto-routed ({MODEL_PROFILES['khmer-better']['model']})",
                "language": "km",
                "language_probability": 1.0,
                "segments": output_segments,
                "full_text": " ".join(full_text_parts),
                "quality_flags": transcript_quality_flags(output_segments, "km", 1.0),
                "route_counts": route_counts,
                "denoise_applied": denoise_mode == "strong",
                "denoise_engine": denoise_engine,
            }

        # Step 3: Group Contiguous Chunks for Mixed Bilingual Audio
        groups = []
        current_group = []
        for chunk in classified_chunks:
            if not current_group:
                current_group.append(chunk)
            elif current_group[-1]["lang"] == chunk["lang"]:
                current_group.append(chunk)
            else:
                groups.append(current_group)
                current_group = [chunk]
        if current_group:
            groups.append(current_group)

        if english is None:
            english = get_model(MODEL_PROFILES["english-fast"]["model"], force_cpu=force_cpu)
        if khmer is None:
            khmer = get_model(MODEL_PROFILES["khmer-better"]["model"], force_cpu=force_cpu)

        output_segments = []
        completed_groups = 0
        from faster_whisper import BatchedInferencePipeline

        def candidate_text_score(lang, segments):
            if not segments:
                return -999.0
            text = " ".join((seg.get("text") or "").strip() for seg in segments).strip()
            if not text:
                return -999.0
            avg = sum(seg.get("avg_logprob", -1.0) for seg in segments) / len(segments)
            # Add +0.45 calibration boost to Khmer model's logprob calculation
            # because fine-tuned models are naturally less confident (dispersion bias)
            # than generalist models, even when their transcription is 100% correct.
            if lang == "km":
                avg += 0.45
            compression = max(float(seg.get("compression_ratio", 0.0) or 0.0) for seg in segments)
            no_speech = max(float(seg.get("no_speech_prob", 0.0) or 0.0) for seg in segments)
            score = avg
            if compression > 2.4:
                score -= 2.0
            if no_speech > 0.55:
                score -= 0.8
            if lang == "en":
                if contains_khmer(text):
                    score -= 3.0
                if any(("a" <= char.lower() <= "z") for char in text):
                    score += 0.15
            else:
                if contains_khmer(text):
                    score += 0.15
                else:
                    score -= 3.0
            return score

        def transcribe_clip(model, clip_audio, language):
            segments_iter, _ = model.transcribe(
                clip_audio,
                language=language,
                task="transcribe",
                vad_filter=False,
                beam_size=specialist_beam,
                condition_on_previous_text=False,
                compression_ratio_threshold=2.4,
                log_prob_threshold=-1.0,
                no_speech_threshold=0.65,
                temperature=0,
            )
            return [
                {
                    "start": float(segment.start),
                    "end": float(segment.end),
                    "text": segment.text.strip(),
                    "avg_logprob": round(segment.avg_logprob, 4),
                    "compression_ratio": float(getattr(segment, "compression_ratio", 0.0) or 0.0),
                    "no_speech_prob": float(getattr(segment, "no_speech_prob", 0.0) or 0.0),
                }
                for segment in segments_iter
                if segment.text.strip()
            ]

        def transcribe_ambiguous_chunk(chunk):
            pad_samples = int(0.12 * 16000)
            clip_start = max(0, chunk["start"] - pad_samples)
            clip_end = min(len(audio), chunk["end"] + pad_samples)
            clip_audio = audio[clip_start:clip_end]
            candidates = []
            by_language = {}
            for lang, model in (("en", english), ("km", khmer)):
                raw_segments = transcribe_clip(model, clip_audio, lang)
                offset = clip_start / 16000
                normalized = []
                for segment in raw_segments:
                    normalized.append({
                        "start": round(segment["start"] + offset, 2),
                        "end": round(segment["end"] + offset, 2),
                        "text": segment["text"],
                        "avg_logprob": segment["avg_logprob"],
                        "language": lang,
                        "route_language": chunk["route_language"],
                        "route_probability": round(chunk["route_probability"], 4),
                        "compression_ratio": segment["compression_ratio"],
                        "no_speech_prob": segment["no_speech_prob"],
                    })
                score = candidate_text_score(lang, normalized)
                candidates.append((score, normalized))
                by_language[lang] = (score, normalized)

            def candidate_text(segments):
                return " ".join(seg.get("text", "").strip() for seg in segments).strip()

            def with_alternatives(best_lang, best_score, best_segments):
                if not best_segments:
                    return []
                alternatives = []
                for alt_lang, (alt_score, alt_segments) in by_language.items():
                    alt_text = candidate_text(alt_segments)
                    if not alt_text:
                        continue
                    close_to_best = abs(best_score - alt_score) <= 0.18
                    best_is_low_confidence = best_score < -0.85 and abs(best_score - alt_score) <= 0.35
                    if alt_lang == best_lang or close_to_best or best_is_low_confidence:
                        alternatives.append({
                            "language": alt_lang,
                            "score": round(float(alt_score), 4),
                            "text": alt_text,
                        })
                if len(alternatives) > 1:
                    best_segments[0]["alternatives"] = alternatives
                    best_segments[0]["uncertain"] = True
                return best_segments

            english_score, english_segments = by_language.get("en", (-999.0, []))
            english_text = " ".join(seg.get("text", "") for seg in english_segments).strip()
            english_words = [
                word for word in english_text.replace("-", " ").split()
                if any(("a" <= char.lower() <= "z") for char in word)
            ]
            english_compression = max(
                (float(seg.get("compression_ratio", 0.0) or 0.0) for seg in english_segments),
                default=0.0,
            )
            english_no_speech = max(
                (float(seg.get("no_speech_prob", 0.0) or 0.0) for seg in english_segments),
                default=0.0,
            )
            english_hallucination = english_text.strip().lower().strip(".!") in {
                "bye bye",
                "bye-bye",
                "thank you",
                "you",
            }
            khmer_score, khmer_segments = by_language.get("km", (-999.0, []))
            if khmer_dominant and khmer_score > -1.25:
                return with_alternatives("km", khmer_score, khmer_segments)
            if (
                (not khmer_dominant or english_dominant)
                and
                (len(english_words) >= 2 or (english_dominant and english_text))
                and english_score > (-1.65 if english_dominant else -1.35)
                and english_compression <= 2.4
                and english_no_speech <= (0.65 if english_dominant else 0.45)
                and (english_dominant or not english_hallucination)
            ):
                return with_alternatives("en", english_score, english_segments)

            candidates.sort(key=lambda item: item[0], reverse=True)
            best_score, best_segments = candidates[0]
            if best_score < -1.25:
                return []
            best_lang = best_segments[0].get("language", "unknown") if best_segments else "unknown"
            return with_alternatives(best_lang, best_score, best_segments)

        for idx, g in enumerate(groups):
            lang = g[0]["lang"]

            if lang == "km":
                pipeline = BatchedInferencePipeline(model=khmer)
                segments_iter, _ = pipeline.transcribe(
                    audio,
                    language="km",
                    task="transcribe",
                    clip_timestamps=[
                        {"start": chunk["start"] / 16000, "end": chunk["end"] / 16000}
                        for chunk in g
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
                    if text:
                        routing = min(
                            g,
                            key=lambda chunk: abs((chunk["start"] / 16000) - segment.start),
                        )
                        output_segments.append({
                            "start": round(segment.start, 2),
                            "end": round(segment.end, 2),
                            "text": text,
                            "avg_logprob": round(segment.avg_logprob, 4),
                            "language": "km",
                            "route_language": routing["route_language"],
                            "route_probability": round(routing["route_probability"], 4),
                        })
            elif lang == "ambiguous":
                for chunk in g:
                    output_segments.extend(transcribe_ambiguous_chunk(chunk))
            else:
                # English contiguous blocks run continuously with 100ms padding
                pad_samples = int(0.1 * 16000)
                clip_start = max(0, g[0]["start"] - pad_samples)
                clip_end = min(len(audio), g[-1]["end"] + pad_samples)
                group_audio = audio[clip_start:clip_end]

                segments_iter, info = english.transcribe(
                    group_audio,
                    language="en",
                    task="transcribe",
                    vad_filter=False,
                    beam_size=specialist_beam,
                    condition_on_previous_text=False,
                    compression_ratio_threshold=2.4,
                    log_prob_threshold=-1.0,
                    no_speech_threshold=0.65,
                    temperature=0,
                )

                offset = clip_start / 16000
                for segment in segments_iter:
                    text = segment.text.strip()
                    if text:
                        routing = min(
                            g,
                            key=lambda chunk: abs((chunk["start"] / 16000) - (segment.start + offset)),
                        )
                        output_segments.append({
                            "start": round(segment.start + offset, 2),
                            "end": round(segment.end + offset, 2),
                            "text": text,
                            "avg_logprob": round(segment.avg_logprob, 4),
                            "language": "en",
                            "route_language": routing["route_language"],
                            "route_probability": round(routing["route_probability"], 4),
                        })

            completed_groups += 1
            progress = 20 + int(70 * completed_groups / len(groups))
            path_to_log = original_audio_path or temp_path
            print(f"[SmartPuck STT] Progress: {progress}% | Stage: Transcribing (Bilingual) for {path_to_log}", flush=True)

        print(f"[SmartPuck STT] Progress: 90% | Stage: Diarizing Speakers for {path_to_log}", flush=True)
        output_segments.sort(key=lambda s: s["start"])
        full_text_parts = [s["text"] for s in output_segments]
        duration_seconds = len(audio) / 16000
        coverage_end = max((float(s.get("end") or 0.0) for s in output_segments), default=0.0)
        routed_avg = average_logprob({"segments": output_segments})
        fallback_transcripts = []
        if duration_seconds > 0 and classified_chunks:
            # Generate VAD clip timestamps
            clip_times = [
                {"start": chunk["start"] / 16000, "end": chunk["end"] / 16000}
                for chunk in classified_chunks
            ]

            print("[SmartPuck STT] Running full English reference pass with VAD clips...", flush=True)
            pipeline_en = BatchedInferencePipeline(model=english)
            evidence_iter, evidence_info = pipeline_en.transcribe(
                processed_path,
                language="en",
                task="transcribe",
                clip_timestamps=clip_times,
                batch_size=8,
                beam_size=specialist_beam,
                condition_on_previous_text=False,
                temperature=0,
            )
            evidence_segments = []
            for segment in evidence_iter:
                text = segment.text.strip()
                if text:
                    evidence_segments.append({
                        "start": round(segment.start, 2),
                        "end": round(segment.end, 2),
                        "text": text,
                        "avg_logprob": round(segment.avg_logprob, 4),
                        "no_speech_prob": round(float(getattr(segment, "no_speech_prob", 0.0) or 0.0), 4),
                    })
            if evidence_segments:
                fallback_transcripts.append({
                    "language": "en",
                    "model": MODEL_PROFILES["english-fast"]["model"],
                    "reason": "full-pass English reference",
                    "language_probability": round(float(evidence_info.language_probability or 1.0), 4),
                    "segments": evidence_segments,
                    "full_text": " ".join(segment["text"] for segment in evidence_segments),
                })

            print("[SmartPuck STT] Running full Khmer reference pass with VAD clips...", flush=True)
            khmer = get_model(MODEL_PROFILES["khmer-better"]["model"], force_cpu=force_cpu)
            pipeline_km = BatchedInferencePipeline(model=khmer)
            evidence_iter_km, evidence_info_km = pipeline_km.transcribe(
                processed_path,
                language="km",
                task="transcribe",
                clip_timestamps=clip_times,
                batch_size=8,
                beam_size=specialist_beam,
                condition_on_previous_text=False,
                temperature=0,
            )
            evidence_segments_km = []
            for segment in evidence_iter_km:
                text = segment.text.strip()
                if text:
                    evidence_segments_km.append({
                        "start": round(segment.start, 2),
                        "end": round(segment.end, 2),
                        "text": text,
                        "avg_logprob": round(segment.avg_logprob, 4),
                        "no_speech_prob": round(float(getattr(segment, "no_speech_prob", 0.0) or 0.0), 4),
                    })
            if evidence_segments_km:
                fallback_transcripts.append({
                    "language": "km",
                    "model": MODEL_PROFILES["khmer-better"]["model"],
                    "reason": "full-pass Khmer reference",
                    "language_probability": round(float(evidence_info_km.language_probability or 1.0), 4),
                    "segments": evidence_segments_km,
                    "full_text": " ".join(segment["text"] for segment in evidence_segments_km),
                })

        result = {
            "profile": "auto",
            "profile_label": MODEL_PROFILES["auto"]["label"],
            "model": "small guide + small.en + whisper-small-khmer (hybrid)",
            "language": "mixed",
            "language_probability": 1.0 if output_segments else 0.0,
            "segments": output_segments,
            "full_text": " ".join(full_text_parts),
            "quality_flags": transcript_quality_flags(output_segments, "mixed", 1.0),
            "route_counts": route_counts,
            "denoise_applied": denoise_mode == "strong",
            "denoise_engine": denoise_engine,
        }
        if fallback_transcripts:
            result["fallback_transcripts"] = fallback_transcripts
        return result

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

    processed_path, temp_files, denoise_engine = preprocess_audio(temp_path, denoise_mode, normalize, denoised_output_path)

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
                progress_percent = min(89, 5 + int(85 * segment.end / duration))
                path_to_log = original_audio_path or temp_path
                print(f"[SmartPuck STT] Progress: {progress_percent}% | Stage: Transcribing for {path_to_log}", flush=True)
    except Exception as e:
        import ctranslate2
        cuda_available = False
        try:
            cuda_available = ctranslate2.get_cuda_device_count() > 0
        except Exception:
            pass

        if not force_cpu and cuda_available:
            print(f"[SmartPuck STT] GPU/CUDA execution failed ({e}). Disabling CUDA globally and retrying with CPU fallback...")
            with model_cache_lock:
                cuda_disabled = True
                cuda_keys = [k for k in list(model_cache.keys()) if k[1] == "cuda"]
                for k in cuda_keys:
                    model_cache.pop(k, None)
            import gc
            gc.collect()
            try:
                import torch
                if torch.cuda.is_available():
                    torch.cuda.empty_cache()
            except ImportError:
                pass
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

    path_to_log = original_audio_path or temp_path
    print(f"[SmartPuck STT] Progress: 90% | Stage: Diarizing Speakers for {path_to_log}", flush=True)
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
        "denoise_applied": denoise_mode == "strong",
        "denoise_engine": denoise_engine,
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
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                check=True,
            )
            
        # Run speaker diarization and align results if requested
        if request.diarize:
            diar_segments = run_speaker_diarization(denoised_dest, provider="cpu")
            print(f"[SmartPuck STT] Progress: 97% | Stage: Diarizing Speakers for {audio_path}", flush=True)
            if diar_segments:
                for seg in result.get("segments", []):
                    t_mid = (seg["start"] + seg["end"]) / 2.0
                    speaker = None
                    for d_seg in diar_segments:
                        if d_seg["start"] <= t_mid <= d_seg["end"]:
                            speaker = d_seg["speaker"]
                            break
                    if speaker is None and diar_segments:
                        nearest = min(diar_segments, key=lambda s: min(abs(s["start"] - t_mid), abs(s["end"] - t_mid)))
                        speaker = nearest["speaker"]
                    if speaker is not None:
                        seg["speaker"] = speaker
                        
        return result
    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Transcription failed: {str(e)}")

if __name__ == "__main__":
    port = int(os.environ.get("SMARTPUCK_TRANSCRIPTION_PORT", "8765"))
    uvicorn.run(app, host="127.0.0.1", port=port, reload=False)
