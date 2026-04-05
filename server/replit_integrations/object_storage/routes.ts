import type { Express, Request, Response, NextFunction } from "express";
import { ObjectStorageService, ObjectNotFoundError } from "./objectStorage";
import { PUBLIC_BUCKET, PRIVATE_BUCKET } from "../../supabase-storage";

function getAuthUserId(req: any): string | undefined {
  return req.user?.claims?.sub;
}

export function registerObjectStorageRoutes(app: Express): void {
  const objectStorageService = new ObjectStorageService();

  const ALLOWED_UPLOAD_CONTENT_TYPES = new Set([
    "image/jpeg", "image/jpg", "image/png", "image/webp", "image/gif", "image/bmp",
    "video/mp4", "video/webm", "video/quicktime",
    "audio/mpeg", "audio/mp4", "audio/wav", "audio/ogg", "audio/webm",
    "application/pdf",
    "text/plain",
  ]);

  app.post("/api/uploads/request-url", async (req: any, res) => {
    const userId = getAuthUserId(req);
    if (!userId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    try {
      const { name, size, contentType, bucket: requestedBucket } = req.body;

      if (!name) {
        return res.status(400).json({
          error: "Missing required field: name",
        });
      }

      if (contentType && !ALLOWED_UPLOAD_CONTENT_TYPES.has(contentType)) {
        return res.status(400).json({ error: "Unsupported file type" });
      }

      const allowedBuckets = [PUBLIC_BUCKET, PRIVATE_BUCKET];
      const bucket = requestedBucket && allowedBuckets.includes(requestedBucket)
        ? requestedBucket
        : PRIVATE_BUCKET;

      const { uploadURL, objectPath } = await objectStorageService.getObjectEntityUploadURL({
        bucket,
        folder: "uploads",
      });

      res.json({
        uploadURL,
        objectPath,
        metadata: { name, size, contentType },
      });
    } catch (error) {
      console.error("Error generating upload URL:", error);
      res.status(500).json({ error: "Failed to generate upload URL" });
    }
  });

  app.get(/^\/storage\/public-assets\/(.+)$/, async (req, res) => {
    try {
      const objectPath = `/storage/${PUBLIC_BUCKET}/${req.params[0]}`;
      await objectStorageService.downloadObjectToResponse(objectPath, res);
    } catch (error) {
      if (error instanceof ObjectNotFoundError) {
        return res.status(404).json({ error: "Object not found" });
      }
      return res.status(500).json({ error: "Failed to serve object" });
    }
  });

  app.get(/^\/storage\/user-uploads\/(.+)$/, async (req: any, res) => {
    try {
      const userId = getAuthUserId(req);
      if (!userId) {
        return res.status(401).json({ error: "Authentication required" });
      }

      const objectPath = `/storage/${PRIVATE_BUCKET}/${req.params[0]}`;
      await objectStorageService.downloadObjectToResponse(objectPath, res);
    } catch (error) {
      if (error instanceof ObjectNotFoundError) {
        return res.status(404).json({ error: "Object not found" });
      }
      return res.status(500).json({ error: "Failed to serve object" });
    }
  });

  app.get(/^\/objects\/(.+)$/, async (req: any, res) => {
    try {
      const userId = getAuthUserId(req);
      if (!userId) {
        return res.status(401).json({ error: "Authentication required" });
      }

      const objectPath = `/storage/${PRIVATE_BUCKET}/${req.params[0]}`;
      await objectStorageService.downloadObjectToResponse(objectPath, res);
    } catch (error) {
      if (error instanceof ObjectNotFoundError) {
        return res.status(404).json({ error: "Object not found" });
      }
      return res.status(500).json({ error: "Failed to serve object" });
    }
  });
}
