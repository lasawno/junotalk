/**
 * JunoTools — Juno Tools coming-soon showcase carousel.
 * • iPhone-style long-press (500ms) → wiggle / reorder mode
 * • Drag a card over another to swap positions
 * • Order persisted to localStorage
 * • "More Tools ›" hint in the section header
 */

import { useState, useRef, useCallback, useEffect } from "react";
import { Mail, ListChecks } from "lucide-react";
import junoBrowserImg from "@assets/juno_browser_v3_nobg.png";
import junoSmartTextImg from "@assets/juno-smart-text.png";
import junoVaultImg from "@assets/Untitled_design_1775101580879.png";

const STORAGE_KEY = "juno-tools-order";
const LONG_PRESS_MS = 500;
const MOVE_CANCEL_PX = 8;

interface JunoTool {
  id: string;
  name: string;
  subname?: string;
  icon: React.ReactNode;
  iconBg: string;
  borderColor: string;
  iconOverlay?: string;
}

const JUNO_TOOLS: JunoTool[] = [
  {
    id: "juno-vault",
    name: "Juno Vault",
    icon: (
      <img
        src={junoVaultImg}
        alt="Juno Vault"
        style={{ width: "86%", height: "86%", objectFit: "contain", display: "block" }}
      />
    ),
    iconBg: "linear-gradient(145deg, #1d4ed8 0%, #1e3a8a 100%)",
    borderColor: "rgba(96,165,250,0.85)",
  },
  {
    id: "organizer",
    name: "Organizer",
    icon: <ListChecks size={34} color="#fff" strokeWidth={1.8} />,
    iconBg: "linear-gradient(145deg, #f97316 0%, #c2410c 100%)",
    borderColor: "rgba(96,165,250,0.85)",
  },
  {
    id: "ai-mail",
    name: "AI Mail",
    icon: <Mail size={34} color="#fff" strokeWidth={1.8} />,
    iconBg: "linear-gradient(145deg, #7c3aed 0%, #3730a3 100%)",
    borderColor: "rgba(96,165,250,0.85)",
  },
  {
    id: "juno-browser",
    name: "Juno Browser VPN",
    icon: (
      <img
        src={junoBrowserImg}
        alt="Juno Browser Local VPN"
        style={{ width: "80%", height: "80%", objectFit: "contain", display: "block" }}
      />
    ),
    iconBg: "linear-gradient(145deg, #1d4ed8 0%, #1e3a8a 100%)",
    borderColor: "rgba(96,165,250,0.85)",
  },
  {
    id: "juno-smart-text",
    name: "Juno Smart",
    subname: "Chat",
    icon: (
      <img
        src={junoSmartTextImg}
        alt="Juno Smart Chat"
        style={{ width: "88%", height: "88%", objectFit: "contain", display: "block" }}
      />
    ),
    iconBg: "linear-gradient(145deg, #1d4ed8 0%, #1e3a8a 100%)",
    borderColor: "rgba(96,165,250,0.85)",
  },
];

const TOOL_MAP: Record<string, JunoTool> = Object.fromEntries(
  JUNO_TOOLS.map(t => [t.id, t])
);

function loadOrder(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed: string[] = JSON.parse(raw);
      const allIds = new Set(JUNO_TOOLS.map(t => t.id));
      if (
        parsed.length === JUNO_TOOLS.length &&
        parsed.every(id => allIds.has(id))
      ) return parsed;
    }
  } catch {}
  return JUNO_TOOLS.map(t => t.id);
}

function saveOrder(order: string[]) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(order)); } catch {}
}

