// Remote client configuration — fetched once at module load from the GitHub-CDN-backed
// endpoint. Controls all critical UX timing, connection, upload, and query parameters.
// Changes in config/client-config.json in the GitHub CDN take effect within 1 hour
// without any code deploy.

export interface ClientConfig {
  // Socket.IO — /chat namespace (group rooms)
  socket_chat_reconnect_delay_ms: number;
  socket_chat_reconnect_delay_max_ms: number;
  socket_chat_timeout_ms: number;
  // Socket.IO — /dm namespace (direct messages)
  socket_dm_reconnect_delay_ms: number;
  socket_dm_reconnect_delay_max_ms: number;
  socket_dm_reconnect_attempts: number;
  socket_dm_timeout_ms: number;
  // Raw WebSocket (misc signaling)
  ws_heartbeat_interval_ms: number;
  ws_heartbeat_timeout_ms: number;
  ws_reconnect_initial_delay_ms: number;
  ws_reconnect_max_delay_ms: number;
  // File upload limits
  upload_max_mb_mobile: number;
  upload_max_mb_desktop: number;
  // Notification durations
  toast_duration_ms: number;
  toast_error_duration_ms: number;
  // Data refresh intervals
  contacts_refetch_interval_ms: number;
  feature_flags_refetch_interval_ms: number;
  // TanStack Query global defaults
  query_default_stale_time_ms: number;
  query_default_retry_max_delay_ms: number;
}

const DEFAULTS: ClientConfig = {
  socket_chat_reconnect_delay_ms: 1_000,
  socket_chat_reconnect_delay_max_ms: 15_000,
  socket_chat_timeout_ms: 10_000,
  socket_dm_reconnect_delay_ms: 1_000,
  socket_dm_reconnect_delay_max_ms: 8_000,
  socket_dm_reconnect_attempts: 15,
  socket_dm_timeout_ms: 10_000,
  ws_heartbeat_interval_ms: 15_000,
  ws_heartbeat_timeout_ms: 10_000,
  ws_reconnect_initial_delay_ms: 1_000,
  ws_reconnect_max_delay_ms: 15_000,
  upload_max_mb_mobile: 15,
  upload_max_mb_desktop: 25,
  toast_duration_ms: 3_500,
  toast_error_duration_ms: 5_000,
  contacts_refetch_interval_ms: 30_000,
  feature_flags_refetch_interval_ms: 300_000,
  query_default_stale_time_ms: 30_000,
  query_default_retry_max_delay_ms: 8_000,
};

let _cfg: ClientConfig = { ...DEFAULTS };
let _ready = false;

const _readyPromise = fetch("/api/v1/client-config")
  .then(r => (r.ok ? r.json() : null))
  .then((data: Partial<ClientConfig> | null) => {
    if (data && typeof data === "object") {
      _cfg = { ...DEFAULTS, ...data };
    }
    _ready = true;
  })
  .catch(() => { _ready = true; });

export function getClientConfig(): ClientConfig {
  return _cfg;
}

export function isClientConfigReady(): boolean {
  return _ready;
}

export function whenClientConfigReady(): Promise<void> {
  return _readyPromise as Promise<void>;
}
