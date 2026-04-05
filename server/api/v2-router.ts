import { Router } from "express";

const v2Router = Router();

v2Router.get("/status", (_req, res) => {
  res.json({
    version: "v2",
    status: "scaffold",
    message: "API v2 is under development. Use v1 for stable endpoints.",
  });
});

export default v2Router;
