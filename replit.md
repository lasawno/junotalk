# JunoTalk - Encrypted Video Calls with Real-Time Translated Captions

## Overview
JunoTalk is a mobile-first video calling application that eliminates language barriers through secure, private communication and real-time AI-powered speech-to-text transcription and live translated captions. It aims to be a robust, accessible, and user-friendly platform for global communication, facilitating seamless cross-cultural interaction for international business, education, and personal connections. Key capabilities include secure video calls, real-time AI translation for captions and chat, voice message translation, and post-call AI summaries.

## User Preferences
- I want iterative development.
- I prefer clear and concise communication.
- I like functional programming paradigms where appropriate.
- Ask before making major architectural changes or significant code refactoring.
- Prioritize performance and user experience, especially on mobile devices.
- Focus on security and privacy in all implementations.
- MOBILE ONLY: All testing, previewing, and development must use mobile viewport (400x720). Never test or preview at desktop sizes.

## API Key Management
All API keys are centralized through `server/api-keys.ts`. At startup, keys load from `config/api-keys.json` in the private GitHub repo (`lasawno/junotalk-cdn`) via the authenticated GitHub connector. If the CDN file is unreachable, each key falls back to the matching Replit secret. Keys refresh every hour automatically.

**GitHub CDN file format** (`config/api-keys.json`):
```json
{
  "GEMINI_API_KEY": "AIza...",
  "ANTHROPIC_API_KEY": "sk-ant-...",
  "OPENAI_API_KEY": "sk-...",
  "MOONSHOT_API_KEY": "...",
  "HF_TOKEN": "hf_...",
  "ENCRYPTION_KEY": "...",
  "RECAPTCHA_SECRET_KEY": "...",
  "YOUTUBE_INTERNAL_KEY": "...",
  "DEEPSEEK_API_KEY": "...",
  "OPENROUTER_API_KEY": "..."
}
```
Replit integration keys (`AI_INTEGRATIONS_*`) are injected by the Replit OAuth system and remain env-only.

**AI Provider Priority (chat tasks):**
1. `github-models` (priority -2/-1) — `GITHUB_MODELS_TOKEN` secret; endpoint `https://models.inference.ai.azure.com`. Models: `gpt-4o` (primary), `Meta-Llama-3.1-405B-Instruct` (secondary). 25s timeout.
2. `openai` (priority 1) — Replit proxy `http://localhost:1106/modelfarm/openai`; model `gpt-4o-mini`; works with `_DUMMY_API_KEY_`. 20s timeout.
3. `openrouter` (priority 2) — valid key `sk-or-v1-...` but free models frequently rate-limited (429) or removed (404). 45s timeout.

**Replit AI Proxy Notes:**
- `AI_INTEGRATIONS_ANTHROPIC_BASE_URL` → `http://localhost:1106/modelfarm/anthropic` — proxy only supports specific model IDs; `claude-3-5-haiku-20241022` and `claude-3-5-sonnet-20241022` are unsupported/deprecated by the proxy as of March 2026.
- GitHub Models API token stored as `GITHUB_MODELS_TOKEN` Replit secret. Token needs `models: read` permission (fine-grained PAT).

**Important:** There are NO hardcoded fallback key values anywhere in the codebase. All keys — including `YOUTUBE_INTERNAL_KEY` — are loaded exclusively from the GitHub CDN (`config/api-keys.json`). If the CDN is unreachable, keys fall back to matching Replit secrets. Never re-introduce hardcoded key literals into `server/api-keys.ts`.

## Project State System (Architecture Memory)

`server/project-state.ts` is the authoritative memory layer for the project. It loads `config/project-state.json` from the GitHub CDN at startup and refreshes hourly.

**What it tracks:**
- `cdnKeys[]` — every API key stored in the CDN (no agent session should ever hardcode these)
- `migrations[]` — completed feature migrations and key transfers with dates and affected files
- `architectureDecisions[]` — locked decisions with rationale
- `securityRules[]` — non-negotiable rules applied to all code changes

**Admin API endpoints (admin-gated):**
| Endpoint | Method | Purpose |
|---|---|---|
| `/api/system/project-state` | GET | View current state and status |
| `/api/system/project-state/push` | POST | Push in-memory state to GitHub CDN |
| `/api/system/project-state/record` | POST | Record a new migration or decision, auto-push to CDN |

