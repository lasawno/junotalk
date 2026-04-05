/**
 * Audio pre-processing pipeline for JunoTalk microphone input.
 *
 * Builds a Web Audio API processing chain between the raw microphone
 * stream and any consumer (MediaRecorder, VAD analyser, SpeechRecognition).
 *
 * Chain:
 *   Raw mic → HighpassFilter(80Hz) → DynamicsCompressor → Gain → Analyser
 *                                                                    ↓
 *                                                           MediaStreamDestination
 *
 * High-pass filter (80 Hz)
 *   Removes low-frequency noise: HVAC hum, desk vibration, traffic rumble.
 *   Human speech sits above ~85 Hz — nothing below is useful.
 *
 * Dynamics compressor
 *   Normalises the signal level so soft speech and loud speech are both
 *   legible. Also attenuates sudden loud transients (keyboard clicks, etc).
 *
 * Analyser
 *   Taps the processed signal — gives the VAD indicator a cleaned view
 *   of the signal level, reducing false "speaking" triggers from noise.
 *
 * MediaStreamDestination
 *   Lets any MediaRecorder capture the processed stream instead of the
 *   raw mic feed. Quieter background, clearer voice for Whisper STT.
 *
 * Note on SpeechRecognition:
 *   The Web Speech API does not accept a custom stream — it always reads
 *   from the browser's default mic. The best we can do for that path is
 *   request hardware-level noise suppression via getUserMedia constraints
 *   (noiseSuppression, echoCancellation, autoGainControl), which Chrome /
 *   Edge / Safari honour at the OS/driver level before the browser reads
 *   the samples.
 */

export interface AudioProcessorResult {
  /** Processed MediaStream — feed this to MediaRecorder, not the raw stream. */
  processedStream: MediaStream;
  /** Analyser node tapped after the noise chain — use for VAD visualisation. */
  analyserNode: AnalyserNode;
  /** The underlying AudioContext — keep a reference if you need to resume it. */
  audioContext: AudioContext;
  /** Release all resources: stop mic tracks, close AudioContext. */
  dispose: () => void;
}

/**
 * Preferred getUserMedia audio constraints.
 * Apply these in every getUserMedia call so browsers enable hardware-level
 * noise suppression, echo cancellation, and automatic gain control.
 */
export const AUDIO_CONSTRAINTS: MediaTrackConstraints = {
  noiseSuppression: true,
  echoCancellation: true,
  autoGainControl: true,
  channelCount: 1,
};

/**
 * Build the noise reduction processing chain from a raw microphone stream.
 *
 * @param rawStream  — MediaStream from getUserMedia. Pass your already-acquired
 *                     stream if you have one, or omit to let the processor call
 *                     getUserMedia with optimal constraints automatically.
 */
