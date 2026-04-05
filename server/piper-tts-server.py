import http.server
import json
import wave
import io
import os
import sys

from piper import PiperVoice

# Store models in /tmp — excluded from deployment images, downloaded on first use.
MODELS_DIR = os.environ.get("PIPER_MODELS_DIR", "/tmp/piper-models")
PORT = int(os.environ.get("PIPER_TTS_PORT", "5097"))

voices = {}

def load_voice(model_name):
    if model_name in voices:
        return voices[model_name]

    model_path = os.path.join(MODELS_DIR, model_name)
    config_path = os.path.join(MODELS_DIR, f"{model_name}.json")

    if not os.path.exists(model_path):
        return None

    try:
        voice = PiperVoice.load(model_path, config_path)
        voices[model_name] = voice
        print(f"[Piper TTS] Voice loaded: {model_name} (sample rate: {voice.config.sample_rate})")
        return voice
    except Exception as e:
        print(f"[Piper TTS] Failed to load {model_name}: {e}", file=sys.stderr)
        return None

def get_default_voice():
    return load_voice("en_US-amy-medium")

class TTSHandler(http.server.BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass

    def do_POST(self):
        if self.path != "/synthesize":
            self.send_response(404)
            self.end_headers()
            return

        content_length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_length)

        try:
            data = json.loads(body)
        except json.JSONDecodeError:
            self.send_response(400)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"error": "Invalid JSON"}).encode())
            return

        text = data.get("text", "").strip()
        if not text:
            self.send_response(400)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"error": "Text is required"}).encode())
            return

        text = text[:4096]
        model_name = data.get("model", "en_US-amy-medium")

        voice = load_voice(model_name)
        if voice is None:
            voice = get_default_voice()
            if voice is None:
                self.send_response(503)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"error": "No voice model available"}).encode())
                return

        try:
            buf = io.BytesIO()
            with wave.open(buf, "wb") as wav:
                voice.synthesize_wav(text, wav)
            wav_data = buf.getvalue()

            self.send_response(200)
            self.send_header("Content-Type", "audio/wav")
            self.send_header("Content-Length", str(len(wav_data)))
            self.end_headers()
            self.wfile.write(wav_data)
        except Exception as e:
            print(f"[Piper TTS] Synthesis error ({model_name}): {e}", file=sys.stderr)
            self.send_response(500)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"error": str(e)}).encode())

    def do_GET(self):
        if self.path == "/health":
            loaded = list(voices.keys())
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({
                "status": "ok",
                "engine": "piper-tts",
                "loaded_voices": loaded,
                "voice_count": len(loaded)
            }).encode())
            return

        if self.path == "/models":
            available = []
            for f in os.listdir(MODELS_DIR):
                if not f.endswith(".json") and os.path.exists(os.path.join(MODELS_DIR, f)):
                    json_path = os.path.join(MODELS_DIR, f"{f}.json")
                    if os.path.exists(json_path):
                        available.append(f)
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({
                "available": available,
                "loaded": list(voices.keys())
            }).encode())
            return

        self.send_response(404)
        self.end_headers()

if __name__ == "__main__":
    default = get_default_voice()
    if default:
        print(f"[Piper TTS] Default voice ready: en_US-amy-medium")
    else:
        print("[Piper TTS] Warning: default voice not found, will load on demand")

    server = http.server.HTTPServer(("127.0.0.1", PORT), TTSHandler)
    print(f"[Piper TTS] Server running on http://127.0.0.1:{PORT}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("[Piper TTS] Shutting down")
        server.server_close()
