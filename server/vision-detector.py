import http.server
import json
import io
import os
import sys
import numpy as np

VISION_PORT = int(os.environ.get("VISION_DETECTOR_PORT", "5098"))
MODELS_DIR = os.path.join(os.path.dirname(__file__), "vision-models")
YOLO_MODEL_URL = "https://github.com/ultralytics/yolov5/releases/download/v7.0/yolov5n.onnx"
YOLO_MODEL_PATH = os.path.join(MODELS_DIR, "yolov5n.onnx")

COCO_CLASSES = [
    "person", "bicycle", "car", "motorcycle", "airplane", "bus", "train", "truck", "boat",
    "traffic light", "fire hydrant", "stop sign", "parking meter", "bench", "bird", "cat",
    "dog", "horse", "sheep", "cow", "elephant", "bear", "zebra", "giraffe", "backpack",
    "umbrella", "handbag", "tie", "suitcase", "frisbee", "skis", "snowboard", "sports ball",
    "kite", "baseball bat", "baseball glove", "skateboard", "surfboard", "tennis racket",
    "bottle", "wine glass", "cup", "fork", "knife", "spoon", "bowl", "banana", "apple",
    "sandwich", "orange", "broccoli", "carrot", "hot dog", "pizza", "donut", "cake",
    "chair", "couch", "potted plant", "bed", "dining table", "toilet", "tv", "laptop",
    "mouse", "remote", "keyboard", "cell phone", "microwave", "oven", "toaster", "sink",
    "refrigerator", "book", "clock", "vase", "scissors", "teddy bear", "hair drier", "toothbrush"
]

ort_session = None
tesseract_available = False

def download_yolo_model():
    if os.path.exists(YOLO_MODEL_PATH):
        return True
    os.makedirs(MODELS_DIR, exist_ok=True)
    print(f"[VisionDetector] Downloading YOLOv8n ONNX model...")
    try:
        import urllib.request
        urllib.request.urlretrieve(YOLO_MODEL_URL, YOLO_MODEL_PATH)
        size_mb = os.path.getsize(YOLO_MODEL_PATH) / (1024 * 1024)
        print(f"[VisionDetector] Model downloaded: {size_mb:.1f}MB")
        return True
    except Exception as e:
        print(f"[VisionDetector] Download failed: {e}", file=sys.stderr)
        return False

def load_yolo():
    global ort_session
    if ort_session is not None:
        return True
    if not os.path.exists(YOLO_MODEL_PATH):
        if not download_yolo_model():
            return False
    try:
        import onnxruntime as ort
        ort_session = ort.InferenceSession(YOLO_MODEL_PATH, providers=["CPUExecutionProvider"])
        print(f"[VisionDetector] YOLOv8n model loaded")
        return True
    except Exception as e:
        print(f"[VisionDetector] Failed to load YOLO: {e}", file=sys.stderr)
        return False

def check_tesseract():
    global tesseract_available
    try:
        import pytesseract
        pytesseract.get_tesseract_version()
        tesseract_available = True
        print(f"[VisionDetector] Tesseract OCR available")
    except Exception:
        tesseract_available = False
        print(f"[VisionDetector] Tesseract OCR not available")

def preprocess_image(image_bytes):
    from PIL import Image
    img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    original_w, original_h = img.size
    img_resized = img.resize((640, 640))
    img_array = np.array(img_resized, dtype=np.float32) / 255.0
    img_array = np.transpose(img_array, (2, 0, 1))
    img_array = np.expand_dims(img_array, axis=0)
    if ort_session is not None:
        input_type = ort_session.get_inputs()[0].type
        if "float16" in input_type:
            img_array = img_array.astype(np.float16)
    return img_array, original_w, original_h, img