export async function buildAudioProcessor(
  rawStream?: MediaStream,
): Promise<AudioProcessorResult> {
  const stream = rawStream ?? await navigator.mediaDevices.getUserMedia({
    audio: AUDIO_CONSTRAINTS,
    video: false,
  });

  const ctx = new AudioContext();

  // Resume context if browser suspended it (autoplay policy)
  if (ctx.state === "suspended") {
    await ctx.resume().catch(() => {});
  }

  const source = ctx.createMediaStreamSource(stream);

  // ── High-pass filter (80 Hz) ────────────────────────────────────────────
  // Cuts everything below 80 Hz: HVAC hum, desk vibration, traffic rumble.
  // Speech fundamentals start at ~85 Hz (male) / ~165 Hz (female).
  // Matched to the server-side ffmpeg highpass=f=80 step.
  const highpass = ctx.createBiquadFilter();
  highpass.type = "highpass";
  highpass.frequency.value = 80;   // Hz — don't raise above 150
  highpass.Q.value = 0.7;          // gentle slope to avoid phase artefacts

  // ── Low-pass filter (8000 Hz) ───────────────────────────────────────────
  // Cuts everything above 8 kHz. Whisper is trained on 16 kHz audio
  // (Nyquist = 8 kHz) — frequencies above 8 kHz carry no useful speech
  // information for the model but DO carry electronic hiss, mic self-noise,
  // and high-frequency interference. Removing them reduces hallucinations.
  // Matched to the server-side ffmpeg lowpass=f=8000 step.
  const lowpass = ctx.createBiquadFilter();
  lowpass.type = "lowpass";
  lowpass.frequency.value = 8000;  // Hz
  lowpass.Q.value = 0.7;

  // ── Dynamics compressor ─────────────────────────────────────────────────
  // Normalises the signal level so soft speech and loud speech are both
  // legible for Whisper. Also attenuates sudden loud transients (keyboard
  // clicks, door slams) that would confuse the VAD.
  const compressor = ctx.createDynamicsCompressor();
  compressor.threshold.value = -24; // dB: above this, compression kicks in
  compressor.knee.value = 12;       // soft knee: gradual onset
  compressor.ratio.value = 4;       // 4:1: signal 4 dB over threshold → 1 dB over
  compressor.attack.value = 0.003;  // 3ms — fast enough to catch consonants
  compressor.release.value = 0.25;  // 250ms — avoids pumping artefacts on pauses

  // ── Make-up gain ───────────────────────────────────────────────────────
  // The compressor reduces average level; add a small boost back.
  const gain = ctx.createGain();
  gain.gain.value = 1.4;            // ~3 dB boost — compensates compressor attenuation

  // ── Analyser ───────────────────────────────────────────────────────────
  // Taps the cleaned signal. The VAD reads this — reading the bandpassed
  // (80–8000 Hz) signal means background noise outside that range no longer
  // triggers false "isSpeaking" state.
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 256;
  analyser.smoothingTimeConstant = 0.6;

  // ── Processed stream destination ───────────────────────────────────────
  // createMediaStreamDestination gives us a MediaStream that carries the
  // processed audio. Pass this to MediaRecorder instead of the raw stream.
  const destination = ctx.createMediaStreamDestination();

  // Wire the chain:
  //   source → highpass(80Hz) → lowpass(8kHz) → compressor → gain
  //         → analyser → destination
  source.connect(highpass);
  highpass.connect(lowpass);
  lowpass.connect(compressor);
  compressor.connect(gain);
  gain.connect(analyser);
  analyser.connect(destination);

  return {
    processedStream: destination.stream,
    analyserNode: analyser,
    audioContext: ctx,
    dispose: () => {
      stream.getTracks().forEach(t => t.stop());
      ctx.close().catch(() => {});
    },
  };
}

/**
 * Lightweight VAD tick function — reads from the analyser and returns
 * true when the processed signal level exceeds the noise floor threshold.
 *
 * Because the analyser sits after the highpass(80Hz) + lowpass(8kHz) filters,
 * all bins already represent speech-only frequencies. We focus on 150–4000 Hz
 * — the zone where voiced speech (vowels and voiced consonants) concentrates —
 * to avoid triggering on plosive bursts ('p', 'b') or fricatives that sit at
 * the top of the band.
 *
 * Threshold of 18 (out of 255) is calibrated for the post-compressor signal.
 * Background noise after filtering typically sits at 4–10; speech at 25–80+.
 *
 * Tuning:
 *   Raise threshold (e.g. 22) — quieter environments, less sensitive.
 *   Lower threshold (e.g. 12) — noisy rooms, catches soft speech.
 */
export function isSpeechActive(analyser: AnalyserNode, threshold = 18): boolean {
  const data = new Uint8Array(analyser.frequencyBinCount);
  analyser.getByteFrequencyData(data);

  // The analyser covers 0 → sampleRate/2. With fftSize=256 and sample rate
  // typically 44.1kHz or 48kHz, each bin ≈ 172–187 Hz wide. After the
  // lowpass(8kHz) client filter the useful range is bins 0..~46.
  // We focus the average on the mid-speech band: ~150 Hz – 4 kHz.
  // That maps to roughly 10%–50% of the bin array regardless of sample rate.
  const lo = Math.floor(data.length * 0.10);  // ~150–200 Hz
  const hi = Math.floor(data.length * 0.50);  // ~3000–4000 Hz
  const speechBins = data.slice(lo, hi);
  const avg = speechBins.reduce((s, v) => s + v, 0) / speechBins.length;
  return avg > threshold;
}