**When to use `record`:** Any time a key is moved to the CDN, a feature is migrated, or a rule is established — call `recordDecision()` in code or hit the `/record` endpoint. This keeps the CDN file the single source of truth.

**CDN file:** `config/project-state.json` in `lasawno/junotalk-cdn`
**Local snapshot:** `vault/project-state/snapshot.md` (written on every load/push)

## System Architecture
JunoTalk utilizes a modern web stack with a React + TypeScript frontend and an Express.js + TypeScript backend, using Socket.IO and WebSockets for real-time communication. Data is persisted in PostgreSQL with Drizzle ORM. Authentication is handled by Replit Auth. Video conferencing is powered by Jitsi Meet (WebRTC-based) via JaaS, secured with JWT authentication.

The application incorporates a multi-provider AI translation chain including LibreTranslate, Moonshot AI/Kimi (primary), Google Gemini, and Claude (last-resort fallback), with device-native speech recognition and `gpt-4o-mini-transcribe` as STT fallback. A Kimi-powered token budget agent manages costs. Security for translation includes HTTPS, AES-256-GCM encrypted cache, HMAC-SHA256, and scrubbed server logs. End-to-end encryption (E2EE) is implemented for 2-person text messages using Web Crypto API.

The UI/UX features a blue-teal theme with a forced dark mode, optimized for mobile (400x720 viewport), using a soft charcoal grey backdrop and layered cards.

Key architectural features include:
- Secure 6-character room codes.
- Real-time AI transcription and translation with scrollable caption history.
- Persistent chat messages with soft-delete architecture and E2EE for 2-person rooms, supporting message editing and emoji reactions.
- **Server-side Translation Agent**: An API-minimal pipeline that resolves ~95% of translations locally using an in-memory LRU cache, a translation memory DB, local/GitHub fallback phrases, and vector similarity before resorting to AI. The L6 slot is held by **JunoAgent-T1** (`server/juno-agent-t1.ts`), a dedicated Groq-powered text-message translator (llama-3.3-70b-versatile → llama-3.1-8b-instant), decoupled from the shared AI Gateway. The AI Gateway (OpenAI / Anthropic) serves as L7 fallback only if T1 fails.
- **Translation Memory**: A database-backed store (`translation_memory` table) for source/target translation pairs.
- **Vector Memory with pgvector**: Semantic search over past translations and conversations using pgvector for embeddings, enabling direct translation matches or few-shot context for LLMs.
- **Translation Fallback Safety Net**: Preloaded common phrases and GitHub-sourced data provide a robust fallback before AI APIs are called.
- **Agent Task Queue**: Utilizes BullMQ for retry resilience, idempotency, and concurrency limits for agent work, with Redis as the backing store.
- **Agent Metrics Store**: Records privacy-preserving counters for system health and performance.
- Voice message transcription and translation displayed in interactive voice bubbles.
- AI custom emoji generator and GIPHY GIF integration.
- Full website internationalization (i18n) supporting 40 languages.
- **Marketing Agent**: A backend AI content generation engine for various content types (e.g., social_post, ad_copy, email_campaign) using a multi-provider AI strategy.
- Robust error handling and data fetching with React Query.
- Post-call AI summaries.
- **Call Reliability System**: Features auto-reconnect, call timeouts, real-time call quality adaptation, status indicators, and seamless call features like Low Data Mode, Voice Only Mode, and Smart Network Switching.
- **User Presence System**: Real-time online/in-call/offline status tracking and display.
- Enhanced security measures including encrypted phone numbers and prompt injection prevention.
- **SEO optimization**: Comprehensive SEO setup with dynamic meta tags, server-side crawler prerendering, `robots.txt`, and `sitemap.xml`.
- "Juno" — an on-demand AI Voice Translation page using Web Speech API, Piper TTS, and OpenAI TTS, including "Hey Juno" wake-word detection.
- **JunoVision** — Camera-based AI product/object identification with a cost-minimal multi-layer pipeline:
  - Layer 1: **YOLO** (local, free) — fast object category detection in milliseconds, runs alongside scan memory loading
  - Layer 2: **Gemini 1.5 Flash** (lightweight reader) — only reads visible brand text/logos from the photo, outputs brand + label + translation + one sentence. ~80% fewer tokens than a full knowledge prompt.
  - Layer 3: **OSINT enrichment** (free, no API key) — Wikipedia, DuckDuckGo, Open Food Facts, Open Library query immediately after Gemini returns brand name. Fills `englishDetails`, food calories/Nutri-Score/allergens, book metadata.
  - Layer 4: **Scan memory** (`vision_scans` table) — last 20 identifications passed as cross-reference context; results saved after each scan for compounding accuracy.
  - Fallback: Claude direct vision if Gemini unavailable; YOLO-only result if all AI fails.
  - TTS speaks result sentence in target language (Spanish by default, using OpenAI nova voice).
