import { useState, useCallback } from "react";
import Cropper from "react-easy-crop";
import type { Area } from "react-easy-crop";
import { Button } from "@/components/ui/button";
import { ZoomIn, ZoomOut, Check, X } from "lucide-react";
import { Slider } from "@/components/ui/slider";

interface ImageCropperProps {
  imageSrc: string;
  onCropComplete: (croppedBlob: Blob) => void;
  onCancel: () => void;
}

function getCroppedImg(imageSrc: string, pixelCrop: Area): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => {
      const canvas = document.createElement("canvas");
      const size = Math.min(pixelCrop.width, pixelCrop.height);
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("Could not get canvas context"));
        return;
      }
      ctx.drawImage(
        image,
        pixelCrop.x,
        pixelCrop.y,
        pixelCrop.width,
        pixelCrop.height,
        0,
        0,
        size,
        size
      );
      canvas.toBlob(
        (blob) => {
          if (blob) resolve(blob);
          else reject(new Error("Canvas toBlob failed"));
        },
        "image/jpeg",
        0.92
      );
    };
    image.onerror = () => reject(new Error("Failed to load image"));
    image.src = imageSrc;
  });
}

export default function ImageCropper({ imageSrc, onCropComplete, onCancel }: ImageCropperProps) {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
  const [saving, setSaving] = useState(false);

  const onCropChange = useCallback((location: { x: number; y: number }) => {
    setCrop(location);
  }, []);

  const onZoomChange = useCallback((z: number) => {
    setZoom(z);
  }, []);

  const onCropAreaComplete = useCallback((_: Area, croppedPixels: Area) => {
    setCroppedAreaPixels(croppedPixels);
  }, []);

  const handleSave = useCallback(async () => {
    if (!croppedAreaPixels) return;
    setSaving(true);
    try {
      const blob = await getCroppedImg(imageSrc, croppedAreaPixels);
      onCropComplete(blob);
    } catch {
      setSaving(false);
    }
  }, [croppedAreaPixels, imageSrc, onCropComplete]);

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex flex-col" data-testid="image-cropper-overlay">
      <div className="flex items-center justify-between px-4 py-3 bg-background/90 backdrop-blur-sm border-b">
        <Button variant="ghost" size="icon" onClick={onCancel} data-testid="button-crop-cancel">
          <X className="w-5 h-5" />
        </Button>
        <p className="text-sm font-medium">Crop Photo</p>
        <Button
          variant="ghost"
          size="icon"
          onClick={handleSave}
          disabled={saving || !croppedAreaPixels}
          data-testid="button-crop-save"
        >
          <Check className="w-5 h-5 text-primary" />
        </Button>
      </div>

      <div className="flex-1 relative">
        <Cropper
          image={imageSrc}
          crop={crop}
          zoom={zoom}
          aspect={1}
          cropShape="round"
          showGrid={false}
          onCropChange={onCropChange}
          onZoomChange={onZoomChange}
          onCropComplete={onCropAreaComplete}
          minZoom={1}
          maxZoom={5}
        />
      </div>

      <div className="px-6 py-4 bg-background/90 backdrop-blur-sm border-t">
        <div className="flex items-center gap-3 max-w-sm mx-auto">
          <ZoomOut className="w-4 h-4 text-muted-foreground shrink-0" />
          <Slider
            value={[zoom]}
            min={1}
            max={5}
            step={0.1}
            onValueChange={(v) => setZoom(v[0])}
            className="flex-1"
            data-testid="slider-zoom"
          />
          <ZoomIn className="w-4 h-4 text-muted-foreground shrink-0" />
        </div>
      </div>
    </div>
  );
}
