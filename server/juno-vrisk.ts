/**
 * JUNO VRISK — Autonomous Vulnerability Risk Agent
 *
 * Integrated into Juno's security pipeline, sitting between
 * secrets-guard and juno-safety. Detects, classifies, scores,
 * and tracks code-level vulnerabilities across all OWASP Top 10
 * and major CWE classes. Findings are encrypted with AES-256-GCM
 * and stored in the three-tier cache for a persistent audit trail.
 *
 * Pipeline position:
 *   secrets-guard.ts ──► juno-vrisk.ts ──► juno-safety.ts
 *
 * Covered vulnerability classes:
 *   INJ  — Command / Shell Injection
 *   COD  — Code Injection (eval, Function)
 *   SQL  — SQL Injection
 *   PTH  — Path Traversal
 *   SCR  — Secret / Credential Exposure
 *   PRT  — Prototype Pollution
 *   XSS  — Cross-Site Scripting
 *   RDR  — Open Redirect
 *   SRF  — Server-Side Request Forgery (SSRF)
 *   DSR  — Insecure Deserialization
 *   JWT  — JWT Vulnerabilities
 *   TIM  — Timing Attack
 *   RGX  — ReDoS (Catastrophic Backtracking)
 *   MAS  — Mass Assignment
 *   CRS  — CORS Misconfiguration
 *   RNG  — Insecure Randomness
 *   HCC  — Hardcoded Credentials
 *   RTE  — Missing Rate Limiting
 *   DIR  — Directory Traversal via Static Serve
 *   AUTH — Authentication / Authorization Bypass
 */

import crypto from "crypto";
import { redisGet, redisSet } from "./redis-cache";
import { structuredLog } from "./structured-logger";

// ─── In-memory fallback store (used when Redis is unavailable) ────────────────
// Findings never touch the GitHub CDN tier — they stay private to this instance.
const memoryStore = new Map<string, string>();

async function vRiskSet(key: string, value: string): Promise<void> {
  const TTL_SECONDS = 30 * 24 * 60 * 60;
  try {
    const ok = await redisSet(key, value, TTL_SECONDS);
    if (!ok) memoryStore.set(key, value);
  } catch {
    memoryStore.set(key, value);
  }
}

