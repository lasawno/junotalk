const BRAND = "junotalk";
const VISION_MODULE = "JunoVision";
const VISION_VERSION = "1.0";

export const REDIS_KEYS = {
  // Agent / queue
  agentMetricsPrefix:   `${BRAND}:agent:metrics`,
  agentQueueName:       `${BRAND}-agent-tasks`,
  agentResultsChannel:  `${BRAND}:agent:results`,
  agentIdempotency:     `${BRAND}:agent:done`,
  gatewayUsagePrefix:   `${BRAND}:gateway:usage`,
  translatePrefix:      `${BRAND}:translate`,

  // Vision pipeline
  visionCachePrefix:    `${BRAND}:vision:cache`,
  visionScanPrefix:     `${BRAND}:vision:scan`,

  // OSINT enrichment
  osintCachePrefix:     `${BRAND}:osint:cache`,
} as const;

// User-Agent string sent to public OSINT APIs (Wikipedia, DDG, etc.)
// Change VISION_MODULE or VISION_VERSION here to update across all OSINT calls.
export const VISION_USER_AGENT =
  `${VISION_MODULE}/${VISION_VERSION} (product identification assistant)`;