- **Health Monitoring & Structured Logging**: Provides system health status, detailed system info, and structured JSON logs for key actions, with an `/api/system/health` endpoint for overall status.
- **AI Gateway**: A centralized model routing layer consolidating all AI provider calls with features like unified request/response types, declarative routing config, provider adapters, circuit-breaking, and token usage tracking. AI stack: L1=DeepSeek/GitHub (free, 150k/day), L2=Kimi moonshot-v1-32k (50k/day), L3=Claude Haiku (3k/day), L4=hardcoded fallback.
- **GitHub Configuration Pipeline** (`server/github-config.ts`): Centralized config manager that pulls module settings (reasoning, personality, module toggles) from the `lasawno/junotalk-cdn` GitHub CDN repo. Uses 1-hour TTL cache with automatic refresh and local fallback defaults.
- **Recall Orchestrator** (`server/recall-orchestrator.ts`): Single integration point for all five recall systems. Three weighted profiles — `translation` (S1 40%/S2 35%/S4 25%), `juno` (S1 30%/S2 20%/S3 35%/S4 15%), `vision` (S5 100%). Wired into both hot paths: `ai-gateway.ts` (translation — orchestrator enriches `recallLines` with Systems 2+4 alongside existing System 1 personality/intent flow), `juno-orb.ts` (Juno assistant — full replacement of direct recall calls; high-confidence knowledge early-return preserved; `buildSystemPrompt` no longer double-calls `getUserBehaviorContext` since orchestrator owns it). Previously dormant Systems 2 (semantic embedding) and 4 (keyword context) are now active for all AI requests.
- **Reasoning Engine** (`server/reasoning-engine.ts`): Pre-processing layer for complex queries with signal-based complexity scoring and ordered step decomposition.
- **Personality Engine** (`server/personality-engine.ts`): Configurable tone system with four built-in profiles, context-aware overrides, and GitHub CDN configuration.
- **Juno Brain Protection**: Multi-layer defense for the Orb AI — prompt injection blocking (7 pattern families in `juno-safety.ts`), system prompt leak detection in output filter (`juno-orb.ts`), information boundary enforcement, vault HTTP block, orb stats admin-locked.
- **Security Hardening** (recent): Admin endpoints dual-gated (session + code), room subscription membership check, Vision upload MIME allowlist, signed-URL content type allowlist, vault path HTTP blocked.
- **Voice Identity**: Opt-in personalization feature in Settings that lets users choose a proxy TTS voice (OpenAI voices: nova/alloy/echo/fable/onyx/shimmer) and record/upload a voice reference sample (stored in Supabase private bucket under `voice-profiles/{userId}/sample.webm`). When enabled, the TTS route automatically uses the user's preferred voice. Sample is a reference for future LuxTTS custom voice cloning. Backed by `voice_profiles` table and two new `user_preferences` columns (`voice_identity_enabled`, `voice_identity_voice`). Routes: `GET/PATCH /api/v1/voice-profile`, `POST /api/v1/voice-profile/sample`, `DELETE /api/v1/voice-profile`.
- **Mobile Auth Infrastructure**: Token-based auth for mobile clients — `POST /api/v1/auth/mobile/token` (issue), `/refresh` (renew), `/revoke` (sign out). 15-min access tokens, 30-day refresh tokens, stored in `mobile_tokens` table.
- **Device Management**: `devices` table tracks registered devices per account. `GET /api/v1/devices` lists active devices, `DELETE /api/v1/devices/:id` revokes a device and kills its tokens. Account deletion wipes all devices and tokens.
- **Translation Cache Encryption**: AES-256-GCM with permanent `ENCRYPTION_KEY` secret (no longer ephemeral).
- **Audio Noise Reduction Pipeline** (`client/src/lib/audio-processor.ts` + `server/whisper-sidecar.py`): Client-side Web Audio chain (highpass 80 Hz → lowpass 8 kHz → DynamicsCompressor → Gain → Analyser) with hardware-level constraints (`noiseSuppression`, `echoCancellation`, `autoGainControl`). Server-side ffmpeg chain on every Whisper chunk (highpass → lowpass → afftdn spectral denoiser → agate noise gate → dynaudnorm). VAD (Voice Activity Detection) using RMS analysis with 15.5 dB margin above Whisper floor.
- **Offline Video Feed / Local-First Buffering** (`client/src/lib/offline-queue.ts`, `client/src/hooks/use-network-status.ts`): IndexedDB-backed persistent queue that survives page refresh. Two entry types: `voice-message` (room-chat voice notes captured while offline, delivered on reconnect) and `whisper-chunk` (5-second caption chunks buffered during mid-call dropout, transcribed and added to caption history on reconnect). Integrations: `room-chat.tsx` queues failed voice messages with "Queued" status indicator and drains on reconnect; `room-call.tsx` buffers Whisper audio chunks offline and shows buffered-count indicator in the offline overlay. Drain is idempotent with up to 3 retry attempts per entry before auto-drop.

