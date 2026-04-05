import { SupabaseStorageService, ObjectNotFoundError, supabaseStorageService, PUBLIC_BUCKET, PRIVATE_BUCKET } from "../../supabase-storage";

export { ObjectNotFoundError };

export class ObjectStorageService {
  private svc: SupabaseStorageService;

  constructor() {
    this.svc = supabaseStorageService;
  }

  async getObjectEntityUploadURL(options?: { bucket?: string; folder?: string }): Promise<{ uploadURL: string; objectPath: string }> {
    const result = await this.svc.getUploadSignedUrl({
      bucket: options?.bucket || PRIVATE_BUCKET,
      folder: options?.folder || "uploads",
    });

    return {
      uploadURL: result.signedUrl,
      objectPath: result.objectPath,
    };
  }

  async getPublicUploadURL(folder: string = "uploads"): Promise<{ uploadURL: string; objectPath: string }> {
    return this.getObjectEntityUploadURL({ bucket: PUBLIC_BUCKET, folder });
  }

  normalizeObjectEntityPath(rawPath: string): string {
    return this.svc.normalizeUploadUrl(rawPath);
  }

  async trySetObjectEntityAclPolicy(
    objectPath: string,
    _aclPolicy: { owner: string; visibility: "public" | "private" }
  ): Promise<string> {
    return this.normalizeObjectEntityPath(objectPath);
  }

  async downloadObjectToResponse(objectPath: string, res: any, cacheTtlSec: number = 3600): Promise<void> {
    const parsed = this.svc.parseObjectPath(objectPath);
    if (!parsed) {
      throw new ObjectNotFoundError();
    }

    await this.svc.downloadToResponse(parsed.bucket, parsed.path, res, cacheTtlSec);
  }

  getServingUrl(objectPath: string): string {
    return this.svc.getServingUrl(objectPath);
  }

  getPrivateObjectDir(): string {
    return PRIVATE_BUCKET;
  }

  async getSignedDownloadUrl(objectPath: string, expiresIn: number = 3600): Promise<string> {
    const parsed = this.svc.parseObjectPath(objectPath);
    if (!parsed) {
      throw new ObjectNotFoundError();
    }
    return this.svc.getSignedDownloadUrl(parsed.bucket, parsed.path, expiresIn);
  }
}
