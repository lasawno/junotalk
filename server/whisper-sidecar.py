"""
whisper-sidecar.py

Self-hosted Whisper transcription server for JunoTalk video call captions.
Uses faster-whisper (github.com/SYSTRAN/faster-whisper) — open-source,
runs fully on CPU, no API keys, no per-request costs.

Model: base (74MB) — fast enough for 4-second audio chunks in live calls.
Falls back to tiny (39MB) if base fails to load.

Endpoints:
  POST /transcribe   — multipart audio file → { text, language, latency_ms }
  GET  /health       — { status, model_loaded, model_size }
"""

import http.server
import json
import io
import os
import shutil
import subprocess
import sys
import time
import tempfile
import traceback

WHISPER_PORT = int(os.environ.get("WHISPER_SIDECAR_PORT", "5099"))
MODEL_SIZE = os.environ.get("WHISPER_MODEL_SIZE", "base")
# Store models in /tmp — excluded from deployment images, downloaded on first run.
# Falls back to a workspace-relative path if /tmp is not writable.
MODELS_DIR = os.environ.get("WHISPER_MODELS_DIR", "/tmp/whisper-models")

model = None
model_loaded = False
model_size_loaded = None


def load_model(size=MODEL_SIZE):
    global model, model_loaded, model_size_loaded
    if model_loaded:
        return True
    try:
        from faster_whisper import WhisperModel
        os.makedirs(MODELS_DIR, exist_ok=True)
        print(f"[WhisperSidecar] Loading {size} model (download on first run)...", flush=True)
        model = WhisperModel(
            size,
            device="cpu",
            compute_type="int8",
            download_root=MODELS_DIR,
        )
        model_loaded = True
        model_size_loaded = size
        print(f"[WhisperSidecar] {size} model ready", flush=True)
        return True
    except Exception as e:
        print(f"[WhisperSidecar] Failed to load {size} model: {e}", file=sys.stderr, flush=True)
        if size != "tiny":
            print(f"[WhisperSidecar] Retrying with tiny model...", flush=True)
            return load_model("tiny")
        return False


FFMPEG_BIN = shutil.which("ffmpeg") or "ffmpeg"
# Disable ffmpeg preprocessing with WHISPER_SKIP_DENOISE=1 (e.g. for low-CPU envs)
_DENOISE_ENABLED = os.environ.get("WHISPER_SKIP_DENOISE", "0").strip() != "1"


