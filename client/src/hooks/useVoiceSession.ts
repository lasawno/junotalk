/**
 * useVoiceSession.ts
 *
 * React hook wrapper around VoiceSession.
 * Handles create/destroy lifecycle, exposes reactive state, and
 * keeps the session config in sync when props change.
 *
 * Example:
 *   const { phase, start, stop, speak, unlock } = useVoiceSession({
 *     lang: fromLang,
 *     voiceId: selectedVoice,
 *     onFinalTranscript: (text) => translateText(text, true),
 *     fetchAudio: async (text, lang, voiceId, speed) => { ... },
 *   });
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { VoiceSession, VoicePhase, VoiceSessionOptions } from '@/lib/audio/VoiceSession';

export type { VoicePhase };

export interface UseVoiceSessionOptions
  extends Omit<VoiceSessionOptions, 'onPhaseChange'> {}

export interface UseVoiceSessionResult {
  phase: VoicePhase;
  isListening: boolean;
  isProcessing: boolean;
  isSpeaking: boolean;
  start: () => void;
  stop: () => void;
  speak: (text: string) => Promise<void>;
  pauseForProcessing: () => void;
  unlock: () => void;
  setLang: (lang: string) => void;
  setVoiceId: (id: string) => void;
  setSpeed: (speed: number) => void;
}

export function useVoiceSession(opts: UseVoiceSessionOptions): UseVoiceSessionResult {
  const [phase, setPhase] = useState<VoicePhase>('idle');

  // Keep a stable ref to the session — recreated only on mount/unmount
  const sessionRef = useRef<VoiceSession | null>(null);

  // Keep latest opts in a ref so callbacks always see current values
  // without needing to recreate the VoiceSession
  const optsRef = useRef(opts);
  useEffect(() => { optsRef.current = opts; }, [opts]);

  // Create session once on mount
  useEffect(() => {
    const session = new VoiceSession({
      // Delegate all callbacks through the ref so they always use latest values
      lang: optsRef.current.lang,
      speechSpeed: optsRef.current.speechSpeed,
      voiceId: optsRef.current.voiceId,
      onFinalTranscript: (text) => optsRef.current.onFinalTranscript(text),
      onInterimTranscript: (text) => optsRef.current.onInterimTranscript?.(text),
      onError: (msg) => optsRef.current.onError?.(msg),
      fetchAudio: (text, lang, voiceId, speed) =>
        optsRef.current.fetchAudio(text, lang, voiceId, speed),
      onPhaseChange: (p) => setPhase(p),
    });
    sessionRef.current = session;

    return () => {
      session.destroy();
      sessionRef.current = null;
    };
  }, []); // intentionally empty — session lives for component lifetime

  // Sync lang/voiceId/speed changes to the session without recreating it
  useEffect(() => {
    sessionRef.current?.setLang(opts.lang);
  }, [opts.lang]);

  useEffect(() => {
    if (opts.voiceId) sessionRef.current?.setVoiceId(opts.voiceId);
  }, [opts.voiceId]);

  useEffect(() => {
    if (opts.speechSpeed != null) sessionRef.current?.setSpeed(opts.speechSpeed);
  }, [opts.speechSpeed]);

  const start              = useCallback(() => sessionRef.current?.start(),                   []);
  const stop               = useCallback(() => sessionRef.current?.stop(),                    []);
  const speak              = useCallback((text: string, ttsLang?: string, ttsVoiceId?: string) =>
    sessionRef.current?.speak(text, ttsLang, ttsVoiceId) ?? Promise.resolve(),               []);
  const pauseForProcessing = useCallback(() => sessionRef.current?.pauseForProcessing(),      []);
  const unlock             = useCallback(() => sessionRef.current?.unlock(),                  []);
  const setLang            = useCallback((lang: string) => sessionRef.current?.setLang(lang), []);
  const setVoiceId         = useCallback((id: string)   => sessionRef.current?.setVoiceId(id), []);
  const setSpeed           = useCallback((s: number)    => sessionRef.current?.setSpeed(s),  []);

  return {
    phase,
    isListening:  phase === 'listening',
    isProcessing: phase === 'processing',
    isSpeaking:   phase === 'speaking',
    start,
    stop,
    speak,
    pauseForProcessing,
    unlock,
    setLang,
    setVoiceId,
    setSpeed,
  };
}
