import { useState, useRef, useEffect, useCallback } from "react";
import { ArrowLeft, Send, Loader2, Download, Sparkles, MessageCircle, PenLine, RotateCcw, Check } from "lucide-react";

interface ImageEntry {
  url: string;
  label: string;
  model: string;
}

interface ImageVersion {
  prompt: string;
  refinement?: string;
  imageUrls: ImageEntry[];
  selectedIdx: number;
}

interface SelectionRect {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
}

interface Props {
  initialImageUrls: ImageEntry[];
  originalPrompt: string;
  onClose: () => void;
  onSendToChat: (imageUrls: ImageEntry[], prompt: string) => void;
  onNewVersion?: (imageUrls: ImageEntry[], combinedPrompt: string) => void;
}

function regionToText(rect: SelectionRect, canvasW: number, canvasH: number): string {
  const x1 = Math.min(rect.startX, rect.endX);
  const y1 = Math.min(rect.startY, rect.endY);
  const x2 = Math.max(rect.startX, rect.endX);
  const y2 = Math.max(rect.startY, rect.endY);
  const w = x2 - x1;
  const h = y2 - y1;
  const cx = (x1 + w / 2) / canvasW;
  const cy = (y1 + h / 2) / canvasH;
  const covW = w / canvasW;
  const covH = h / canvasH;

  if (covW * covH > 0.55) return "the entire scene";

  const hPos = cx < 0.35 ? "left" : cx > 0.65 ? "right" : "center";
  const vPos = cy < 0.33 ? "top" : cy > 0.67 ? "bottom" : "middle";

  if (vPos === "middle" && hPos === "center") return "the center area";
  if (vPos === "middle") return `the ${hPos} side`;
  if (hPos === "center") return `the ${vPos} portion`;
  return `the ${vPos}-${hPos} area`;
}

