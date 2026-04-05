import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";
import type { Response } from "express";

const supabaseUrl = process.env.SUPABASE_URL || "";
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || "";

if (!supabaseUrl || !supabaseKey) {
  console.warn("[SupabaseStorage] SUPABASE_URL or SUPABASE_ANON_KEY not set. Storage will not work.");
}

const supabase: SupabaseClient = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false },
});

export const PUBLIC_BUCKET = "public-assets";
export const PRIVATE_BUCKET = "user-uploads";

export class SupabaseStorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SupabaseStorageError";
    Object.setPrototypeOf(this, SupabaseStorageError.prototype);
  }
}

export class ObjectNotFoundError extends Error {
  constructor() {
    super("Object not found");
    this.name = "ObjectNotFoundError";
    Object.setPrototypeOf(this, ObjectNotFoundError.prototype);
  }
}

export class SupabaseStorageService {
  private client: SupabaseClient;

  constructor() {
    this.client = supabase;
  }

  async ensureBuckets(): Promise<void> {
    try {
      const { error: pubErr } = await this.client.storage.createBucket(PUBLIC_BUCKET, {
        public: true,
        fileSizeLimit: 52428800,
      });
      if (pubErr && !pubErr.message?.includes("already exists")) {
        console.warn("[SupabaseStorage] Could not create public bucket:", pubErr.message);
      }

      const { error: privErr } = await this.client.storage.createBucket(PRIVATE_BUCKET, {
        public: false,
        fileSizeLimit: 52428800,
      });
      if (privErr && !privErr.message?.includes("already exists")) {
        console.warn("[SupabaseStorage] Could not create private bucket:", privErr.message);
      }
    } catch (err: any) {
      console.warn("[SupabaseStorage] Bucket creation failed (may need service role key):", err?.message);
    }
  }

  async getUploadSignedUrl(options?: { bucket?: string; folder?: string; contentType?: string }): Promise<{
    signedUrl: string;
    objectPath: string;
    token: string;
  }> {
    const bucket = options?.bucket || PRIVATE_BUCKET;
    const folder = options?.folder || "uploads";
    const objectId = randomUUID();
    const filePath = `${folder}/${objectId}`;

    const { data, error } = await this.client.storage
      .from(bucket)
      .createSignedUploadUrl(filePath);

    if (error) {
      throw new SupabaseStorageError(`Failed to create signed upload URL: ${error.message}`);
    }

    return {
      signedUrl: data.signedUrl,
      objectPath: `/storage/${bucket}/${filePath}`,
      token: data.token,
    };
  }

  getPublicUrl(bucket: string, path: string): string {
    const { data } = this.client.storage.from(bucket).getPublicUrl(path);
    return data.publicUrl;
  }

  async getSignedDownloadUrl(bucket: string, path: string, expiresIn: number = 3600): Promise<string> {
    const { data, error } = await this.client.storage
      .from(bucket)
      .createSignedUrl(path, expiresIn);

    if (error) {
      throw new SupabaseStorageError(`Failed to create signed download URL: ${error.message}`);
    }

    return data.signedUrl;
  }

  async uploadFile(
    bucket: string,
    path: string,
    fileBody: Buffer | Blob | ArrayBuffer,
    contentType: string = "application/octet-stream",
    upsert: boolean = true
  ): Promise<string> {
    const { error } = await this.client.storage
      .from(bucket)
      .upload(path, fileBody, { contentType, upsert });

    if (error) {
      throw new SupabaseStorageError(`Failed to upload file: ${error.message}`);
    }

    return path;
  }

  async downloadFile(bucket: string, path: string): Promise<Blob> {
    const { data, error } = await this.client.storage
      .from(bucket)
      .download(path);

    if (error) {
      throw new ObjectNotFoundError();
    }

    return data;
  }

  async downloadToResponse(bucket: string, path: string, res: Response, cacheTtlSec: number = 3600): Promise<void> {
    try {
      const data = await this.downloadFile(bucket, path);
      const buffer = Buffer.from(await data.arrayBuffer());
      const isPublic = bucket === PUBLIC_BUCKET;

      res.set({
        "Content-Type": data.type || "application/octet-stream",
        "Content-Length": String(buffer.length),
        "Cache-Control": `${isPublic ? "public" : "private"}, max-age=${cacheTtlSec}`,
      });

      res.send(buffer);
    } catch (error) {
      if (error instanceof ObjectNotFoundError) {
        throw error;
      }
      console.error("[SupabaseStorage] Error downloading file:", error);
      if (!res.headersSent) {
        res.status(500).json({ error: "Error downloading file" });
      }
    }
  }

  async fileExists(bucket: string, path: string): Promise<boolean> {
    const parts = path.split("/");
    const fileName = parts.pop()!;
    const folder = parts.join("/");

    const { data, error } = await this.client.storage
      .from(bucket)
      .list(folder, { search: fileName, limit: 1 });

    if (error) return false;
    return data.some((f) => f.name === fileName);
  }

  async deleteFile(bucket: string, path: string): Promise<void> {
    const { error } = await this.client.storage
      .from(bucket)
      .remove([path]);

    if (error) {
      throw new SupabaseStorageError(`Failed to delete file: ${error.message}`);
    }
  }

  parseObjectPath(objectPath: string): { bucket: string; path: string } | null {
    if (!objectPath.startsWith("/storage/")) {
      return null;
    }

    const parts = objectPath.slice("/storage/".length).split("/");
    if (parts.length < 2) {
      return null;
    }

    const bucket = parts[0];
    const path = parts.slice(1).join("/");
    return { bucket, path };
  }

  normalizeUploadUrl(rawUrl: string): string {
    if (rawUrl.startsWith("/storage/")) {
      return rawUrl;
    }

    if (rawUrl.includes(supabaseUrl) && rawUrl.includes("/storage/v1/object/")) {
      try {
        const url = new URL(rawUrl);
        const match = url.pathname.match(/\/storage\/v1\/object\/(?:sign|public|upload\/sign)\/(.+)/);
        if (match) {
          const [bucket, ...rest] = match[1].split("/");
          return `/storage/${bucket}/${rest.join("/")}`;
        }
      } catch {}
    }

    return rawUrl;
  }

  getServingUrl(objectPath: string): string {
    const parsed = this.parseObjectPath(objectPath);
    if (!parsed) return objectPath;

    if (parsed.bucket === PUBLIC_BUCKET) {
      return this.getPublicUrl(parsed.bucket, parsed.path);
    }

    return objectPath;
  }
}

export const supabaseStorageService = new SupabaseStorageService();