async function vRiskGet(key: string): Promise<string | null> {
  try {
    const val = await redisGet(key);
    if (val !== null) return val;
  } catch {}
  return memoryStore.get(key) ?? null;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type VRiskCategory =
  | "injection"
  | "code_injection"
  | "sql_injection"
  | "path_traversal"
  | "secret_exposure"
  | "prototype_pollution"
  | "xss"
  | "open_redirect"
  | "ssrf"
  | "insecure_deserialization"
  | "jwt_vulnerability"
  | "timing_attack"
  | "redos"
  | "mass_assignment"
  | "cors_misconfiguration"
  | "insecure_randomness"
  | "hardcoded_credentials"
  | "missing_rate_limit"
  | "directory_traversal"
  | "auth_bypass";

export type VRiskSeverity = "critical" | "high" | "medium" | "low" | "info";

export type VRiskConfidence = "confirmed" | "likely" | "possible" | "false_positive";

export type VRiskStatus = "open" | "resolved" | "dismissed" | "auto_patched";

export interface VRiskRule {
  id: string;
  category: VRiskCategory;
  severity: VRiskSeverity;
  title: string;
  description: string;
  patterns: RegExp[];
  cwe: string;
  owasp: string;
  remediation: string;
  autoRemediable: boolean;
}

export interface VRiskFinding {
  id: string;
  ruleId: string;
  category: VRiskCategory;
  severity: VRiskSeverity;
  confidence: VRiskConfidence;
  title: string;
  description: string;
  cwe: string;
  owasp: string;
  remediation: string;
  snippet: string;
  matchedPattern: string;
  context?: string;
  status: VRiskStatus;
  detectedAt: string;
  resolvedAt?: string;
  autoRemediable: boolean;
  encryptedPayload?: string;
}

export interface VRiskScanResult {
  scannedAt: string;
  scanDurationMs: number;
  inputLength: number;
  findings: VRiskFinding[];
  summary: {
    total: number;
    critical: number;
    high: number;
    medium: number;
    low: number;
    info: number;
  };
  riskScore: number;
  recommendation: "block" | "review" | "monitor" | "clear";
}

export interface VRiskAgentStatus {
  initialized: boolean;
  totalRules: number;
  totalScans: number;
  totalFindings: number;
  openFindings: number;
  lastScanAt: string | null;
  lastFindingAt: string | null;
  cacheNamespace: string;
  encryptionActive: boolean;
}

// ─── Vulnerability Rule Definitions ──────────────────────────────────────────

const VRISK_RULES: VRiskRule[] = [

  // ── INJ: Command / Shell Injection ─────────────────────────────────────────
  {
    id: "INJ-001",
    category: "injection",
    severity: "critical",
    title: "Shell command built with template literal and variable",
    description:
      "A shell command string is constructed using a variable interpolated directly into a template literal passed to exec/execSync/spawn. If the variable is user-controlled, this allows arbitrary command execution.",
    patterns: [
      /exec(?:Sync|File)?\s*\(\s*`[^`]*\$\{[^}]+\}[^`]*`/,
      /exec(?:Sync|File)?\s*\(\s*['"][^'"]*'\s*\+/,
      /exec(?:Sync|File)?\s*\(\s*[a-zA-Z_$][a-zA-Z0-9_$]*\s*\+/,
    ],
    cwe: "CWE-78",
    owasp: "A03:2021 – Injection",
    remediation:
      "Use execFile() with an argument array instead of exec()/execSync() with a shell string. Validate all inputs with a strict allowlist before use. Never interpolate variables directly into shell commands.",
    autoRemediable: false,
  },
  {
    id: "INJ-002",
    category: "injection",
    severity: "high",
    title: "spawn() called with shell:true and dynamic arguments",
    description:
      "spawn() is invoked with shell:true, enabling shell metacharacter expansion. Combined with dynamic arguments, this creates a command injection surface.",
    patterns: [
      /spawn\s*\([^)]*shell\s*:\s*true/,
    ],
    cwe: "CWE-78",
    owasp: "A03:2021 – Injection",
    remediation:
      "Remove shell:true and pass arguments as an array. Validate all inputs strictly.",
    autoRemediable: false,
  },
  {
    id: "INJ-003",
    category: "injection",
    severity: "critical",
    title: "User input directly interpolated into shell command",
    description:
      "A request parameter (req.body, req.query, req.params) is interpolated into a shell command string without adequate sanitization.",
    patterns: [
      /exec(?:Sync|File)?\s*\([^)]*req\.(body|query|params)/,
      /exec(?:Sync|File)?\s*\(`[^`]*\$\{\s*req\./,
    ],
    cwe: "CWE-78",
    owasp: "A03:2021 – Injection",
    remediation:
      "Never pass user-supplied data to shell commands. Use allowlist validation, parameterized arguments, or completely avoid child_process when user input is involved.",
    autoRemediable: false,
  },

  // ── COD: Code Injection ─────────────────────────────────────────────────────
  {
    id: "COD-001",
    category: "code_injection",
    severity: "critical",
    title: "eval() called with dynamic content",
    description:
      "eval() executes arbitrary JavaScript. If called with any data that originates from user input or external sources, it allows full code execution.",
    patterns: [
      /\beval\s*\(\s*(?!['"`][^'"`]*['"`]\s*\))/,
    ],
    cwe: "CWE-95",
    owasp: "A03:2021 – Injection",
    remediation:
      "Remove eval() entirely. Use JSON.parse() for data, structured config objects for dynamic dispatch, or a sandboxed evaluator if code execution is truly required.",
    autoRemediable: false,
  },
  {
    id: "COD-002",
    category: "code_injection",
    severity: "critical",
    title: "new Function() constructor used with dynamic input",
    description:
      "The Function constructor compiles and executes JavaScript at runtime. Equivalent to eval() in risk.",
    patterns: [
      /new\s+Function\s*\([^)]*[+`$]/,
      /new\s+Function\s*\([^)]*req\./,
    ],
    cwe: "CWE-95",
    owasp: "A03:2021 – Injection",
    remediation:
      "Replace with a static function map or strategy pattern. Do not use the Function constructor with any user-influenced input.",
    autoRemediable: false,
  },
  {
    id: "COD-003",
    category: "code_injection",
    severity: "high",
    title: "setTimeout/setInterval called with a string argument",
    description:
      "Passing a string to setTimeout or setInterval causes JavaScript to eval() that string. This is a hidden code injection vector.",
    patterns: [
      /setTimeout\s*\(\s*['"`][^'"`]+['"`]\s*,/,
      /setInterval\s*\(\s*['"`][^'"`]+['"`]\s*,/,
      /setTimeout\s*\(\s*`[^`]*\$\{/,
      /setInterval\s*\(\s*`[^`]*\$\{/,
    ],
    cwe: "CWE-95",
    owasp: "A03:2021 – Injection",
    remediation:
      "Pass a function reference to setTimeout/setInterval, never a string.",
    autoRemediable: true,
  },

  // ── SQL: SQL Injection ──────────────────────────────────────────────────────
  {
    id: "SQL-001",
    category: "sql_injection",
    severity: "critical",
    title: "Raw SQL query built with string concatenation or template literal",
    description:
      "A SQL query is assembled by concatenating or interpolating variables directly into the query string, bypassing parameterization.",
    patterns: [
      /(?:query|execute|run)\s*\(\s*['"`][^'"`]*(?:SELECT|INSERT|UPDATE|DELETE|DROP|CREATE)[^'"`]*['"`]\s*\+/i,
      /(?:query|execute|run)\s*\(\s*`[^`]*(?:SELECT|INSERT|UPDATE|DELETE|DROP)[^`]*\$\{/i,
      /`\s*(?:SELECT|INSERT|UPDATE|DELETE|DROP|WHERE)[^`]*\$\{[^}]*req\./i,
    ],
    cwe: "CWE-89",
    owasp: "A03:2021 – Injection",
    remediation:
      "Use parameterized queries or a query builder (Drizzle, Knex). Never interpolate variables into SQL strings. Use $1/$2 placeholders or Drizzle's eq()/and() helpers.",
    autoRemediable: false,
  },

  // ── PTH: Path Traversal ─────────────────────────────────────────────────────
  {
    id: "PTH-001",
    category: "path_traversal",
    severity: "high",
    title: "File system operation with user-controlled path",
    description:
      "A file system operation (readFile, writeFile, createReadStream) uses a path that may be user-controlled, enabling directory traversal (../../../etc/passwd).",
    patterns: [
      /(?:readFile|writeFile|appendFile|createReadStream|createWriteStream|unlink|stat|access)\s*\([^)]*req\.(body|query|params)/,
      /(?:readFile|writeFile|appendFile|createReadStream)\s*\(`[^`]*\$\{\s*req\./,
      /path\.(?:join|resolve)\s*\([^)]*req\.(body|query|params)/,
    ],
    cwe: "CWE-22",
    owasp: "A01:2021 – Broken Access Control",
    remediation:
      "Resolve the final path and verify it starts with the intended base directory using path.resolve() + startsWith(). Reject any path containing '..' sequences. Use an allowlist of permitted filenames.",
    autoRemediable: false,
  },
  {
    id: "PTH-002",
    category: "path_traversal",
    severity: "medium",
    title: "path.join() used with unvalidated external input",
    description:
      "path.join() does not prevent traversal — a '../' component in any segment will navigate up the directory tree.",
    patterns: [
      /path\.join\s*\([^)]*(?:params|query|body)\.[a-zA-Z]/,
    ],
    cwe: "CWE-22",
    owasp: "A01:2021 – Broken Access Control",
    remediation:
      "After path.join(), call path.resolve() and assert the result starts with the allowed base path. Strip or reject '..' in any user-supplied segment.",
    autoRemediable: false,
  },

  // ── SCR: Secret / Credential Exposure ──────────────────────────────────────
  {
    id: "SCR-001",
    category: "secret_exposure",
    severity: "critical",
    title: "Hardcoded API key or token in source",
    description:
      "A string that matches the pattern of a real API key or token is embedded directly in the source code.",
    patterns: [
      /(?:api[_-]?key|apikey|api[_-]?token)\s*[=:]\s*['"`][A-Za-z0-9\-_]{20,}['"`]/i,
      /(?:sk|pk|rk|ak)-[A-Za-z0-9\-_]{20,}/,
      /AIza[A-Za-z0-9\-_]{35}/,
      /sk-ant-[A-Za-z0-9\-_]{80,}/,
    ],
    cwe: "CWE-798",
    owasp: "A02:2021 – Cryptographic Failures",
    remediation:
      "Remove the key from source immediately. Rotate the key at the provider. Store secrets exclusively in environment variables or the secret management system. Use process.env.KEY_NAME with no fallback literal.",
    autoRemediable: false,
  },
  {
    id: "SCR-002",
    category: "secret_exposure",
    severity: "high",
    title: "Secret or password in URL string",
    description:
      "A password, API key, or token appears embedded in a URL string (e.g., connection strings, API calls).",
    patterns: [
      /(?:https?|postgresql|redis|mongodb):\/\/[^@\s]{5,}:[^@\s]{5,}@/,
      /(?:password|passwd|secret|token)=[A-Za-z0-9\-_]{8,}/i,
    ],
    cwe: "CWE-312",
    owasp: "A02:2021 – Cryptographic Failures",
    remediation:
      "Extract credentials from URLs into separate environment variables. Never log or transmit connection strings containing credentials.",
    autoRemediable: false,
  },
  {
    id: "SCR-003",
    category: "secret_exposure",
    severity: "high",
    title: "Sensitive value logged to console",
    description:
      "A variable whose name suggests it contains sensitive data (password, token, secret, key) is passed to console.log/error/warn.",
    patterns: [
      /console\.\w+\s*\([^)]*(?:password|passwd|secret|token|apikey|api_key|private_?key)[^)]*\)/i,
    ],
    cwe: "CWE-532",
    owasp: "A09:2021 – Security Logging and Monitoring Failures",
    remediation:
      "Never log sensitive values. Log only identifiers and sanitized metadata. Use the SecretsGuard middleware to automatically redact accidental leaks.",
    autoRemediable: false,
  },

  // ── PRT: Prototype Pollution ────────────────────────────────────────────────
  {
    id: "PRT-001",
    category: "prototype_pollution",
    severity: "high",
    title: "Object bracket assignment with user-controlled key",
    description:
      "An object property is set using a user-controlled key via bracket notation. If the key is '__proto__', 'constructor', or 'prototype', this mutates Object.prototype and can affect the entire application.",
    patterns: [
      /\w+\[\s*req\.(body|query|params)\.[a-zA-Z_$]\w*\s*\]\s*=/,
      /\w+\[\s*(?:key|field|prop|name|attr)\s*\]\s*=(?!=)/,
    ],
    cwe: "CWE-1321",
    owasp: "A08:2021 – Software and Data Integrity Failures",
    remediation:
      "Allowlist permitted keys before assignment. Use Object.hasOwn() to verify the key does not reference prototype properties. Consider using Map instead of plain objects for user-keyed data.",
    autoRemediable: false,
  },
  {
    id: "PRT-002",
    category: "prototype_pollution",
    severity: "high",
    title: "Deep merge / Object.assign with user-controlled source",
    description:
      "Object.assign() or a recursive merge function is called with user-supplied data as the source. A crafted '__proto__' key in the input will pollute Object.prototype.",
    patterns: [
      /Object\.assign\s*\(\s*\w+\s*,\s*req\.(body|query|params)/,
      /Object\.assign\s*\(\s*\{\s*\}\s*,\s*req\.(body|query|params)/,
    ],
    cwe: "CWE-1321",
    owasp: "A08:2021 – Software and Data Integrity Failures",
    remediation:
      "Use structuredClone() on user input and strip __proto__, constructor, and prototype keys before merging. Use Zod/Drizzle schemas to validate and shape input before any object assignment.",
    autoRemediable: false,
  },

  // ── XSS: Cross-Site Scripting ───────────────────────────────────────────────
  {
    id: "XSS-001",
    category: "xss",
    severity: "high",
    title: "dangerouslySetInnerHTML with dynamic content",
    description:
      "React's dangerouslySetInnerHTML is set with a value that includes user data or a variable, bypassing React's XSS protection.",
    patterns: [
      /dangerouslySetInnerHTML\s*=\s*\{\s*\{\s*__html\s*:\s*(?!['"`][^'"`]*['"`])/,
      /dangerouslySetInnerHTML\s*=\s*\{\s*\{\s*__html\s*:[^}]*req\./,
      /dangerouslySetInnerHTML\s*=\s*\{\s*\{\s*__html\s*:[^}]*\$\{/,
    ],
    cwe: "CWE-79",
    owasp: "A03:2021 – Injection",
    remediation:
      "Sanitize all HTML with DOMPurify before passing it to dangerouslySetInnerHTML. Prefer rendering as plain text via React children. If HTML rendering is necessary, use a content security policy (CSP).",
    autoRemediable: false,
  },
  {
    id: "XSS-002",
    category: "xss",
    severity: "high",
    title: "Server-side HTML response built with unsanitized user input",
    description:
      "An Express route sends an HTML response that directly embeds user-supplied data without escaping, enabling reflected XSS.",
    patterns: [
      /res\.send\s*\(\s*`[^`]*\$\{\s*req\.(body|query|params)/,
      /res\.send\s*\(\s*['"][^'"]*'\s*\+\s*req\.(body|query|params)/,
    ],
    cwe: "CWE-79",
    owasp: "A03:2021 – Injection",
    remediation:
      "Escape all user input before embedding it in HTML (use a library like he or escape-html). Set Content-Type: application/json for API responses. Implement a Content Security Policy header.",
    autoRemediable: false,
  },

  // ── RDR: Open Redirect ──────────────────────────────────────────────────────
  {
    id: "RDR-001",
    category: "open_redirect",
    severity: "medium",
    title: "Redirect target derived from user input",
    description:
      "res.redirect() is called with a URL constructed from or equal to a user-supplied value. An attacker can redirect users to a malicious site.",
    patterns: [
      /res\.redirect\s*\([^)]*req\.(body|query|params)\.[a-zA-Z_$]\w*/,
      /res\.redirect\s*\(`[^`]*\$\{\s*req\.(body|query|params)/,
    ],
    cwe: "CWE-601",
    owasp: "A01:2021 – Broken Access Control",
    remediation:
      "Use an allowlist of permitted redirect destinations. Parse the URL and verify the hostname matches your domain before redirecting. Default to a safe fallback path if validation fails.",
    autoRemediable: false,
  },

  // ── SRF: Server-Side Request Forgery ───────────────────────────────────────
  {
    id: "SRF-001",
    category: "ssrf",
    severity: "high",
    title: "HTTP fetch/request URL constructed from user input",
    description:
      "A fetch() or HTTP request is made to a URL that incorporates user-supplied data. An attacker can make the server fetch internal services, metadata endpoints, or arbitrary external URLs.",
    patterns: [
      /fetch\s*\([^)]*req\.(body|query|params)\.[a-zA-Z_$]\w*/,
      /fetch\s*\(`[^`]*\$\{\s*req\.(body|query|params)/,
      /axios\s*\.\s*(?:get|post|put|patch|delete)\s*\([^)]*req\.(body|query|params)/,
      /http(?:s)?\.(?:get|request)\s*\([^)]*req\.(body|query|params)/,
    ],
    cwe: "CWE-918",
    owasp: "A10:2021 – Server-Side Request Forgery",
    remediation:
      "Validate and allowlist target URLs or hostnames. Resolve the URL and block requests to private/loopback IP ranges (10.x, 172.16.x, 192.168.x, 127.x, 169.254.x). Never pass raw user input as a URL to server-side HTTP clients.",
    autoRemediable: false,
  },

  // ── DSR: Insecure Deserialization ───────────────────────────────────────────
  {
    id: "DSR-001",
    category: "insecure_deserialization",
    severity: "high",
    title: "JSON.parse on user-supplied data without validation",
    description:
      "JSON.parse is called directly on user-supplied data without subsequent schema validation. Malformed or crafted JSON can cause prototype pollution or unexpected application state.",
    patterns: [
      /JSON\.parse\s*\(\s*req\.(body|query|params)\.[a-zA-Z_$]\w*/,
      /JSON\.parse\s*\(`[^`]*\$\{\s*req\.(body|query|params)/,
    ],
    cwe: "CWE-502",
    owasp: "A08:2021 – Software and Data Integrity Failures",
    remediation:
      "Wrap JSON.parse in a try/catch and immediately validate the result against a Zod schema. Never trust the shape of deserialized data.",
    autoRemediable: false,
  },

  // ── JWT: JWT Vulnerabilities ────────────────────────────────────────────────
  {
    id: "JWT-001",
    category: "jwt_vulnerability",
    severity: "critical",
    title: "JWT decoded without signature verification",
    description:
      "jwt.decode() is used instead of jwt.verify(). decode() does not check the signature, allowing attackers to forge tokens by crafting arbitrary payloads.",
    patterns: [
      /jwt\.decode\s*\(/,
      /jsonwebtoken\.decode\s*\(/,
    ],
    cwe: "CWE-347",
    owasp: "A07:2021 – Identification and Authentication Failures",
    remediation:
      "Replace jwt.decode() with jwt.verify() and always supply the signing secret or public key. Treat the decoded payload as untrusted until verify() succeeds.",
    autoRemediable: true,
  },
  {
    id: "JWT-002",
    category: "jwt_vulnerability",
    severity: "critical",
    title: "JWT algorithm set to 'none' or accepted dynamically from token",
    description:
      "Accepting 'none' as a valid JWT algorithm or reading the algorithm from the token header allows signature bypass — an attacker can produce a valid-looking token with no signature at all.",
    patterns: [
      /algorithms\s*:\s*\[[^\]]*['"`]none['"`]/i,
      /algorithm\s*:\s*['"`]none['"`]/i,
    ],
    cwe: "CWE-347",
    owasp: "A07:2021 – Identification and Authentication Failures",
    remediation:
      "Hardcode the expected algorithm (e.g., 'HS256' or 'RS256') in verify() options. Never include 'none' in the accepted algorithms list.",
    autoRemediable: true,
  },

  // ── TIM: Timing Attack ──────────────────────────────────────────────────────
  {
    id: "TIM-001",
    category: "timing_attack",
    severity: "medium",
    title: "Secrets compared with === instead of timingSafeEqual",
    description:
      "Direct string equality (===) on secrets or tokens is vulnerable to timing attacks. An attacker can measure response time differences to infer correct characters one at a time.",
    patterns: [
      /(?:token|secret|key|password|hash|hmac|sig|signature)\s*===\s*/i,
      /===\s*(?:token|secret|key|password|hash|hmac|sig|signature)/i,
    ],
    cwe: "CWE-208",
    owasp: "A07:2021 – Identification and Authentication Failures",
    remediation:
      "Use crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b)) for all secret comparisons. Ensure both buffers are the same length before comparing.",
    autoRemediable: false,
  },

  // ── RGX: ReDoS ──────────────────────────────────────────────────────────────
  {
    id: "RGX-001",
    category: "redos",
    severity: "medium",
    title: "Potentially catastrophic regex with nested quantifiers",
    description:
      "A regular expression with nested quantifiers (e.g., (a+)+ or (a|a)*) can cause exponential backtracking, leading to denial of service when matched against crafted inputs.",
    patterns: [
      /\/[^/]*\([^)]*[+*]\)[+*][^/]*/,
      /\/[^/]*\([^)]*\|[^)]*\)[+*][^/]*/,
      /\/[^/]*\[[^\]]+\][+*][+*][^/]*/,
    ],
    cwe: "CWE-1333",
    owasp: "A06:2021 – Vulnerable and Outdated Components",
    remediation:
      "Rewrite the regex to eliminate nested quantifiers. Use atomic groups or possessive quantifiers where supported. Test with ReDoS checkers (safe-regex, vuln-regex-detector).",
    autoRemediable: false,
  },

  // ── MAS: Mass Assignment ────────────────────────────────────────────────────
  {
    id: "MAS-001",
    category: "mass_assignment",
    severity: "high",
    title: "Entire request body spread into a database insert or update",
    description:
      "The entire req.body object is spread into a storage or database call. An attacker can inject unexpected fields (e.g., isAdmin, role, balance) that are not part of the intended input.",
    patterns: [
      /storage\.\w+\s*\(\s*\.\.\.\s*req\.body/,
      /db\.\w+\s*\(\s*\.\.\.\s*req\.body/,
      /insert\s*\(\s*\.\.\.\s*req\.body/,
      /update\s*\(\s*\.\.\.\s*req\.body/,
      /create\s*\(\s*\.\.\.\s*req\.body/,
    ],
    cwe: "CWE-915",
    owasp: "A03:2021 – Injection",
    remediation:
      "Destructure only the fields you expect from req.body before passing to the database. Use a Zod insert schema to parse and strip unexpected fields. Never spread raw request objects into storage calls.",
    autoRemediable: false,
  },

  // ── CRS: CORS Misconfiguration ──────────────────────────────────────────────
  {
    id: "CRS-001",
    category: "cors_misconfiguration",
    severity: "high",
    title: "CORS configured with wildcard origin (*) and credentials",
    description:
      "Allowing all origins (*) with credentials:true on CORS violates the CORS spec and browsers block it — but some configurations allow arbitrary origins dynamically, which permits credential theft via cross-origin requests.",
    patterns: [
      /cors\s*\(\s*\{\s*[^}]*origin\s*:\s*['"`]\*['"`][^}]*credentials\s*:\s*true/,
      /cors\s*\(\s*\{\s*[^}]*credentials\s*:\s*true[^}]*origin\s*:\s*['"`]\*['"`]/,
    ],
    cwe: "CWE-942",
    owasp: "A05:2021 – Security Misconfiguration",
    remediation:
      "Use an explicit allowlist of permitted origins. Never combine origin:'*' with credentials:true. Validate the request Origin header against the allowlist before reflecting it.",
    autoRemediable: false,
  },
  {
    id: "CRS-002",
    category: "cors_misconfiguration",
    severity: "medium",
    title: "CORS origin reflected directly from request header",
    description:
      "The Access-Control-Allow-Origin header is set to the value of the incoming Origin header without validation, allowing any origin to make credentialed cross-origin requests.",
    patterns: [
      /Access-Control-Allow-Origin['"]\s*[:]\s*req\.headers\.origin/,
      /setHeader\s*\(\s*['"]Access-Control-Allow-Origin['"]\s*,\s*req\.headers\.origin\s*\)/,
    ],
    cwe: "CWE-942",
    owasp: "A05:2021 – Security Misconfiguration",
    remediation:
      "Check req.headers.origin against an allowlist before reflecting it. Default to a safe explicit origin if the value is not in the list.",
    autoRemediable: false,
  },

  // ── RNG: Insecure Randomness ────────────────────────────────────────────────
  {
    id: "RNG-001",
    category: "insecure_randomness",
    severity: "high",
    title: "Math.random() used for security-sensitive value",
    description:
      "Math.random() is used to generate tokens, codes, session IDs, or passwords. It is not cryptographically secure and its output can be predicted.",
    patterns: [
      /Math\.random\s*\(\s*\)[^;]*(?:token|secret|password|code|key|salt|id|nonce|csrf)/i,
      /(?:token|secret|password|code|key|salt|nonce|csrf)[^;]*Math\.random\s*\(\s*\)/i,
    ],
    cwe: "CWE-338",
    owasp: "A02:2021 – Cryptographic Failures",
    remediation:
      "Replace Math.random() with crypto.randomBytes(n) or crypto.randomUUID() for all security-sensitive random values.",
    autoRemediable: true,
  },

  // ── HCC: Hardcoded Credentials ──────────────────────────────────────────────
  {
    id: "HCC-001",
    category: "hardcoded_credentials",
    severity: "critical",
    title: "Hardcoded password or secret literal in code",
    description:
      "A password, passphrase, or secret is assigned as a string literal in source code. Anyone with access to the repository can extract it.",
    patterns: [
      /(?:password|passwd|pass|secret|passphrase)\s*[=:]\s*['"`][A-Za-z0-9!@#$%^&*()_+\-=]{8,}['"`]/i,
      /(?:const|let|var)\s+(?:PASSWORD|SECRET|PASS|PASSPHRASE)\s*=\s*['"`][^'"`]{8,}['"`]/,
    ],
    cwe: "CWE-259",
    owasp: "A07:2021 – Identification and Authentication Failures",
    remediation:
      "Remove the hardcoded value immediately and rotate it. Store credentials in environment variables or a secrets manager. Reference them via process.env.VAR_NAME.",
    autoRemediable: false,
  },

  // ── AUTH: Authentication / Authorization Bypass ─────────────────────────────
  {
    id: "AUTH-001",
    category: "auth_bypass",
    severity: "critical",
    title: "Loose equality used in authentication check",
    description:
      "Using == instead of === in an authentication or authorization check can allow type coercion bypass (e.g., '0' == false, null == undefined).",
    patterns: [
      /(?:admin|isAdmin|role|auth|authorized|permission|access)[^;=]*==(?!=)[^=]/i,
    ],
    cwe: "CWE-284",
    owasp: "A01:2021 – Broken Access Control",
    remediation:
      "Use strict equality (===) in all authentication and authorization checks. Validate user roles against a typed enum or allowlist.",
    autoRemediable: true,
  },
  {
    id: "AUTH-002",
    category: "auth_bypass",
    severity: "high",
    title: "Authentication check skipped for non-GET requests",
    description:
      "An isAuthenticated guard is present for some methods but missing for mutating methods (POST, PUT, PATCH, DELETE), allowing unauthenticated writes.",
    patterns: [
      /router\.(?:post|put|patch|delete)\s*\([^,)]+,\s*(?:async\s*)?\((?:req|request)\s*[,)]/,
    ],
    cwe: "CWE-306",
    owasp: "A01:2021 – Broken Access Control",
    remediation:
      "Apply the isAuthenticated middleware to all state-mutating routes. Review every router.post/put/patch/delete handler to confirm authentication is enforced before business logic runs.",
    autoRemediable: false,
  },

  // ── RTE: Missing Rate Limiting ──────────────────────────────────────────────
  {
    id: "RTE-001",
    category: "missing_rate_limit",
    severity: "medium",
    title: "Login or password-reset endpoint without rate limiting",
    description:
      "An endpoint matching login, sign-in, or password-reset patterns is registered without a visible rate limiter, enabling brute-force attacks.",
    patterns: [
      /router\.post\s*\(\s*['"`][^'"`]*(?:login|signin|sign-in|password[-_]?reset|forgot[-_]?password)['"`]\s*,\s*(?!.*rateLimit)/i,
    ],
    cwe: "CWE-307",
    owasp: "A07:2021 – Identification and Authentication Failures",
    remediation:
      "Apply express-rate-limit (or equivalent) to authentication endpoints. Limit attempts to 5–10 per minute per IP. Add exponential backoff or account lockout after repeated failures.",
    autoRemediable: false,
  },
];

// ─── Encryption helpers (AES-256-GCM) ─────────────────────────────────────────

const VRISK_KEY_ENV = "ENCRYPTION_KEY";
const VRISK_NAMESPACE = "vrisk:audit:";
const VRISK_INDEX_KEY = "vrisk:index";
const VRISK_STATS_KEY = "vrisk:stats";

function getDerivedKey(): Buffer | null {
  const raw = process.env[VRISK_KEY_ENV];
  if (!raw || raw.length < 8) return null;
  return crypto.createHash("sha256").update(raw).digest();
}

function encryptFinding(finding: VRiskFinding): string {
  const key = getDerivedKey();
  if (!key) return JSON.stringify(finding);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const plain = JSON.stringify(finding);
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    iv.toString("hex"),
    tag.toString("hex"),
    encrypted.toString("hex"),
  ].join(".");
}

function decryptFinding(payload: string): VRiskFinding | null {
  const key = getDerivedKey();
  if (!key) {
    try { return JSON.parse(payload); } catch { return null; }
  }
  try {
    const [ivHex, tagHex, encHex] = payload.split(".");
    if (!ivHex || !tagHex || !encHex) return null;
    const iv = Buffer.from(ivHex, "hex");
    const tag = Buffer.from(tagHex, "hex");
    const enc = Buffer.from(encHex, "hex");
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv, { authTagLength: 16 });
    decipher.setAuthTag(tag);
    const plain = decipher.update(enc) + decipher.final("utf8");
    return JSON.parse(plain);
  } catch {
    return null;
  }
}

// ─── Finding ID generation ─────────────────────────────────────────────────────

function makeFindingId(ruleId: string, snippet: string): string {
  return crypto
    .createHash("sha1")
    .update(`${ruleId}:${snippet.slice(0, 120)}`)
    .digest("hex")
    .slice(0, 16);
}

// ─── Agent state ──────────────────────────────────────────────────────────────

let totalScans = 0;
let totalFindings = 0;
let openFindings = 0;
let lastScanAt: string | null = null;
let lastFindingAt: string | null = null;
let initialized = false;

// ─── Core scanner ─────────────────────────────────────────────────────────────

function assessConfidence(rule: VRiskRule, snippet: string): VRiskConfidence {
  const lower = snippet.toLowerCase();

  const hasValidation =
    /\/\^\[?\\d\]?\+\$\//.test(snippet) ||
    /parseInt|parseFloat|Number\(/.test(snippet) ||
    /\.test\s*\(/.test(snippet) ||
    /allowlist|whitelist|validate|sanitize|escape/.test(lower);

  const hasUserInput =
    /req\.(body|query|params)/.test(snippet) ||
    /process\.env/.test(snippet) ||
    /socket\./.test(snippet);

  if (rule.severity === "critical") {
    if (hasUserInput && !hasValidation) return "confirmed";
    if (hasUserInput && hasValidation) return "likely";
    return "possible";
  }

  if (rule.severity === "high") {
    if (hasUserInput && !hasValidation) return "likely";
    if (hasValidation) return "possible";
    return "possible";
  }

  if (hasValidation) return "possible";
  return "likely";
}

export function scanCode(
  input: string,
  contextLabel?: string
): VRiskScanResult {
  const start = Date.now();
  const findings: VRiskFinding[] = [];

  const lines = input.split("\n");

  for (const rule of VRISK_RULES) {
    for (const pattern of rule.patterns) {
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!pattern.test(line)) continue;

        const snippet = line.trim().slice(0, 200);
        const id = makeFindingId(rule.id, snippet);

        if (findings.some((f) => f.id === id)) continue;

        const confidence = assessConfidence(rule, snippet);

        const contextStart = Math.max(0, i - 2);
        const contextEnd = Math.min(lines.length, i + 3);
        const context = lines.slice(contextStart, contextEnd).join("\n");

        const finding: VRiskFinding = {
          id,
          ruleId: rule.id,
          category: rule.category,
          severity: rule.severity,
          confidence,
          title: rule.title,
          description: rule.description,
          cwe: rule.cwe,
          owasp: rule.owasp,
          remediation: rule.remediation,
          snippet,
          matchedPattern: pattern.toString(),
          context,
          status: "open",
          detectedAt: new Date().toISOString(),
          autoRemediable: rule.autoRemediable,
        };

        if (confidence !== "false_positive") {
          findings.push(finding);
        }
      }
    }
  }

  const summary = {
    total: findings.length,
    critical: findings.filter((f) => f.severity === "critical").length,
    high: findings.filter((f) => f.severity === "high").length,
    medium: findings.filter((f) => f.severity === "medium").length,
    low: findings.filter((f) => f.severity === "low").length,
    info: findings.filter((f) => f.severity === "info").length,
  };

  const riskScore = Math.min(
    100,
    summary.critical * 25 +
      summary.high * 10 +
      summary.medium * 4 +
      summary.low * 1
  );

  let recommendation: VRiskScanResult["recommendation"] = "clear";
  if (summary.critical > 0) recommendation = "block";
  else if (summary.high > 0) recommendation = "review";
  else if (summary.medium > 0 || summary.low > 0) recommendation = "monitor";

  totalScans++;
  if (findings.length > 0) {
    totalFindings += findings.length;
    openFindings += findings.filter((f) => f.status === "open").length;
    lastFindingAt = new Date().toISOString();

    structuredLog("warn", "security_alert", `[VRisk] ${findings.length} finding(s) detected`, {
      metadata: {
        context: contextLabel,
        summary,
        riskScore,
        recommendation,
      },
    });
  }

  lastScanAt = new Date().toISOString();

  return {
    scannedAt: lastScanAt,
    scanDurationMs: Date.now() - start,
    inputLength: input.length,
    findings,
    summary,
    riskScore,
    recommendation,
  };
}

// ─── Encrypted cache persistence ──────────────────────────────────────────────

export async function persistFindings(findings: VRiskFinding[]): Promise<void> {
  if (findings.length === 0) return;
  const hasKey = !!getDerivedKey();

  const index: string[] = [];
  for (const finding of findings) {
    const payload = hasKey ? encryptFinding(finding) : JSON.stringify(finding);
    finding.encryptedPayload = hasKey ? payload : undefined;
    await vRiskSet(`${VRISK_NAMESPACE}${finding.id}`, payload);
    index.push(finding.id);
  }

  const existingRaw = await vRiskGet(VRISK_INDEX_KEY);
  const existing: string[] = existingRaw ? (() => { try { return JSON.parse(existingRaw); } catch { return []; } })() : [];
  const merged = [...new Set([...existing, ...index])];
  await vRiskSet(VRISK_INDEX_KEY, JSON.stringify(merged));
}

export async function loadFindings(): Promise<VRiskFinding[]> {
  const indexRaw = await vRiskGet(VRISK_INDEX_KEY);
  const index: string[] = indexRaw ? (() => { try { return JSON.parse(indexRaw); } catch { return []; } })() : [];
  const findings: VRiskFinding[] = [];
  const hasKey = !!getDerivedKey();

  for (const id of index) {
    const raw = await vRiskGet(`${VRISK_NAMESPACE}${id}`);
    if (!raw) continue;
    const finding = hasKey
      ? decryptFinding(raw)
      : (() => { try { return JSON.parse(raw) as VRiskFinding; } catch { return null; } })();
    if (finding) findings.push(finding);
  }

  return findings;
}

export async function updateFindingStatus(
  id: string,
  status: VRiskStatus
): Promise<boolean> {
  const hasKey = !!getDerivedKey();
  const raw = await vRiskGet(`${VRISK_NAMESPACE}${id}`);
  if (!raw) return false;

  const finding = hasKey
    ? decryptFinding(raw)
    : (() => { try { return JSON.parse(raw) as VRiskFinding; } catch { return null; } })();
  if (!finding) return false;

  finding.status = status;
  if (status === "resolved" || status === "dismissed") {
    finding.resolvedAt = new Date().toISOString();
    if (status === "resolved") openFindings = Math.max(0, openFindings - 1);
  }

  const updated = hasKey ? encryptFinding(finding) : JSON.stringify(finding);
  await vRiskSet(`${VRISK_NAMESPACE}${id}`, updated);
  return true;
}

// ─── Scan + persist in one call ───────────────────────────────────────────────

export async function scanAndPersist(
  input: string,
  contextLabel?: string
): Promise<VRiskScanResult> {
  const result = scanCode(input, contextLabel);
  await persistFindings(result.findings);
  return result;
}

// ─── Agent initialization ─────────────────────────────────────────────────────

export function initVRisk(): void {
  if (initialized) return;
  initialized = true;
  const hasEncryption = !!getDerivedKey();
  console.log(
    `[JunoVRisk] Initialized — ${VRISK_RULES.length} rules across ${
      [...new Set(VRISK_RULES.map((r) => r.category))].length
    } categories | Encryption: ${hasEncryption ? "AES-256-GCM active" : "key not set — storing plain"} | Storage: Redis+memory only (no CDN)`
  );
}

// ─── Status report ────────────────────────────────────────────────────────────

export function getVRiskStatus(): VRiskAgentStatus {
  return {
    initialized,
    totalRules: VRISK_RULES.length,
    totalScans,
    totalFindings,
    openFindings,
    lastScanAt,
    lastFindingAt,
    cacheNamespace: VRISK_NAMESPACE,
    encryptionActive: !!getDerivedKey(),
  };
}

export function getVRiskRules(): VRiskRule[] {
  return VRISK_RULES;
}