export default function ImageSessionModal({ initialImageUrls, originalPrompt, onClose, onSendToChat, onNewVersion }: Props) {
  const [versions, setVersions] = useState<ImageVersion[]>([
    { prompt: originalPrompt, imageUrls: initialImageUrls, selectedIdx: 0 },
  ]);
  const [currentVersionIdx, setCurrentVersionIdx] = useState(0);
  const [mode, setMode] = useState<"refine" | "edit">("refine");
  const [refinement, setRefinement] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Edit area state
  const [selection, setSelection] = useState<SelectionRect | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [areaDescription, setAreaDescription] = useState("");
  const [selectionConfirmed, setSelectionConfirmed] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const areaInputRef = useRef<HTMLInputElement>(null);
  const versionsScrollRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageContainerRef = useRef<HTMLDivElement>(null);

  const currentVersion = versions[currentVersionIdx];
  const currentImage = currentVersion.imageUrls[currentVersion.selectedIdx];

  useEffect(() => {
    if (mode === "refine") inputRef.current?.focus();
  }, [mode]);

  useEffect(() => {
    if (versionsScrollRef.current) {
      versionsScrollRef.current.scrollLeft = versionsScrollRef.current.scrollWidth;
    }
  }, [versions.length]);

  // Redraw canvas whenever selection changes
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!selection) return;

    const x1 = Math.min(selection.startX, selection.endX);
    const y1 = Math.min(selection.startY, selection.endY);
    const w = Math.abs(selection.endX - selection.startX);
    const h = Math.abs(selection.endY - selection.startY);

    // Dim outside selection
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.clearRect(x1, y1, w, h);

    // Selection border
    ctx.strokeStyle = selectionConfirmed ? "rgba(34,197,94,0.9)" : "rgba(99,179,237,0.95)";
    ctx.lineWidth = 2;
    ctx.setLineDash(selectionConfirmed ? [] : [6, 3]);
    ctx.strokeRect(x1, y1, w, h);

    // Corner handles
    const handleSize = 8;
    ctx.fillStyle = selectionConfirmed ? "rgba(34,197,94,0.9)" : "rgba(99,179,237,0.95)";
    ctx.setLineDash([]);
    [[x1, y1], [x1 + w, y1], [x1, y1 + h], [x1 + w, y1 + h]].forEach(([hx, hy]) => {
      ctx.fillRect(hx - handleSize / 2, hy - handleSize / 2, handleSize, handleSize);
    });

    // Region label
    if (w > 40 && h > 20) {
      ctx.fillStyle = selectionConfirmed ? "rgba(34,197,94,0.85)" : "rgba(59,130,246,0.85)";
      ctx.fillRect(x1, y1 - 22, Math.min(w, 160), 20);
      ctx.fillStyle = "#fff";
      ctx.font = "bold 10px Inter, system-ui, sans-serif";
      ctx.fillText(regionToText(selection, canvas.width, canvas.height), x1 + 6, y1 - 7);
    }
  }, [selection, selectionConfirmed]);

  function getCanvasPos(e: React.MouseEvent | React.TouchEvent): { x: number; y: number } | null {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    if ("touches" in e) {
      const touch = e.touches[0] || e.changedTouches[0];
      return { x: (touch.clientX - rect.left) * scaleX, y: (touch.clientY - rect.top) * scaleY };
    }
    return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
  }

  function handleCanvasStart(e: React.MouseEvent | React.TouchEvent) {
    e.preventDefault();
    const pos = getCanvasPos(e);
    if (!pos) return;
    setIsDragging(true);
    setDragStart(pos);
    setSelection({ startX: pos.x, startY: pos.y, endX: pos.x, endY: pos.y });
    setSelectionConfirmed(false);
    setAreaDescription("");
  }

  function handleCanvasMove(e: React.MouseEvent | React.TouchEvent) {
    e.preventDefault();
    if (!isDragging || !dragStart) return;
    const pos = getCanvasPos(e);
    if (!pos) return;
    setSelection({ startX: dragStart.x, startY: dragStart.y, endX: pos.x, endY: pos.y });
  }

  function handleCanvasEnd(e: React.MouseEvent | React.TouchEvent) {
    e.preventDefault();
    setIsDragging(false);
    const w = selection ? Math.abs(selection.endX - selection.startX) : 0;
    const h = selection ? Math.abs(selection.endY - selection.startY) : 0;
    if (w < 10 || h < 10) {
      setSelection(null);
    } else {
      setSelectionConfirmed(true);
      setTimeout(() => areaInputRef.current?.focus(), 100);
    }
  }

  function clearSelection() {
    setSelection(null);
    setSelectionConfirmed(false);
    setAreaDescription("");
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext("2d");
      ctx?.clearRect(0, 0, canvas.width, canvas.height);
    }
  }

  function setSelectedIdx(vIdx: number, imgIdx: number) {
    setVersions(prev => prev.map((v, i) => i === vIdx ? { ...v, selectedIdx: imgIdx } : v));
  }

  async function generateVersion(combinedPrompt: string, refText: string) {
    setIsGenerating(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/image/refine", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ originalPrompt, refinement: refText }),
      });
      if (res.status === 429) {
        const data = await res.json();
        setError(data.message || "Daily image limit reached.");
        return;
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.message || "Generation failed. Try again.");
        return;
      }
      const data = await res.json();
      const newImageUrls: ImageEntry[] = data.imageUrls || [];
      if (!newImageUrls.length) { setError("No images returned. Try again."); return; }

      const newVersion: ImageVersion = { prompt: combinedPrompt, refinement: refText, imageUrls: newImageUrls, selectedIdx: 0 };
      setVersions(prev => [...prev, newVersion]);
      setCurrentVersionIdx(prev => prev + 1);
      setRefinement("");
      clearSelection();
      onNewVersion?.(newImageUrls, combinedPrompt);
    } catch {
      setError("Something went wrong. Check your connection.");
    } finally {
      setIsGenerating(false);
    }
  }

  async function handleRefine() {
    const text = refinement.trim();
    if (!text || isGenerating) return;
    await generateVersion(`${originalPrompt}, ${text}`, text);
  }

  async function handleEditArea() {
    if (!selection || !areaDescription.trim() || isGenerating) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const region = regionToText(selection, canvas.width, canvas.height);
    const refText = `in ${region}, change it to show ${areaDescription.trim()}`;
    await generateVersion(`${originalPrompt}, ${refText}`, refText);
    setAreaDescription("");
  }

  function handleDownload() {
    if (!currentImage?.url) return;
    const a = document.createElement("a");
    a.href = currentImage.url;
    a.download = `juno-image-v${currentVersionIdx + 1}.png`;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.click();
  }

  const imgBG = "rgba(59,130,246,0.18)";

  return (
    <div className="h-full flex flex-col" style={{ background: "linear-gradient(160deg, #060d1f 0%, #0a1535 60%, #091228 100%)" }}>

      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 flex-shrink-0" style={{ borderBottom: "1px solid rgba(59,130,246,0.18)" }}>
        <button onClick={onClose} className="w-9 h-9 rounded-full flex items-center justify-center active:scale-90 transition-transform" style={{ background: "rgba(255,255,255,0.08)" }} data-testid="button-image-session-back">
          <ArrowLeft className="w-5 h-5 text-white" />
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-white leading-tight">Image Session</p>
          <p className="text-[10px] text-blue-300/70 truncate">{originalPrompt}</p>
        </div>
        <button
          onClick={() => onSendToChat(currentVersion.imageUrls, currentVersion.prompt)}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full active:scale-90 transition-transform"
          style={{ background: "rgba(59,130,246,0.22)", border: "1px solid rgba(59,130,246,0.35)" }}
          data-testid="button-continue-in-chat"
          title="Continue in chat"
        >
          <MessageCircle className="w-3.5 h-3.5 text-blue-300" />
          <span className="text-[10px] font-semibold text-blue-200">Chat</span>
        </button>
        <button onClick={handleDownload} className="w-9 h-9 rounded-full flex items-center justify-center active:scale-90 transition-transform" style={{ background: "rgba(255,255,255,0.08)" }} data-testid="button-image-session-download">
          <Download className="w-4 h-4 text-blue-300" />
        </button>
      </div>

      {/* Mode tab strip */}
      <div className="flex gap-1 px-4 pt-2 pb-1 flex-shrink-0">
        <button
          onClick={() => { setMode("refine"); clearSelection(); }}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all"
          style={{
            background: mode === "refine" ? "rgba(59,130,246,0.35)" : "rgba(255,255,255,0.06)",
            border: mode === "refine" ? "1px solid rgba(59,130,246,0.5)" : "1px solid rgba(255,255,255,0.1)",
            color: mode === "refine" ? "#93c5fd" : "rgba(255,255,255,0.45)",
          }}
          data-testid="tab-refine"
        >
          <Sparkles className="w-3 h-3" />
          Refine
        </button>
        <button
          onClick={() => { setMode("edit"); setRefinement(""); }}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all"
          style={{
            background: mode === "edit" ? "rgba(34,197,94,0.25)" : "rgba(255,255,255,0.06)",
            border: mode === "edit" ? "1px solid rgba(34,197,94,0.45)" : "1px solid rgba(255,255,255,0.1)",
            color: mode === "edit" ? "#86efac" : "rgba(255,255,255,0.45)",
          }}
          data-testid="tab-edit-area"
        >
          <PenLine className="w-3 h-3" />
          Edit Area
        </button>
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">

        {/* Image + canvas overlay */}
        <div ref={imageContainerRef} className="flex-1 relative flex items-center justify-center px-4 py-2 min-h-0">
          {currentImage?.url ? (
            <div className="relative max-w-full max-h-full flex items-center justify-center">
              <img
                src={currentImage.url}
                alt={currentVersion.prompt}
                className="max-w-full max-h-full object-contain rounded-2xl"
                style={{ border: `1px solid ${mode === "edit" ? "rgba(34,197,94,0.35)" : "rgba(59,130,246,0.30)"}`, boxShadow: `0 4px 32px ${imgBG}`, display: "block" }}
                data-testid="img-session-current"
                onLoad={e => {
                  const img = e.currentTarget;
                  const canvas = canvasRef.current;
                  if (canvas) {
                    canvas.width = img.naturalWidth;
                    canvas.height = img.naturalHeight;
                  }
                }}
              />
              {/* Canvas overlay — only visible in edit mode */}
              {mode === "edit" && (
                <canvas
                  ref={canvasRef}
                  className="absolute inset-0 w-full h-full rounded-2xl"
                  style={{ cursor: "crosshair", touchAction: "none" }}
                  onMouseDown={handleCanvasStart}
                  onMouseMove={handleCanvasMove}
                  onMouseUp={handleCanvasEnd}
                  onTouchStart={handleCanvasStart}
                  onTouchMove={handleCanvasMove}
                  onTouchEnd={handleCanvasEnd}
                  data-testid="canvas-region-select"
                />
              )}
              {/* Edit mode hint */}
              {mode === "edit" && !selection && (
                <div className="absolute bottom-3 left-0 right-0 flex justify-center pointer-events-none">
                  <span className="px-3 py-1.5 rounded-full text-[10px] font-semibold text-white/70" style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(8px)" }}>
                    Draw a box on the area you want to change
                  </span>
                </div>
              )}
            </div>
          ) : (
            <div className="w-full aspect-square rounded-2xl flex items-center justify-center" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(59,130,246,0.18)" }}>
              <Loader2 className="w-8 h-8 text-blue-400 animate-spin" />
            </div>
          )}
        </div>

        {/* Model variant selector */}
        {currentVersion.imageUrls.length > 1 && (
          <div className="flex gap-1.5 px-4 pb-1.5 flex-shrink-0 overflow-x-auto" style={{ scrollbarWidth: "none" }}>
            {currentVersion.imageUrls.map((img, idx) => (
              <button
                key={idx}
                onClick={() => setSelectedIdx(currentVersionIdx, idx)}
                className="flex-shrink-0 px-2.5 py-1 rounded-full text-[10px] font-semibold transition-all active:scale-95"
                style={{
                  background: currentVersion.selectedIdx === idx ? "rgba(59,130,246,0.5)" : "rgba(255,255,255,0.08)",
                  border: currentVersion.selectedIdx === idx ? "1px solid rgba(59,130,246,0.6)" : "1px solid rgba(255,255,255,0.12)",
                  color: currentVersion.selectedIdx === idx ? "#fff" : "rgba(255,255,255,0.5)",
                }}
                data-testid={`button-model-variant-${idx}`}
              >
                {img.label}
              </button>
            ))}
          </div>
        )}

        {/* Version strip */}
        {versions.length > 1 && (
          <div ref={versionsScrollRef} className="flex gap-2 px-4 pb-1.5 flex-shrink-0 overflow-x-auto" style={{ scrollbarWidth: "none" }}>
            {versions.map((v, idx) => (
              <button key={idx} onClick={() => setCurrentVersionIdx(idx)} className="flex-shrink-0 flex flex-col items-center gap-0.5 active:scale-95 transition-transform" data-testid={`button-version-${idx + 1}`}>
                <div className="relative rounded-lg overflow-hidden" style={{ width: 48, height: 48, border: currentVersionIdx === idx ? "2px solid rgba(59,130,246,0.8)" : "1px solid rgba(255,255,255,0.15)", opacity: currentVersionIdx === idx ? 1 : 0.5 }}>
                  <img src={v.imageUrls[v.selectedIdx]?.url} alt={`V${idx + 1}`} className="w-full h-full object-cover" />
                </div>
                <span className="text-[9px] font-semibold" style={{ color: currentVersionIdx === idx ? "#93c5fd" : "rgba(255,255,255,0.35)" }}>V{idx + 1}</span>
              </button>
            ))}
          </div>
        )}

        {/* Version label */}
        <div className="px-4 pb-1 flex-shrink-0 flex items-center gap-2">
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: "rgba(59,130,246,0.22)", color: "#93c5fd", border: "1px solid rgba(59,130,246,0.3)" }}>
            Version {currentVersionIdx + 1}
          </span>
          {currentVersion.refinement && (
            <span className="text-[10px] text-white/35 italic truncate flex-1">"{currentVersion.refinement}"</span>
          )}
        </div>

        {/* Error */}
        {error && (
          <div className="mx-4 mb-1 px-3 py-2 rounded-xl text-xs text-red-300 flex-shrink-0" style={{ background: "rgba(220,38,38,0.15)", border: "1px solid rgba(220,38,38,0.3)" }}>
            {error}
          </div>
        )}

        {/* Bottom input bar */}
        <div className="flex-shrink-0 px-4 py-3" style={{ borderTop: "1px solid rgba(59,130,246,0.15)" }}>

          {/* Refine mode */}
          {mode === "refine" && (
            <div className="flex items-center gap-2">
              <div className="flex-1 flex items-center rounded-2xl px-3 py-2 gap-2" style={{ background: "rgba(255,255,255,0.07)", border: "1px solid rgba(59,130,246,0.25)" }}>
                <Sparkles className="w-3.5 h-3.5 text-blue-400 flex-shrink-0" />
                <input
                  ref={inputRef}
                  type="text"
                  value={refinement}
                  onChange={e => setRefinement(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleRefine(); } }}
                  placeholder="Describe a change... (e.g. make it night time)"
                  className="flex-1 bg-transparent text-sm text-white placeholder-white/30 outline-none"
                  disabled={isGenerating}
                  data-testid="input-image-refinement"
                />
              </div>
              <button
                onClick={handleRefine}
                disabled={!refinement.trim() || isGenerating}
                className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 transition-all active:scale-90 disabled:opacity-40"
                style={{ background: refinement.trim() && !isGenerating ? "rgba(59,130,246,0.7)" : "rgba(255,255,255,0.08)" }}
                data-testid="button-image-refine-send"
              >
                {isGenerating ? <Loader2 className="w-4 h-4 text-white animate-spin" /> : <Send className="w-4 h-4 text-white" />}
              </button>
            </div>
          )}

          {/* Edit Area mode */}
          {mode === "edit" && (
            <div className="flex flex-col gap-2">
              {selectionConfirmed && selection && canvasRef.current ? (
                <>
                  <div className="flex items-center gap-1.5">
                    <div className="w-2 h-2 rounded-full bg-green-400 flex-shrink-0" />
                    <span className="text-[11px] text-green-300 font-semibold">
                      Selected: {regionToText(selection, canvasRef.current.width, canvasRef.current.height)}
                    </span>
                    <button onClick={clearSelection} className="ml-auto p-1 rounded-lg active:scale-90 transition-transform" style={{ background: "rgba(255,255,255,0.08)" }} data-testid="button-clear-selection">
                      <RotateCcw className="w-3 h-3 text-white/50" />
                    </button>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 flex items-center rounded-2xl px-3 py-2 gap-2" style={{ background: "rgba(255,255,255,0.07)", border: "1px solid rgba(34,197,94,0.3)" }}>
                      <PenLine className="w-3.5 h-3.5 text-green-400 flex-shrink-0" />
                      <input
                        ref={areaInputRef}
                        type="text"
                        value={areaDescription}
                        onChange={e => setAreaDescription(e.target.value)}
                        onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleEditArea(); } }}
                        placeholder="What should this area show?"
                        className="flex-1 bg-transparent text-sm text-white placeholder-white/30 outline-none"
                        disabled={isGenerating}
                        data-testid="input-area-description"
                      />
                    </div>
                    <button
                      onClick={handleEditArea}
                      disabled={!areaDescription.trim() || isGenerating}
                      className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 transition-all active:scale-90 disabled:opacity-40"
                      style={{ background: areaDescription.trim() && !isGenerating ? "rgba(34,197,94,0.6)" : "rgba(255,255,255,0.08)" }}
                      data-testid="button-edit-area-apply"
                    >
                      {isGenerating ? <Loader2 className="w-4 h-4 text-white animate-spin" /> : <Check className="w-4 h-4 text-white" />}
                    </button>
                  </div>
                </>
              ) : (
                <div className="flex items-center justify-center py-1">
                  <span className="text-[11px] text-white/40 text-center">
                    {isGenerating ? "Generating new version..." : "Draw a box on the image to select an area"}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
