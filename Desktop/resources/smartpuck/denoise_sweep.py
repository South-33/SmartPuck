import argparse
import os
import shutil
import subprocess
import sys
import tempfile


VOCAL_NORMALIZE_FILTER = (
    "highpass=f=80,"
    "lowpass=f=7600,"
    "loudnorm=I=-24:TP=-2.0:LRA=12"
)


def run(cmd: list[str]) -> None:
    subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)


def ffmpeg_process(source: str, dest: str, duration: int | None, filter_graph: str | None = None) -> None:
    cmd = ["ffmpeg", "-y", "-hide_banner", "-i", source]
    if duration:
        cmd.extend(["-t", str(duration)])
    if filter_graph:
        cmd.extend(["-filter:a", filter_graph])
    cmd.extend(["-ar", "16000", "-ac", "1", dest])
    run(cmd)


def deepfilter_process(source_48k: str, dest_48k: str, atten_db: float) -> None:
    import soundfile as sf
    import torch
    from df.enhance import enhance, init_df

    model, df_state, _ = init_df()
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model = model.to(device).eval()
    data, _ = sf.read(source_48k)
    audio_tensor = torch.from_numpy(data).float()
    if audio_tensor.ndim == 1:
        audio_tensor = audio_tensor.unsqueeze(0)
    elif audio_tensor.shape[0] > audio_tensor.shape[1]:
        audio_tensor = audio_tensor.T
    enhanced = enhance(model, df_state, audio_tensor.to(device), atten_lim_db=atten_db)
    sf.write(dest_48k, enhanced.squeeze(0).cpu().numpy(), 48000)


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate SmartPuck denoise comparison WAV files.")
    parser.add_argument("audio")
    parser.add_argument("--out", required=True)
    parser.add_argument("--duration", type=int, default=90)
    parser.add_argument("--levels", default="6,12,24,36", help="DeepFilterNet attenuation levels in dB")
    parser.add_argument("--raw", action="store_true", help="Do not apply normalization filters, do raw denoise only")
    parser.add_argument(
        "--pipeline",
        choices=["double", "raw", "post", "pre"],
        default="double",
        help="Pipeline type: double (norm before & after), raw (no norm), post (norm only after denoise), pre (norm only before denoise)",
    )
    args = parser.parse_args()

    pipeline = args.pipeline
    if args.raw:
        pipeline = "raw"

    os.makedirs(args.out, exist_ok=True)
    source = os.path.abspath(args.audio)
    duration = args.duration if args.duration > 0 else None

    raw_dest = os.path.join(args.out, "00-raw-original.wav")
    cmd = ["ffmpeg", "-y", "-hide_banner", "-i", source]
    if duration:
        cmd.extend(["-t", str(duration)])
    cmd.extend(["-c:a", "pcm_s16le", "-ar", "16000", "-ac", "1", raw_dest])
    run(cmd)

    if pipeline != "raw":
        ffmpeg_process(source, os.path.join(args.out, "01-normalized-no-denoise.wav"), duration, VOCAL_NORMALIZE_FILTER)
    
    for nf in (-20, -25, -32, -40):
        if pipeline == "raw":
            ffmpeg_process(
                source,
                os.path.join(args.out, f"ffmpeg-afftdn-nf{nf}.wav"),
                duration,
                f"afftdn=nf={nf}:nt=w",
            )
        elif pipeline == "post":
            ffmpeg_process(
                source,
                os.path.join(args.out, f"ffmpeg-afftdn-nf{nf}.wav"),
                duration,
                f"afftdn=nf={nf}:nt=w,{VOCAL_NORMALIZE_FILTER}",
            )
        elif pipeline == "pre":
            ffmpeg_process(
                source,
                os.path.join(args.out, f"ffmpeg-afftdn-nf{nf}.wav"),
                duration,
                f"highpass=f=80,lowpass=f=7600,acompressor=threshold=-24dB:ratio=1.5:attack=15:release=260:makeup=1dB,loudnorm=I=-24:TP=-2.0:LRA=12,afftdn=nf={nf}:nt=w",
            )
        else: # double
            ffmpeg_process(
                source,
                os.path.join(args.out, f"ffmpeg-afftdn-nf{nf}.wav"),
                duration,
                f"highpass=f=80,lowpass=f=7600,afftdn=nf={nf}:nt=w,{VOCAL_NORMALIZE_FILTER}",
            )

    tmpdir = tempfile.mkdtemp(prefix="smartpuck-denoise-sweep-")
    try:
        source_48k = os.path.join(tmpdir, "source_48k.wav")
        cmd_48k = ["ffmpeg", "-y", "-hide_banner", "-i", source]
        if duration:
            cmd_48k.extend(["-t", str(duration)])
        
        # Pre-denoise filter
        if pipeline in ("raw", "post"):
            cmd_48k.extend(["-ar", "48000", "-ac", "1", source_48k])
        else: # double or pre
            cmd_48k.extend(["-filter:a", VOCAL_NORMALIZE_FILTER, "-ar", "48000", "-ac", "1", source_48k])
        run(cmd_48k)

        for level in [float(item.strip()) for item in args.levels.split(",") if item.strip()]:
            denoised_48k = os.path.join(tmpdir, f"deepfilter-{level:g}db-48k.wav")
            final = os.path.join(args.out, f"deepfilter-atten-{level:g}db.wav")
            deepfilter_process(source_48k, denoised_48k, level)
            
            # Post-denoise filter
            if pipeline in ("raw", "pre"):
                ffmpeg_process(denoised_48k, final, None, None)
            else: # double or post
                ffmpeg_process(denoised_48k, final, None, VOCAL_NORMALIZE_FILTER)
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)

    print(args.out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
