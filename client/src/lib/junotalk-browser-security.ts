/**
 * junotalk-browser-security.ts
 *
 * CDN-backed URL allowlist gate for JunoTalk Browser popups.
 *
 * Flow:
 *   1. On first validateUrl() call, fetch rules from /api/security/browser-rules
 *      (server fetches from private GitHub CDN, then serves cached result).
 *   2. Cache the rules client-side for cacheTtlMs (default 1 hour).
 *   3. Check the target URL's hostname against the allowedDomains list.
 *   4. If the fetch fails for any reason → block-all (safe fallback).
 *
 * The cache TTL is controlled by the CDN rules file, so it can be adjusted
 * remotely without a code deploy. Monitor latency and tune as needed.
 */

interface BrowserRules {
  allowedDomains: string[];
  cacheTtlMs: number;
  fallback: "block" | "allow";
  source: "cdn" | "fallback";
}

let _rulesCache: BrowserRules | null = null;
let _rulesFetchedAt = 0;
let _fetchPromise: Promise<BrowserRules | null> | null = null;

async function fetchRules(): Promise<BrowserRules | null> {
  try {
    const res = await fetch("/api/security/browser-rules", { credentials: "include" });
    if (!res.ok) return null;
    const data = await res.json() as BrowserRules;
    if (!Array.isArray(data.allowedDomains) || data.allowedDomains.length === 0) return null;
    return data;
  } catch {
    return null;
  }
}

async function getRules(): Promise<BrowserRules | null> {
  const now = Date.now();
  const ttl = _rulesCache?.cacheTtlMs ?? 60 * 60 * 1000;

  if (_rulesCache && now - _rulesFetchedAt < ttl) return _rulesCache;

  if (_fetchPromise) return _fetchPromise;

  _fetchPromise = fetchRules().then(rules => {
    _fetchPromise = null;
    if (rules) {
      _rulesCache = rules;
      _rulesFetchedAt = Date.now();
    }
    return rules;
  });

  return _fetchPromise;
}

/**
 * Validates a URL against the CDN-backed domain allowlist.
 *
 * Returns true  → URL is permitted; proceed with popup / redirect.
 * Returns false → URL is not on the allowlist or rules are unavailable; block.
 *
 * On any fetch failure the function returns false (block-all safe fallback).
 */
export async function validateUrl(url: string): Promise<boolean> {
  let hostname: string;
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }

  const rules = await getRules();

  if (!rules) {
    console.warn("[BrowserSecurity] Rules unavailable — blocking popup for safety:", hostname);
    return false;
  }

  const allowed = rules.allowedDomains.some(domain => {
    const d = domain.toLowerCase();
    return hostname === d || hostname.endsWith("." + d);
  });

  if (!allowed) {
    console.warn("[BrowserSecurity] Domain not on allowlist — blocked:", hostname);
  }

  return allowed;
}

/**
 * Returns the current cached rules metadata (for diagnostics / dev portal).
 * Does not trigger a fetch.
 */
export function getBrowserSecurityStatus() {
  return {
    cached: !!_rulesCache,
    source: _rulesCache?.source ?? null,
    domainCount: _rulesCache?.allowedDomains.length ?? 0,
    cacheTtlMs: _rulesCache?.cacheTtlMs ?? null,
    fetchedAt: _rulesFetchedAt ? new Date(_rulesFetchedAt).toISOString() : null,
  };
}

/**
 * Force-refresh the rules cache (bypasses TTL).
 * Useful after returning from a popup to pick up any CDN updates.
 */
export function invalidateBrowserRulesCache(): void {
  _rulesFetchedAt = 0;
}
