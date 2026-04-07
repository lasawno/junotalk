#!/usr/bin/env python3
"""
edge-tts HTTP sidecar for JunoTalk.
Accepts POST /synthesize  {text, voice, rate, pitch}
Returns MP3 audio.
Port: EDGE_TTS_PORT env var (default 5096)

SSML rendering is used for English voices so the assistant sounds natural:
- mstts:express-as style="assistant" adds conversational warmth and inflection
- Sentence-level <break> tags add breathing rhythm
- Prosody wraps the whole utterance for rate/pitch control
"""
import asyncio
import io
import json
import os
import re
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer

import edge_tts

PORT = int(os.environ.get("EDGE_TTS_PORT", "5096"))

# Map from OpenAI voice IDs → Microsoft neural voices
VOICE_MAP: dict[str, str] = {
    "nova":    "en-US-AriaNeural",        # warm, natural female  — supports assistant style
    "alloy":   "en-US-JennyNeural",       # friendly conversational — supports assistant style
    "echo":    "en-US-GuyNeural",         # clear, natural male   — supports friendly style
    "onyx":    "en-US-DavisNeural",       # deep, authoritative male
    "fable":   "en-US-ChristopherNeural", # storyteller male
    "shimmer": "en-US-SaraNeural",        # very natural female (upgraded from Aria duplicate)
}

# Best speaking style per voice (Microsoft SSML mstts:express-as)
# Only voices that officially support styles are listed here.
VOICE_STYLES: dict[str, str] = {
    "en-US-AriaNeural":         "assistant",
    "en-US-JennyNeural":        "assistant",
    "en-US-GuyNeural":          "friendly",
    "en-US-SaraNeural":         "assistant",   # Sara supports narration/assistant
}

# lang tag for SSML xml:lang per voice
VOICE_LANG_TAG: dict[str, str] = {
    "en-US-AriaNeural":         "en-US",
    "en-US-JennyNeural":        "en-US",
    "en-US-GuyNeural":          "en-US",
    "en-US-DavisNeural":        "en-US",
    "en-US-ChristopherNeural":  "en-US",
    "en-US-SaraNeural":         "en-US",
}

LANG_VOICE_MAP: dict[str, str] = {
    "en":  "en-US-AriaNeural",
    "es":  "es-ES-ElviraNeural",
    "fr":  "fr-FR-DeniseNeural",
    "de":  "de-DE-KatjaNeural",
    "it":  "it-IT-ElsaNeural",
    "pt":  "pt-BR-FranciscaNeural",
    "nl":  "nl-NL-ColetteNeural",
    "pl":  "pl-PL-ZofiaNeural",
    "ru":  "ru-RU-SvetlanaNeural",
    "ja":  "ja-JP-NanamiNeural",
    "zh":  "zh-CN-XiaoxiaoNeural",
    "ko":  "ko-KR-SunHiNeural",
    "ar":  "ar-SA-ZariyahNeural",
    "hi":  "hi-IN-SwaraNeural",
    "tr":  "tr-TR-EmelNeural",
    "sv":  "sv-SE-SofieNeural",
    "da":  "da-DK-ChristelNeural",
    "fi":  "fi-FI-NooraNeural",
    "no":  "nb-NO-PernilleNeural",
    "el":  "el-GR-AthinaNeural",
    "he":  "he-IL-HilaNeural",
    "th":  "th-TH-PremwadeeNeural",
    "vi":  "vi-VN-HoaiMyNeural",
    "cs":  "cs-CZ-VlastaNeural",
}

DEFAULT_VOICE = "en-US-AriaNeural"


def resolve_voice(voice_id: str, lang: str) -> str:
    if voice_id in VOICE_MAP:
        lang_prefix = (lang or "en").split("-")[0].lower()
        if lang_prefix != "en" and lang_prefix in LANG_VOICE_MAP:
            return LANG_VOICE_MAP[lang_prefix]
        return VOICE_MAP[voice_id]
    if "-Neural" in voice_id:
        return voice_id
    lang_prefix = (lang or "en").split("-")[0].lower()
    return LANG_VOICE_MAP.get(lang_prefix, DEFAULT_VOICE)


def speed_to_rate(speed: float) -> str:
    """Convert 0.5–1.5 speed multiplier to edge-tts rate string (+N%)."""
    pct = int((speed - 1.0) * 100)
    if pct >= 0:
        return f"+{pct}%"
    return f"{pct}%"


def _escape_xml(text: str) -> str:
    """Minimal XML escaping for SSML body text."""
    text = text.replace("&", "&amp;")
    text = text.replace("<", "&lt;")
    text = text.replace(">", "&gt;")
    text = text.replace('"', "&quot;")
    return text