API endpoints are versioned (current stable `v1`) and organized by domain.

## Infrastructure & Deployment Architecture

### Authentication Flow (OAuth — Window-Based, Not Embedded)

JunoTalk's social platform connections use a **`window.open()` popup pattern**, not iframes. This is a hard architectural requirement:

- **Desktop**: `window.open(url, "junotalk_browser", "popup,width=480,height=660,...")` — opens a fully detached, movable browser window. The social platform (Google, Facebook, etc.) sees a normal browser navigation. No `X-Frame-Options` or `frame-ancestors` CSP headers apply — these only restrict `<iframe>` embedding.
- **Mobile**: `window.location.href` redirect via iOS `googlechromes://` scheme or Android Intent URL targeting Chrome's package. `sessionStorage` holds the pending platform ID; on return, the connection is auto-confirmed.
- **No iframe embedding anywhere** in the social auth flow. The `data-sheet` / `sheetRef` references in `MediaCarousel.tsx` are internal names for JunoTalk's own connect sheet UI, not for platform content.
- Replit Auth (session-based) handles primary user authentication separately via Replit's OAuth infrastructure.

### Service Isolation

All services run within a single Replit VM (required for stateful processes) with internal port separation:

| Service | Port | Notes |
|---|---|---|
| Express + Vite dev server | 5000 | Main app (prod: `node dist/index.cjs`) |
| Whisper STT sidecar | 5099 | Python subprocess, lazy-started on first TTS request. Includes ffmpeg noise-reduction pre-processing (highpass → afftdn → dynaudnorm) before every transcription. Disable with `WHISPER_SKIP_DENOISE=1`. |
| Vision/YOLO detector sidecar | 5098 | Python subprocess, auto-started on boot with health polling |
| Piper TTS sidecar | Dynamic | Lazy-started, models downloaded to `/tmp/` on first use |

Socket.IO (`/chat` namespace), BullMQ workers, and Redis are all in-process or co-located. WebSocket state is ephemeral — sessions live in the VM process memory backed by Redis for durability.

### Deployment Pipeline

```
Source → npm run build → tsx script/build.ts
  ├── Vite builds frontend → dist/public/
  ├── esbuild bundles server → dist/index.cjs
  └── Python sidecars copied → dist/*.py
```

- **Build output**: ~62MB `dist/` (Python runtime libraries add ~847MB at runtime, not git-tracked)
- **Run command**: `node dist/index.cjs`
- **Port**: 5000
- **Target**: Replit VM — always-running (required for Socket.IO, BullMQ workers, Redis, Python sidecars)
- **Models**: Piper TTS and Whisper download to `/tmp/` at first use — not bundled, not git-tracked

### Scaling & Resource Allocation

**Stateful requirements (cannot be horizontally scaled without changes):**
- Socket.IO room subscriptions held in VM memory (Redis adapter would be needed for multi-instance)
- BullMQ workers bound to single Redis connection
- Python sidecar subprocesses (Whisper/Vision) are per-VM

**Scaling-ready components:**
- Translation cache: Redis-backed, survives restarts
- Agent task queue: BullMQ with retry resilience and idempotency keys
- Database: Supabase PostgreSQL (externally managed, scales independently)
- API key delivery: GitHub CDN with 1-hour TTL refresh (no scaling dependency)

