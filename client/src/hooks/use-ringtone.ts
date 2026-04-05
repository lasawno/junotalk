import { useEffect, useRef, useCallback } from "react";
import { CDN_ASSETS } from "@/lib/cdn";

export function useRingtone(shouldRing: boolean) {
  const audioContextRef = useRef<AudioContext | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const vibrationRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timeoutIdsRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const generationRef = useRef(0);
  const audioElementRef = useRef<HTMLAudioElement | null>(null);

  const clearTimeouts = useCallback(() => {
    timeoutIdsRef.current.forEach(id => clearTimeout(id));
    timeoutIdsRef.current = [];
  }, []);

  const startRinging = useCallback(() => {
    const gen = ++generationRef.current;

    // Try CDN ringtone MP3 first
    try {
      const audio = new Audio(CDN_ASSETS.ringtone);
      audio.loop = true;
      audio.volume = 0.7;
      audioElementRef.current = audio;
      const playPromise = audio.play();
      if (playPromise !== undefined) {
        playPromise.catch(() => {
          audioElementRef.current = null;
          startSynthRingtone(gen);
        });
      }
      if (navigator.vibrate) {
        navigator.vibrate([200, 100, 200, 100, 200]);
        vibrationRef.current = setInterval(() => {
          if (gen !== generationRef.current) return;
          navigator.vibrate?.([200, 100, 200, 100, 200]);
        }, 3000);
      }
      return;
    } catch {
      audioElementRef.current = null;
    }

    startSynthRingtone(gen);
  }, []);

  const startSynthRingtone = useCallback((gen: number) => {
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      audioContextRef.current = ctx;

      const gain = ctx.createGain();
      gain.gain.value = 0;
      gain.connect(ctx.destination);
      gainRef.current = gain;

      const isStale = () => gen !== generationRef.current || !audioContextRef.current || audioContextRef.current.state === "closed";

      let ringOn = true;
      const playTone = () => {
        if (isStale()) return;

        if (ringOn) {
          const osc1 = ctx.createOscillator();
          osc1.type = "sine";
          osc1.frequency.value = 440;
          osc1.connect(gain);
          osc1.start();

          gain.gain.setValueAtTime(0, ctx.currentTime);
          gain.gain.linearRampToValueAtTime(0.15, ctx.currentTime + 0.05);

          const t1 = setTimeout(() => {
            if (isStale()) return;
            try {
              gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.05);
            } catch {}
            const t2 = setTimeout(() => {
              try { osc1.stop(); } catch {}
            }, 80);
            timeoutIdsRef.current.push(t2);
          }, 400);
          timeoutIdsRef.current.push(t1);

          const t3 = setTimeout(() => {
            if (isStale()) return;
            const osc2 = ctx.createOscillator();
            osc2.type = "sine";
            osc2.frequency.value = 480;
            osc2.connect(gain);
            osc2.start();

            gain.gain.setValueAtTime(0, ctx.currentTime);
            gain.gain.linearRampToValueAtTime(0.15, ctx.currentTime + 0.05);

            const t4 = setTimeout(() => {
              if (isStale()) return;
              try {
                gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.05);
              } catch {}
              const t5 = setTimeout(() => {
                try { osc2.stop(); } catch {}
              }, 80);
              timeoutIdsRef.current.push(t5);
            }, 400);
            timeoutIdsRef.current.push(t4);
          }, 500);
          timeoutIdsRef.current.push(t3);
        }

        ringOn = !ringOn;
      };

      playTone();
      intervalRef.current = setInterval(playTone, 2000);

      if (navigator.vibrate) {
        navigator.vibrate([200, 100, 200, 100, 200]);
        vibrationRef.current = setInterval(() => {
          if (gen !== generationRef.current) return;
          if (navigator.vibrate) {
            navigator.vibrate([200, 100, 200, 100, 200]);
          }
        }, 3000);
      }
    } catch (e) {
      console.warn("Ringtone failed:", e);
      generationRef.current++;
    }
  }, []);

  const stopRinging = useCallback(() => {
    generationRef.current++;

    if (audioElementRef.current) {
      try {
        audioElementRef.current.pause();
        audioElementRef.current.currentTime = 0;
      } catch {}
      audioElementRef.current = null;
    }

    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    if (vibrationRef.current) {
      clearInterval(vibrationRef.current);
      vibrationRef.current = null;
    }

    clearTimeouts();

    if (navigator.vibrate) {
      navigator.vibrate(0);
    }

    try {
      if (gainRef.current) {
        gainRef.current.disconnect();
        gainRef.current = null;
      }
    } catch {}

    try {
      if (audioContextRef.current && audioContextRef.current.state !== "closed") {
        audioContextRef.current.close();
        audioContextRef.current = null;
      }
    } catch {}
  }, [clearTimeouts]);

  useEffect(() => {
    if (shouldRing) {
      startRinging();
    } else {
      stopRinging();
    }

    return () => {
      stopRinging();
    };
  }, [shouldRing, startRinging, stopRinging]);

  return { stopRinging };
}