def _add_natural_breaks(text: str) -> str:
    """
    Insert SSML <break> tags at natural pause points.
    This is the single biggest contributor to a human-sounding rhythm.
    """
    # Sentence endings — longer breath
    text = re.sub(r'([.!?])\s+', r'\1<break time="350ms"/> ', text)
    # Trailing punctuation at end of string
    text = re.sub(r'([.!?])$', r'\1<break time="200ms"/>', text)
    # Commas, semicolons — short pause
    text = re.sub(r'([,;])\s+', r'\1<break time="120ms"/> ', text)
    # Em-dashes and ellipses — thoughtful pause
    text = re.sub(r'(—|\.{2,})\s*', r'\1<break time="250ms"/> ', text)
    return text


def build_ssml(text: str, voice: str, rate_str: str, pitch: str, styledegree: float = 1.8) -> str:
    """
    Build an SSML document for the given voice.
    For voices that support speaking styles, wraps in <mstts:express-as>.
    For all English voices adds natural break timing.
    For non-English or unsupported voices, falls back to plain prosody SSML.
    styledegree is passed per-request by the voice-tuning-agent.
    """
    lang_tag = VOICE_LANG_TAG.get(voice, "en-US")
    is_english = lang_tag.startswith("en")
    style = VOICE_STYLES.get(voice)

    # Clamp styledegree to safe range
    styledegree = max(1.0, min(2.0, styledegree))

    if is_english:
        escaped = _escape_xml(text)
        broken = _add_natural_breaks(escaped)
        inner_text = broken
    else:
        inner_text = _escape_xml(text)

    prosody = f'<prosody rate="{rate_str}" pitch="{pitch}">{inner_text}</prosody>'

    if style and is_english:
        express = f'<mstts:express-as style="{style}" styledegree="{styledegree:.1f}">{prosody}</mstts:express-as>'
    else:
        express = prosody

    return (
        f'<speak version="1.0" '
        f'xmlns="http://www.w3.org/2001/10/synthesis" '
        f'xmlns:mstts="https://www.w3.org/2001/mstts" '
        f'xml:lang="{lang_tag}">'
        f'<voice name="{voice}">{express}</voice>'
        f'</speak>'
    )


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass  # suppress default access log

    def do_GET(self):
        if self.path == "/health":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"status":"ok"}')
        else:
            self.send_error(404)

    def do_POST(self):
        if self.path != "/synthesize":
            self.send_error(404)
            return

        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length)
        try:
            data = json.loads(body)
        except Exception:
            self.send_error(400, "Invalid JSON")
            return

        text        = (data.get("text") or "").strip()
        voice       = data.get("voice") or "nova"
        lang        = data.get("lang") or "en"
        speed       = float(data.get("speed", 1.0))
        pitch       = data.get("pitch", "+0Hz")
        styledegree = float(data.get("styledegree", 1.8))

        if not text:
            self.send_error(400, "text required")
            return

        ms_voice  = resolve_voice(voice, lang)
        rate_str  = speed_to_rate(speed)
        ssml      = build_ssml(text, ms_voice, rate_str, pitch, styledegree)

        try:
            audio_bytes = asyncio.run(self._synthesize(ssml, ms_voice))
            self.send_response(200)
            self.send_header("Content-Type", "audio/mpeg")
            self.send_header("Content-Length", str(len(audio_bytes)))
            self.end_headers()
            self.wfile.write(audio_bytes)
        except Exception as e:
            print(f"[EdgeTTS] Synthesis error: {e}", file=sys.stderr, flush=True)
            # SSML failed — retry with plain text as safety fallback
            try:
                audio_bytes = asyncio.run(self._synthesize_plain(text, ms_voice, rate_str, pitch))
                self.send_response(200)
                self.send_header("Content-Type", "audio/mpeg")
                self.send_header("Content-Length", str(len(audio_bytes)))
                self.end_headers()
                self.wfile.write(audio_bytes)
            except Exception as e2:
                print(f"[EdgeTTS] Plain-text fallback also failed: {e2}", file=sys.stderr, flush=True)
                self.send_error(500, str(e2))

    async def _synthesize(self, ssml: str, voice: str) -> bytes:
        """Synthesize using SSML input."""
        communicate = edge_tts.Communicate(ssml, voice)
        buf = io.BytesIO()
        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                buf.write(chunk["data"])
        result = buf.getvalue()
        if not result:
            raise RuntimeError("edge-tts returned empty audio")
        return result

    async def _synthesize_plain(self, text: str, voice: str, rate: str, pitch: str) -> bytes:
        """Plain-text fallback (original behaviour)."""
        communicate = edge_tts.Communicate(text, voice, rate=rate, pitch=pitch)
        buf = io.BytesIO()
        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                buf.write(chunk["data"])
        result = buf.getvalue()
        if not result:
            raise RuntimeError("edge-tts plain fallback returned empty audio")
        return result


if __name__ == "__main__":
    server = HTTPServer(("127.0.0.1", PORT), Handler)
    print(f"[EdgeTTS] Server running on port {PORT}", flush=True)
    sys.stdout.flush()
    server.serve_forever()