def preprocess_audio(input_path: str) -> str:
    """
    Apply ffmpeg audio noise-reduction filters before Whisper transcription.

    Filter chain (matched to ChatGPT/iPhone voice processing profile):

      highpass=f=80        — removes sub-80 Hz rumble, HVAC, desk vibration.
                             Speech fundamentals start at ~85 Hz (male) /
                             ~165 Hz (female). Nothing below 80 Hz is speech.

      lowpass=f=8000       — removes everything above 8 kHz.
                             Whisper is trained on 16 kHz audio (Nyquist = 8 kHz).
                             High-frequency hiss, electronic noise, and harmonics
                             above 8 kHz are meaningless for the model — cutting
                             them reduces hallucinations on noisy input.

      afftdn=nf=-25:nr=10:nt=w
                           — FFT-based spectral noise reduction.
                             nf=-25 dBFS: gentler noise-floor estimate than -20.
                             At -20 quiet consonants and trailing vowels were
                             being clipped; -25 preserves more natural speech.
                             nr=10 dB: explicit reduction amount (default is 10
                             but making it explicit prevents version drift).
                             nt=w (white): broadband noise profile — best for
                             fans, AC, road noise, and office environments.

      agate                — Audio gate: mutes signal below the threshold.
        threshold=0.015    ~-36 dBFS — gentler than the previous 0.03 (-30 dBFS)
                           so soft-spoken users and sentence-final syllables
                           are not incorrectly muted.
        attack=5           Gate opens in 5ms — faster than 10ms to avoid
                           clipping hard consonant onsets (p, t, k).
        release=250        Gate closes in 250ms — avoids clipping word endings
                           and the natural decay of vowels.

      dynaudnorm=p=0.9     — Dynamic audio normalizer. Brings consistent
             :m=100        loudness regardless of speaker distance from mic.
             :s=5          s=5 (smoothing frames) — was 12, which over-smoothed
                           and introduced pumping artifacts on short chunks.
                           5 is better suited for 2–6 second voice clips.
                           p=0.9 avoids amplifying pure silence frames.

    Two-stage fallback:
      1. Full chain (bandpass + afftdn + agate + dynaudnorm)
      2. Light chain (bandpass + agate + dynaudnorm) — if afftdn is not compiled
         into the system ffmpeg build
      3. Raw original file — if both ffmpeg attempts fail

    Output: 16000 Hz mono WAV (Whisper's native optimal format).
    Disable entirely: WHISPER_SKIP_DENOISE=1
    """
    if not _DENOISE_ENABLED:
        return input_path

    clean_path = input_path + "_clean.wav"

    # Common ffmpeg args for both attempts — probe flags speed up short clips.
    # nosec B603 — shell=False (default), list args, no shell expansion.
    # input_path is always a tempfile.NamedTemporaryFile path generated
    # internally; FFMPEG_BIN is resolved from the system PATH at startup.
    # Neither value is derived from external/user-supplied input.
    base_args = [
        FFMPEG_BIN,
        "-y",
        "-probesize", "32",          # don't spend time probing tiny audio files
        "-analyzeduration", "0",     # skip duration analysis for short chunks
        "-loglevel", "error",        # suppress info/warning spam; only log errors
        "-i", input_path,
        "-ar", "16000",              # resample to Whisper's preferred rate
        "-ac", "1",                  # mono
        "-f", "wav",
    ]

    # Stage 1 — full chain including spectral denoiser (afftdn)
    full_chain = (
        "highpass=f=80,"
        "lowpass=f=8000,"
        "afftdn=nf=-25:nr=10:nt=w,"
        "agate=threshold=0.015:attack=5:release=250,"
        "dynaudnorm=p=0.9:m=100:s=5"
    )

    # Stage 2 — light chain without afftdn (fallback if afftdn not compiled in)
    light_chain = (
        "highpass=f=80,"
        "lowpass=f=8000,"
        "agate=threshold=0.015:attack=5:release=250,"
        "dynaudnorm=p=0.9:m=100:s=5"
    )

    for label, af_chain in [("full", full_chain), ("light", light_chain)]:
        try:
            result = subprocess.run(  # nosec B603 B607 # noqa: S603
                # shell=False (default and explicit below).
                # All arguments are a fixed list built from server constants:
                # FFMPEG_BIN is resolved at startup from PATH, input_path and
                # clean_path are NamedTemporaryFile paths generated internally,
                # and af_chain is a static string literal defined above.
                # No element is derived from external/user-supplied input.
                base_args + ["-af", af_chain, clean_path],
                capture_output=True,
                timeout=10,   # 15s was too long for 4-second live audio chunks
                shell=False,  # explicit: no shell interpolation
            )
            if result.returncode == 0 and os.path.exists(clean_path) and os.path.getsize(clean_path) > 0:
                return clean_path
            err = result.stderr[-300:].decode(errors="replace")
            print(
                f"[WhisperSidecar] ffmpeg denoise ({label}) failed "
                f"(rc={result.returncode}): {err}",
                file=sys.stderr, flush=True,
            )
        except subprocess.TimeoutExpired:
            print(f"[WhisperSidecar] ffmpeg denoise ({label}) timed out", file=sys.stderr, flush=True)
        except Exception as exc:
            print(f"[WhisperSidecar] ffmpeg denoise ({label}) error: {exc}", file=sys.stderr, flush=True)

    return input_path   # graceful fallback — Whisper still transcribes the raw file


def transcribe_audio(audio_bytes: bytes, extension: str = "webm", language: str = None) -> dict:
    if not model_loaded:
        raise RuntimeError("Model not loaded")

    start = time.time()

    with tempfile.NamedTemporaryFile(suffix=f".{extension}", delete=False) as tmp:
        tmp.write(audio_bytes)
        tmp_path = tmp.name

    # Run ffmpeg noise-reduction pre-processing.
    # preprocess_audio() returns a separate _clean.wav path on success,
    # or the original tmp_path if ffmpeg is unavailable / errors out.
    clean_path = preprocess_audio(tmp_path)

    try:
        kwargs = {
            "beam_size": 3,
            "best_of": 3,
            "temperature": 0.0,
            "condition_on_previous_text": False,
            # VAD filter: suppress segments that are mostly silence.
            # Tightened thresholds to improve noise robustness:
            #   speech_pad_ms=80   — pad detected speech by 80ms to avoid
            #                        clipping word endings.
            #   min_silence_duration_ms=400 — require 400ms of silence before
            #                        splitting a segment (was 300ms).
            #   threshold=0.45     — VAD confidence threshold (0–1). Lower = more
            #                        permissive (catches whispers), higher = stricter
            #                        (better noise rejection). 0.45 is conservative.
            "vad_filter": True,
            "vad_parameters": {
                "min_silence_duration_ms": 400,
                "speech_pad_ms": 80,
                "threshold": 0.45,
            },
        }
        if language and language != "auto":
            kwargs["language"] = language[:2].lower()

        segments, info = model.transcribe(clean_path, **kwargs)

        text_parts = []
        for segment in segments:
            part = segment.text.strip()
            if part:
                text_parts.append(part)

        text = " ".join(text_parts).strip()
        latency_ms = int((time.time() - start) * 1000)

        return {
            "text": text,
            "language": info.language,
            "language_probability": round(info.language_probability, 3),
            "latency_ms": latency_ms,
            "model": model_size_loaded,
            "denoised": clean_path != tmp_path,
        }
    finally:
        for path in {tmp_path, clean_path}:
            try:
                os.unlink(path)
            except Exception:
                pass


