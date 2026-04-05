import { Router } from "express";
import { ensureVisionDetectorStarted, getVisionDetectorPort } from "../start-vision-detector";
import { composeVisionResponse, getVisionStats } from "../vision-knowledge";
import { hubVisionAnalyze } from "../juno-vision-hub";

export function createCameraRouter(deps: {
  isAuthenticated: any;
  upload: any;
}) {
  const router = Router();
  const { isAuthenticated, upload } = deps;

  router.post("/juno-vision", isAuthenticated, upload.single("frame"), async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: "Image frame is required" });
    }

    const targetLang = req.body.targetLang || "es";
    const sourceLang = req.body.sourceLang || "en";
    const userQuestion = req.body.userQuestion || "";

    try {
      ensureVisionDetectorStarted();
      const detectorPort = getVisionDetectorPort();

      let detection: any = null;
      try {
        const detectorRes = await fetch(`http://127.0.0.1:${detectorPort}/detect`, {
          method: "POST",
          headers: { "Content-Type": "application/octet-stream" },
          body: req.file.buffer,
          signal: AbortSignal.timeout(15000),
        });
        if (detectorRes.ok) {
          detection = await detectorRes.json();
        }
      } catch (detErr: any) {
        console.log("[CameraVision] Local detector unavailable:", detErr.message);
      }

      if (detection && detection.primary) {
        const response = composeVisionResponse(detection, sourceLang, targetLang, userQuestion || undefined);
        return res.json({
          ...response,
          hasQuestion: !!userQuestion,
          engine: "local",
        });
      }

      try {
        console.log("[CameraVision] Local detection missed — calling Juno Vision Hub (open-source)");
        const hubResult = await hubVisionAnalyze(
          req.file.buffer,
          req.file.mimetype || "image/jpeg",
          sourceLang,
          targetLang,
          userQuestion || undefined
        );
        return res.json({ ...hubResult, hasQuestion: !!userQuestion });
      } catch (hubErr: any) {
        console.warn("[CameraVision] Hub analysis failed:", hubErr.message);
        return res.status(503).json({
          error: "Vision analysis unavailable — please retry in a moment",
        });
      }
    } catch (error: any) {
      console.error("[CameraVision] Error:", error.message);
      return res.status(500).json({ error: "Vision processing failed" });
    }
  });

  router.get("/vision-stats", isAuthenticated, (_req, res) => {
    const stats = getVisionStats();
    res.json(stats);
  });

  return router;
}