export default function MediaCarousel() {
  const [order, setOrder] = useState<string[]>(loadOrder);
  const [reorderMode, setReorderMode] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragTranslateX, setDragTranslateX] = useState(0);
  const [popupToolId, setPopupToolId] = useState<string | null>(null);
  const popupTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showComingSoon = useCallback((id: string) => {
    if (popupTimerRef.current) clearTimeout(popupTimerRef.current);
    setPopupToolId(id);
    popupTimerRef.current = setTimeout(() => setPopupToolId(null), 2000);
  }, []);

  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pointerStart = useRef({ x: 0, y: 0 });
  const didCancelLongPress = useRef(false);
  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const containerRef = useRef<HTMLDivElement>(null);
  const orderRef = useRef(order);
  orderRef.current = order;

  const exitReorderMode = useCallback(() => {
    setReorderMode(false);
    setDragId(null);
    setDragTranslateX(0);
  }, []);

  const enterReorderMode = useCallback((id: string) => {
    try { navigator.vibrate?.(50); } catch {}
    setReorderMode(true);
    setDragId(id);
    setDragTranslateX(0);
  }, []);

  const cancelLongPress = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);

  const getIndexAtX = useCallback((clientX: number): number => {
    let closest = -1;
    let closestDist = Infinity;
    orderRef.current.forEach((id, i) => {
      const el = cardRefs.current.get(id);
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const center = rect.left + rect.width / 2;
      const dist = Math.abs(clientX - center);
      if (dist < closestDist) {
        closestDist = dist;
        closest = i;
      }
    });
    return closest;
  }, []);

  const handleCardPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>, id: string) => {
      pointerStart.current = { x: e.clientX, y: e.clientY };
      didCancelLongPress.current = false;
      cancelLongPress();
      longPressTimer.current = setTimeout(() => {
        if (!didCancelLongPress.current) {
          enterReorderMode(id);
        }
      }, LONG_PRESS_MS);
    },
    [cancelLongPress, enterReorderMode]
  );

  const handleCardPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>, id: string) => {
      const dx = Math.abs(e.clientX - pointerStart.current.x);
      const dy = Math.abs(e.clientY - pointerStart.current.y);

      if (!reorderMode) {
        if (dx > MOVE_CANCEL_PX || dy > MOVE_CANCEL_PX) {
          didCancelLongPress.current = true;
          cancelLongPress();
        }
        return;
      }

      if (dragId !== id) return;
      e.preventDefault();

      const translateX = e.clientX - pointerStart.current.x;
      setDragTranslateX(translateX);

      const newIndex = getIndexAtX(e.clientX);
      const currentIndex = orderRef.current.indexOf(id);
      if (newIndex !== -1 && newIndex !== currentIndex) {
        const next = [...orderRef.current];
        next.splice(currentIndex, 1);
        next.splice(newIndex, 0, id);
        setOrder(next);
        pointerStart.current = {
          x: e.clientX - (newIndex - currentIndex) * 0,
          y: e.clientY,
        };
      }
    },
    [reorderMode, dragId, cancelLongPress, getIndexAtX]
  );

  const handleCardPointerUp = useCallback(
    (_e: React.PointerEvent<HTMLDivElement>, id: string) => {
      cancelLongPress();
      if (dragId === id) {
        setDragId(null);
        setDragTranslateX(0);
        saveOrder(orderRef.current);
      }
    },
    [cancelLongPress, dragId]
  );

  useEffect(() => {
    if (!reorderMode) return;
    const handleOutside = (e: PointerEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        exitReorderMode();
        saveOrder(orderRef.current);
      }
    };
    document.addEventListener("pointerdown", handleOutside);
    return () => document.removeEventListener("pointerdown", handleOutside);
  }, [reorderMode, exitReorderMode]);

  return (
    <div className="shrink-0 mt-1 relative" data-testid="juno-tools-section">

      {/* Coming Soon popup — floats above the section header */}
      {popupToolId && (
        <div
          className="absolute left-1/2 flex flex-col items-center pointer-events-none"
          style={{ bottom: "calc(100% + 6px)", transform: "translateX(-50%)", zIndex: 60, animation: "junoPopIn 0.18s ease-out" }}
        >
          <div
            className="px-4 py-2 rounded-2xl text-center whitespace-nowrap"
            style={{
              background: "rgba(10,18,48,0.97)",
              border: "1px solid rgba(96,165,250,0.5)",
              boxShadow: "0 6px 28px rgba(0,0,0,0.7)",
              backdropFilter: "blur(16px)",
            }}
          >
            <p className="text-[12px] font-bold text-white leading-none">Coming Soon</p>
            <p className="text-[9px] text-blue-300/70 mt-0.5">
              {TOOL_MAP[popupToolId]?.name ?? "This tool"} is in development
            </p>
          </div>
          <div style={{ width: 0, height: 0, borderLeft: "7px solid transparent", borderRight: "7px solid transparent", borderTop: "7px solid rgba(96,165,250,0.5)" }} />
        </div>
      )}

      {/* Section header */}
      <div
        className="flex items-center gap-2 px-2 py-1.5 rounded-xl mb-3"
        style={{ background: "rgba(8,14,32,0.92)" }}
      >
        <span
          className="text-[11px] font-bold text-white uppercase tracking-wider"
          style={{ textShadow: "0 1px 6px rgba(0,0,0,1)" }}
        >
          Juno Tools
        </span>

        <span
          className="text-[8.5px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full"
          style={{
            background: "rgba(250,204,21,0.12)",
            color: "#fde68a",
            border: "1px solid rgba(250,204,21,0.25)",
            letterSpacing: "0.07em",
          }}
        >
          Coming Soon
        </span>

        <div className="flex-1" />

        {reorderMode ? (
          <button
            onClick={() => { exitReorderMode(); saveOrder(orderRef.current); }}
            className="text-[10px] font-bold px-2 py-0.5 rounded-full"
            style={{
              background: "rgba(96,165,250,0.18)",
              color: "#93c5fd",
              border: "1px solid rgba(96,165,250,0.35)",
            }}
            data-testid="button-done-reorder"
          >
            Done
          </button>
        ) : (
          <span className="text-[13px] font-semibold text-blue-200 tracking-wide" style={{ opacity: 0.55 }}>
            ‹‹ Swipe ››
          </span>
        )}
      </div>

      {reorderMode && (
        <p
          className="text-center text-xs font-semibold text-white mb-2 tracking-wide px-3 py-1 mx-auto rounded-full bg-blue-500/70 w-fit"
          style={{ letterSpacing: "0.05em", textShadow: "0 1px 4px rgba(0,0,0,0.5)" }}
        >
          Hold &amp; drag to rearrange
        </p>
      )}

      {/* Carousel — always 4 visible, swipe for more */}
      <div
        ref={containerRef}
        className="flex gap-2 pb-1"
        style={{
          overflowX: reorderMode ? "hidden" : "auto",
          scrollbarWidth: "none",
          msOverflowStyle: "none",
          scrollSnapType: reorderMode ? "none" : "x mandatory",
          WebkitOverflowScrolling: "touch",
          paddingLeft: 4,
          paddingRight: 4,
          userSelect: "none",
        }}
      >
        {order.map(id => {
          const tool = TOOL_MAP[id];
          if (!tool) return null;
          const isDragging = dragId === id;

          return (
            <div
              key={tool.id}
              ref={el => {
                if (el) cardRefs.current.set(tool.id, el);
                else cardRefs.current.delete(tool.id);
              }}
              className="flex-shrink-0 flex flex-col items-center gap-2"
              style={{
                width: "calc(25% - 6px)",
                minWidth: 0,
                scrollSnapAlign: reorderMode ? "none" : "start",
                touchAction: reorderMode ? "none" : "pan-x",
                transform: isDragging
                  ? `translateX(${dragTranslateX}px) scale(1.08)`
                  : "translateX(0) scale(1)",
                transition: isDragging ? "none" : "transform 0.18s ease",
                zIndex: isDragging ? 10 : 1,
                position: "relative",
                animation: reorderMode && !isDragging
                  ? "junoWiggle 0.28s ease-in-out infinite alternate"
                  : "none",
                cursor: reorderMode ? "grab" : "default",
              }}
              data-testid={`juno-tool-card-${tool.id}`}
              onPointerDown={e => handleCardPointerDown(e, tool.id)}
              onPointerMove={e => handleCardPointerMove(e, tool.id)}
              onPointerUp={e => handleCardPointerUp(e, tool.id)}
              onPointerCancel={e => handleCardPointerUp(e, tool.id)}
              onClick={() => { if (!reorderMode && !dragId) showComingSoon(tool.id); }}
            >
              <div
                className="rounded-2xl relative overflow-hidden flex items-center justify-center"
                style={{
                  width: 62,
                  height: 62,
                  background: tool.iconBg,
                  border: `2px solid ${isDragging ? "rgba(147,197,253,0.9)" : tool.borderColor}`,
                  boxShadow: isDragging
                    ? "0 8px 32px rgba(0,0,0,0.65), 0 0 0 2px rgba(96,165,250,0.5)"
                    : "0 4px 16px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.08)",
                  flexShrink: 0,
                }}
              >
                <div className="absolute inset-0 flex items-center justify-center">
                  {tool.icon}
                </div>
                {tool.iconOverlay && (
                  <div
                    className="absolute inset-0 rounded-2xl pointer-events-none"
                    style={{ background: tool.iconOverlay }}
                  />
                )}
              </div>

              <div className="flex flex-col items-center gap-0">
                <span
                  className="font-bold leading-tight text-center"
                  style={{ fontSize: 13, color: "#ffffff" }}
                >
                  {tool.name}
                </span>
                {tool.subname && (
                  <span
                    className="font-semibold leading-tight text-center"
                    style={{ fontSize: 12, color: "#ffffff" }}
                  >
                    {tool.subname}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <style>{`
        @keyframes junoWiggle {
          0%   { transform: rotate(-1.8deg) scale(1); }
          100% { transform: rotate(1.8deg)  scale(1); }
        }
        @keyframes junoPopIn {
          0%   { opacity: 0; transform: translateX(-50%) scale(0.8) translateY(6px); }
          100% { opacity: 1; transform: translateX(-50%) scale(1)   translateY(0px); }
        }
      `}</style>

    </div>
  );
}