def run_yolo(image_bytes, conf_threshold=0.25):
    if ort_session is None:
        if not load_yolo():
            return []

    img_array, orig_w, orig_h, _ = preprocess_image(image_bytes)
    input_name = ort_session.get_inputs()[0].name
    outputs = ort_session.run(None, {input_name: img_array})
    output = outputs[0].astype(np.float32)

    detections = []

    if len(output.shape) == 3:
        data = output[0]
    else:
        data = output

    for i in range(data.shape[0]):
        row = data[i]
        if len(row) >= 85:
            cx, cy, w, h, obj_conf = row[0], row[1], row[2], row[3], row[4]
            if obj_conf < conf_threshold:
                continue
            class_scores = row[5:]
            class_id = int(np.argmax(class_scores))
            class_conf = float(class_scores[class_id])
            confidence = float(obj_conf * class_conf)

            if confidence >= conf_threshold and class_id < len(COCO_CLASSES):
                x1 = (cx - w / 2) / 640 * orig_w
                y1 = (cy - h / 2) / 640 * orig_h
                x2 = (cx + w / 2) / 640 * orig_w
                y2 = (cy + h / 2) / 640 * orig_h
                detections.append({
                    "label": COCO_CLASSES[class_id],
                    "confidence": round(confidence, 3),
                    "bbox": [round(x1), round(y1), round(x2), round(y2)]
                })
        elif len(row) >= 84:
            cx, cy, w, h = row[0], row[1], row[2], row[3]
            class_scores = row[4:]
            class_id = int(np.argmax(class_scores))
            confidence = float(class_scores[class_id])

            if confidence >= conf_threshold and class_id < len(COCO_CLASSES):
                x1 = (cx - w / 2) / 640 * orig_w
                y1 = (cy - h / 2) / 640 * orig_h
                x2 = (cx + w / 2) / 640 * orig_w
                y2 = (cy + h / 2) / 640 * orig_h
                detections.append({
                    "label": COCO_CLASSES[class_id],
                    "confidence": round(confidence, 3),
                    "bbox": [round(x1), round(y1), round(x2), round(y2)]
                })

    nms_detections = nms(detections, iou_threshold=0.45)
    nms_detections.sort(key=lambda d: d["confidence"], reverse=True)
    return nms_detections[:10]


def nms(detections, iou_threshold=0.45):
    if not detections:
        return []
    detections.sort(key=lambda d: d["confidence"], reverse=True)
    keep = []
    for det in detections:
        is_duplicate = False
        for kept in keep:
            if compute_iou(det["bbox"], kept["bbox"]) > iou_threshold:
                is_duplicate = True
                break
        if not is_duplicate:
            keep.append(det)
    return keep


def compute_iou(box1, box2):
    x1 = max(box1[0], box2[0])
    y1 = max(box1[1], box2[1])
    x2 = min(box1[2], box2[2])
    y2 = min(box1[3], box2[3])
    inter = max(0, x2 - x1) * max(0, y2 - y1)
    area1 = (box1[2] - box1[0]) * (box1[3] - box1[1])
    area2 = (box2[2] - box2[0]) * (box2[3] - box2[1])
    union = area1 + area2 - inter
    return inter / union if union > 0 else 0

def run_ocr(image_bytes):
    if not tesseract_available:
        return ""
    try:
        from PIL import Image
        import pytesseract
        img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
        text = pytesseract.image_to_string(img, timeout=10).strip()
        lines = [l.strip() for l in text.split("\n") if l.strip()]
        return " ".join(lines)[:500]
    except Exception as e:
        print(f"[VisionDetector] OCR error: {e}", file=sys.stderr)
        return ""


class VisionHandler(http.server.BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass

    def do_POST(self):
        if self.path != "/detect":
            self.send_response(404)
            self.end_headers()
            return

        content_length = int(self.headers.get("Content-Length", 0))
        if content_length > 10 * 1024 * 1024:
            self.send_response(413)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"error": "Image too large (max 10MB)"}).encode())
            return

        image_bytes = self.rfile.read(content_length)

        try:
            objects = run_yolo(image_bytes)
            text = run_ocr(image_bytes)

            result = {
                "objects": objects,
                "text": text,
                "primary": objects[0]["label"] if objects else None,
                "primary_confidence": objects[0]["confidence"] if objects else 0,
            }

            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps(result).encode())
        except Exception as e:
            print(f"[VisionDetector] Detection error: {e}", file=sys.stderr)
            self.send_response(500)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"error": str(e)}).encode())

    def do_GET(self):
        if self.path == "/health":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({
                "status": "ok",
                "engine": "yolov8n-onnx",
                "yolo_loaded": ort_session is not None,
                "ocr_available": tesseract_available,
                "classes": len(COCO_CLASSES)
            }).encode())
            return
        self.send_response(404)
        self.end_headers()


if __name__ == "__main__":
    print(f"[VisionDetector] Initializing...")
    check_tesseract()
    load_yolo()

    class ReuseAddrServer(http.server.HTTPServer):
        allow_reuse_address = True

    last_err = None
    for attempt in range(1, 6):
        try:
            server = ReuseAddrServer(("127.0.0.1", VISION_PORT), VisionHandler)
            print(f"[VisionDetector] Server running on http://127.0.0.1:{VISION_PORT}")
            try:
                server.serve_forever()
            except KeyboardInterrupt:
                print("[VisionDetector] Shutting down")
                server.server_close()
            break
        except OSError as e:
            last_err = e
            print(f"[VisionDetector] Port {VISION_PORT} busy (attempt {attempt}/5), retrying in 1s...", file=sys.stderr, flush=True)
            import time; time.sleep(1)
    else:
        print(f"[VisionDetector] Could not bind port {VISION_PORT}: {last_err}", file=sys.stderr, flush=True)
        sys.exit(1)