**Current resource targets:**
- RAM: ~1–2GB (Whisper base model ~150MB, YOLO ONNX ~12MB, Python libs ~847MB)
- CPU: Burst on STT/Vision inference; idle otherwise
- Redis: `volatile-lru` eviction policy (safe for cache-only use; `noeviction` preferred for queue durability)

### Deployment Configuration
- **Target**: VM (required — WebSocket state, BullMQ background workers, Whisper/Vision sidecars)
- **Build**: `npm run build` (outputs `dist/index.cjs`)
- **Run**: `node dist/index.cjs`
- **Port**: 5000

## Secrets Status
| Secret | Status | Purpose |
|--------|--------|---------|
| `MOONSHOT_API_KEY` | Set | Kimi primary AI (translation, Orb, cleanup) |
| `ANTHROPIC_API_KEY` | Set | Claude fallback AI |
| `GOOGLE_API_KEY` | Set | Gemini translation/detection |
| `ENCRYPTION_KEY` | Set | Translation cache AES-256-GCM |
| `DEV_PORTAL_ACCESS_CODE` | Set | Admin portal access |
| `SESSION_SECRET` | Set | Session signing |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | Set | Push notifications |
| `REDIS_URL` | Set | Redis/BullMQ |
| `SUPABASE_DATABASE_URL` | Set | Primary DB |
| `GITHUB_MODELS_TOKEN` | Not set | DeepSeek free tier (optional, falls to Kimi) |
| `METERED_WEBHOOK_SECRET` | Not set | TURN webhook auth (optional) |
| `TWILIO_ACCOUNT_SID` | Replit Secret | Twilio NTS TURN relay credentials |
| `TWILIO_AUTH_TOKEN` | Replit Secret | Twilio NTS TURN relay credentials |

## Deployment

**Target:** Replit VM (always-running — required for Socket.IO, WebSocket, Redis, BullMQ workers)
**Build:** `npm run build` → `tsx script/build.ts` (Vite client + esbuild server → `dist/`)
**Run:** `node dist/index.cjs`

The build script copies all Python sidecar scripts (`vision-detector.py`, `piper-tts-server.py`, `whisper-sidecar.py`) into `dist/`. Piper TTS and Whisper models are NOT bundled — they download at runtime to `/tmp/` on first use.

**Deployment image size:** ~62MB `dist/` (down from 183MB after removing committed model blobs). Python libraries (`.pythonlibs/`) add ~847MB at runtime but are not git-tracked.

## External Dependencies
- **Replit Auth**: User authentication.
- **JaaS (Jitsi as a Service) on 8x8.vc**: WebRTC video conferencing.
- **Google Gemini API**: Translation and language detection.
- **Piper TTS**: Primary local Text-to-Speech engine.
- **OpenAI API**: Fallback TTS voice synthesis and Whisper STT transcription.
- **Moonshot AI (Kimi)**: Primary AI provider for translation, health analysis, support chat, caption cleanup, call summaries, voice translation QA, language detection, token budget agent.
- **Claude (Anthropic)**: Last-resort AI for autonomous agent and critical fallback.
- **PostgreSQL**: Primary database on Supabase PostgreSQL.
- **Supabase**: Managed PostgreSQL, Supabase Storage for file uploads.
- **Resend**: Transactional emails.
- **Pollinations.ai**: AI custom emoji generation.
- **GIPHY API**: GIF search.
- **Redis (ioredis)**: For translation caching, agent metrics, and BullMQ queue.
- **BullMQ**: Redis-backed task queue.
- **Juno Vision v2**: Camera-based visual translator using local YOLOv5n ONNX detector (port 5098) + Tesseract OCR + repo-backed knowledge base (65 objects × 12 languages), with Gemini fallback. Detector auto-starts on server boot with health polling. Answer language matches frontend expectations (answer in sourceLang, sentence in targetLang).
- **Tool Execution Service**: System-wide wrapper for external API calls.
- **GitHub CDN** (`lasawno/junotalk-cdn`): Static hosting for translation fallback data.
- **Global 401 Handler**: `client/src/lib/queryClient.ts` contains a `handle401()` function that detects unauthorized responses from any API call and invalidates the auth cache, forcing a redirect to the login page. This prevents stale authenticated UI after session expiration or redeployment.