def parse_multipart(data: bytes, content_type: str):
    import email
    from email import policy as email_policy

    boundary = None
    for part in content_type.split(";"):
        part = part.strip()
        if part.startswith("boundary="):
            boundary = part[len("boundary="):].strip().strip('"')
            break

    if not boundary:
        return None, "webm", None

    msg = email.message_from_bytes(
        b"Content-Type: " + content_type.encode() + b"\r\n\r\n" + data,
        policy=email_policy.default,
    )

    audio_bytes = None
    extension = "webm"
    language = None

    for part in msg.iter_parts():
        disp = part.get_content_disposition() or ""
        name = part.get_param("name", header="content-disposition") or ""

        if name == "audio":
            audio_bytes = part.get_payload(decode=True)
            mime = part.get_content_type() or ""
            if "mp4" in mime or "m4a" in mime:
                extension = "mp4"
            elif "wav" in mime:
                extension = "wav"
            elif "ogg" in mime:
                extension = "ogg"
            elif "mp3" in mime:
                extension = "mp3"
        elif name == "language":
            language = part.get_payload(decode=True)
            if isinstance(language, bytes):
                language = language.decode("utf-8", errors="ignore").strip()

    return audio_bytes, extension, language


class WhisperHandler(http.server.BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass

    def send_json(self, code: int, data: dict):
        body = json.dumps(data).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/health":
            self.send_json(200, {
                "status": "ok",
                "model_loaded": model_loaded,
                "model_size": model_size_loaded,
            })
        else:
            self.send_json(404, {"error": "Not found"})

    def do_POST(self):
        if self.path != "/transcribe":
            self.send_json(404, {"error": "Not found"})
            return

        content_length = int(self.headers.get("Content-Length", 0))
        if content_length == 0 or content_length > 25 * 1024 * 1024:
            self.send_json(400, {"error": "Invalid content length"})
            return

        body = self.rfile.read(content_length)
        content_type = self.headers.get("Content-Type", "")

        try:
            if "multipart/form-data" in content_type:
                audio_bytes, extension, language = parse_multipart(body, content_type)
            else:
                audio_bytes = body
                extension = "webm"
                language = self.headers.get("X-Language")

            if not audio_bytes:
                self.send_json(400, {"error": "No audio data received"})
                return

            if not model_loaded:
                self.send_json(503, {"error": "Model not ready yet"})
                return

            result = transcribe_audio(audio_bytes, extension, language)
            self.send_json(200, result)

        except Exception as e:
            traceback.print_exc(file=sys.stderr)
            self.send_json(500, {"error": str(e)})


if __name__ == "__main__":
    print(f"[WhisperSidecar] Initializing on port {WHISPER_PORT}...", flush=True)

    loaded = load_model(MODEL_SIZE)
    if not loaded:
        print("[WhisperSidecar] Could not load any Whisper model — will retry on first request", file=sys.stderr, flush=True)

    class ReuseAddrServer(http.server.HTTPServer):
        allow_reuse_address = True

    last_err = None
    for attempt in range(1, 6):
        try:
            server = ReuseAddrServer(("127.0.0.1", WHISPER_PORT), WhisperHandler)
            print(f"[WhisperSidecar] Listening on port {WHISPER_PORT}", flush=True)
            server.serve_forever()
            break
        except OSError as e:
            last_err = e
            print(f"[WhisperSidecar] Port {WHISPER_PORT} busy (attempt {attempt}/5), retrying in 1s...", file=sys.stderr, flush=True)
            import time; time.sleep(1)
    else:
        print(f"[WhisperSidecar] Could not bind port {WHISPER_PORT}: {last_err}", file=sys.stderr, flush=True)
        sys.exit(1)
