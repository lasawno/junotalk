import type { Request, Response, NextFunction } from "express";

export function apiVersionMiddleware(version: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    res.setHeader("X-API-Version", version);
    console.log(`[API ${version}] ${req.method} ${req.originalUrl}`);
    next();
  };
}
