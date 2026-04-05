import { useState, useEffect } from "react";
import { STORAGE_KEYS } from "@/lib/storage-keys";
import { useAuth } from "@/hooks/use-auth";
import SectionBoundary from "@/components/dashboard/SectionBoundary";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { apiRequest } from "@/lib/queryClient";
import BackTriangle from "@/components/BackTriangle";
import { 
  LayoutDashboard,
  Puzzle,
  Plug,
  Key,
  Settings as SettingsIcon,
  FileText,
  Activity,
  Clock,
  Zap,
  AlertCircle,
  CheckCircle,
  Lock,
  Globe,
  Shield,
  BookOpen,
  Code,
  Webhook,
  Users,
  TrendingUp,
  Server,
  TicketCheck,
  Loader2,
  Brain,
  HardDrive,
  Trash2,
  Database,
  Video,
  Phone,
  PhoneOff,
  Eye,
  RefreshCw,
  CircleDot,
  Bot,
  Send,
  Copy,
  Play,
  Wrench,
  ChevronDown,
  ChevronUp,
  Gauge,
  CircleCheck,
  TriangleAlert,
  Info,
  Bell,
  BellDot,
  CheckCheck,
  MessageSquare,
  MessageSquareText,
  Sparkles,
  Timer,
  Square,
  RotateCcw
} from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Link } from "wouter";
import { safeDisplayName } from "@/lib/utils";

type PortalSection = "dashboard" | "modules" | "integration" | "api-keys" | "claude-ai" | "settings" | "docs" | "tickets" | "feedback";

function getPortalAccessCode(): string {
  let code = sessionStorage.getItem("devPortalAccessCode") || "";
  if (!code) {
    const stored = localStorage.getItem("dev_portal_access");
    if (stored) {
      code = atob(stored);
      sessionStorage.setItem("devPortalAccessCode", code);
    }
  }
  return code;
}

function adminFetch(url: string, options?: RequestInit): Promise<Response> {
  const code = getPortalAccessCode();
  const separator = url.includes("?") ? "&" : "?";
  const fullUrl = code ? `${url}${separator}accessCode=${encodeURIComponent(code)}` : url;
  return fetch(fullUrl, { credentials: "include", ...options });
}

function DashboardSection() {
  const [metricsData, setMetricsData] = useState<any>(null);
  const [healthData, setHealthData] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchMetrics = async () => {
    try {
      const [metricsRes, healthRes] = await Promise.all([
        adminFetch("/api/metrics"),
        adminFetch("/api/metrics/health-analysis"),
      ]);
      if (metricsRes.ok) setMetricsData(await metricsRes.json());
      if (healthRes.ok) setHealthData(await healthRes.json());
    } catch (err) {
      console.error("Failed to fetch metrics:", err);
    }
    setIsLoading(false);
  };

  useEffect(() => {
    fetchMetrics();
    const interval = setInterval(fetchMetrics, 10000);
    return () => clearInterval(interval);
  }, []);

  const formatUptime = (ms: number) => {
    const hours = Math.floor(ms / 3600000);
    const minutes = Math.floor((ms % 3600000) / 60000);
    return `${hours}h ${minutes}m`;
  };

  const formatTimeAgo = (timestamp: number) => {
    const diff = Date.now() - timestamp;
    if (diff < 60000) return "just now";
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    return `${Math.floor(diff / 3600000)}h ago`;
  };

  const dismissAlert = async (alertId: string) => {
    try {
      await adminFetch("/api/metrics/dismiss-alert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ alertId }),
      });
      fetchMetrics();
    } catch (err) {
      console.error("Failed to dismiss alert:", err);
    }
  };

  const kpis = [
    { label: "Subscribers", value: metricsData?.totalSubscribers?.toLocaleString() ?? "--", change: "signed up", icon: Users },
    { label: "Translations", value: metricsData?.translationRequests?.total?.toLocaleString() || "0", change: `${metricsData?.translationRequests?.success || 0} OK`, icon: Activity },
    { label: "Avg Latency", value: `${metricsData?.latency?.avg || 0}ms`, change: `p95: ${metricsData?.latency?.p95 || 0}ms`, icon: Clock },
    { label: "WS Connections", value: String(metricsData?.websocket?.currentConnections || 0), change: `${metricsData?.websocket?.totalConnections || 0} total`, icon: Plug },
    { label: "Error Rate", value: metricsData?.errorRate || "0%", change: `${metricsData?.translationRequests?.failed || 0} failed`, icon: AlertCircle },
  ];

  const hasAlerts = metricsData?.alerts?.length > 0;
  const health = metricsData?.systemHealth;
  const aiScore = healthData?.score ?? -1;

  const scoreColor = aiScore >= 80 ? "text-blue-700 dark:text-blue-500 dark:text-blue-400" : aiScore >= 50 ? "text-amber-600 dark:text-amber-400" : aiScore >= 0 ? "text-red-600/90 dark:text-red-400/90" : "text-muted-foreground";
  const scoreBg = aiScore >= 80 ? "bg-blue-600/80" : aiScore >= 50 ? "bg-amber-500/80" : aiScore >= 0 ? "bg-red-500/85" : "bg-muted-foreground";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-2xl font-bold mb-2">Dashboard</h2>
          <p className="text-muted-foreground">Live monitoring &middot; Uptime: {metricsData ? formatUptime(metricsData.uptime) : "--"}</p>
        </div>
        <Button variant="outline" size="sm" onClick={fetchMetrics} disabled={isLoading} data-testid="button-refresh-metrics">
          <Activity className="w-4 h-4 mr-1" />
          Refresh
        </Button>
      </div>

      {healthData && aiScore >= 0 && (
        <Card data-testid="card-ai-health">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-start gap-3">
              <div className={`w-10 h-10 rounded-lg ${scoreBg} flex items-center justify-center shrink-0`}>
                <Brain className="w-5 h-5 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                  <span className="text-sm font-medium">AI Health Score</span>
                  <span className={`text-xl font-bold ${scoreColor}`} data-testid="text-ai-score">{aiScore}/100</span>
                </div>
                <p className="text-sm text-muted-foreground mb-2" data-testid="text-ai-analysis">{healthData.analysis}</p>
                {healthData.recommendations?.length > 0 && (
                  <div className="space-y-1">
                    {healthData.recommendations.map((rec: string, i: number) => (
                      <div key={i} className="flex items-start gap-2 text-xs">
                        <CheckCircle className="w-3 h-3 mt-0.5 text-primary shrink-0" />
                        <span data-testid={`text-recommendation-${i}`}>{rec}</span>
                      </div>
                    ))}
                  </div>
                )}
                <p className="text-[10px] text-muted-foreground mt-2">
                  Auto-updates every 5 min &middot; Last: {healthData.timestamp ? formatTimeAgo(healthData.timestamp) : "--"}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {hasAlerts && (
        <div className="space-y-2" data-testid="alerts-section">
          {metricsData.alerts.map((alert: any) => (
            <Card key={alert.id} className={alert.type === "critical" ? "border-destructive bg-destructive/5" : "border-amber-500/70 bg-amber-500/5"}>
              <CardContent className="py-3 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <AlertCircle className={`w-4 h-4 ${alert.type === "critical" ? "text-destructive" : "text-amber-500"}`} />
                  <span className="text-sm font-medium">{alert.message}</span>
                  <span className="text-xs text-muted-foreground">{formatTimeAgo(alert.timestamp)}</span>
                </div>
                <Button variant="ghost" size="sm" onClick={() => dismissAlert(alert.id)} data-testid={`button-dismiss-${alert.id}`}>
                  Dismiss
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {kpis.map((kpi) => (
          <Card key={kpi.label} data-testid={`card-kpi-${kpi.label.toLowerCase().replace(/\s+/g, '-')}`}>
            <CardContent className="pt-4 lg:pt-6">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                <kpi.icon className="w-4 h-4 lg:w-5 lg:h-5 text-muted-foreground" />
                <Badge variant="secondary" className="text-xs">{kpi.change}</Badge>
              </div>
              <div className="text-xl lg:text-2xl font-bold" data-testid={`text-kpi-value-${kpi.label.toLowerCase().replace(/\s+/g, '-')}`}>{kpi.value}</div>
              <div className="text-xs lg:text-sm text-muted-foreground">{kpi.label}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {health && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 lg:gap-6">
          <Card data-testid="card-memory-health">
            <CardHeader className="pb-2 lg:pb-4">
              <CardTitle className="text-lg flex items-center gap-2">
                <HardDrive className="w-5 h-5" />
                Memory Usage
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <div>
                  <div className="flex flex-wrap justify-between gap-2 text-sm mb-1">
                    <span>Heap</span>
                    <span className="font-mono" data-testid="text-heap-usage">{health.memory.heapUsedMB} / {health.memory.heapTotalMB} MB</span>
                  </div>
                  <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary rounded-full transition-all"
                      style={{ width: `${Math.min(100, (health.memory.heapUsedMB / health.memory.heapTotalMB) * 100)}%` }}
                    />
                  </div>
                </div>
                <div className="flex flex-wrap justify-between gap-2 text-sm">
                  <span>RSS</span>
                  <span className="font-mono" data-testid="text-rss">{health.memory.rssMB} MB</span>
                </div>
                <div className="flex flex-wrap justify-between gap-2 text-sm">
                  <span>External</span>
                  <span className="font-mono" data-testid="text-external">{health.memory.externalMB} MB</span>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card data-testid="card-caches">
            <CardHeader className="pb-2 lg:pb-4">
              <CardTitle className="text-lg flex items-center gap-2">
                <Database className="w-5 h-5" />
                Cache &amp; Cleanup
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 text-sm">
                <div className="flex flex-wrap justify-between gap-2">
                  <span>Video Captions</span>
                  <Badge variant="secondary" data-testid="badge-cache-video">{health.caches.videoCaptions}</Badge>
                </div>
                <div className="flex flex-wrap justify-between gap-2">
                  <span>Translated Captions</span>
                  <Badge variant="secondary" data-testid="badge-cache-translated">{health.caches.translatedCaptions}</Badge>
                </div>
                <div className="flex flex-wrap justify-between gap-2">
                  <span>Rate Limiters</span>
                  <Badge variant="secondary" data-testid="badge-cache-ratelimit">{health.caches.rateLimiters}</Badge>
                </div>
                {health.cleanup.runCount > 0 && (
                  <div className="pt-2 border-t mt-2 space-y-1" data-testid="text-cleanup-stats">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Trash2 className="w-3 h-3" />
                      <span>{health.cleanup.runCount} cleanups &middot; {health.cleanup.totalCleaned} total cleared</span>
                    </div>
                    <div className="text-xs text-muted-foreground" data-testid="text-cleanup-last-run">
                      Last run: {health.cleanup.lastRunAt ? formatTimeAgo(health.cleanup.lastRunAt) : "never"} &middot; Cleared {health.cleanup.lastCleaned}
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {metricsData?.videoCalls && (
        <Card data-testid="card-video-calls">
          <CardHeader className="pb-2 lg:pb-4">
            <CardTitle className="text-lg flex items-center gap-2">
              <Video className="w-5 h-5" />
              Video Calls
            </CardTitle>
            <CardDescription>Live video call monitoring &amp; JaaS status</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 rounded-lg bg-muted/50">
                  <div className="flex items-center gap-1.5 mb-1">
                    <Phone className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                    <span className="text-xs text-muted-foreground">Active Now</span>
                  </div>
                  <span className="text-xl font-bold" data-testid="text-active-calls">{metricsData.videoCalls.activeCount}</span>
                </div>
                <div className="p-3 rounded-lg bg-muted/50">
                  <div className="flex items-center gap-1.5 mb-1">
                    <Activity className="w-3.5 h-3.5 text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">Total Calls</span>
                  </div>
                  <span className="text-xl font-bold" data-testid="text-total-calls">{metricsData.videoCalls.totalCalls}</span>
                </div>
                <div className="p-3 rounded-lg bg-muted/50">
                  <div className="flex items-center gap-1.5 mb-1">
                    <Clock className="w-3.5 h-3.5 text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">Avg Duration</span>
                  </div>
                  <span className="text-lg font-bold" data-testid="text-avg-duration">{metricsData.videoCalls.avgDuration}</span>
                </div>
                <div className="p-3 rounded-lg bg-muted/50">
                  <div className="flex items-center gap-1.5 mb-1">
                    <TrendingUp className="w-3.5 h-3.5 text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">Peak Concurrent</span>
                  </div>
                  <span className="text-xl font-bold" data-testid="text-peak-calls">{metricsData.videoCalls.peakConcurrent}</span>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t">
                <span className="text-sm font-medium">JaaS (8x8) Integration</span>
                <Badge variant={metricsData.videoCalls.jaasConfigured ? "outline" : "destructive"} data-testid="badge-jaas-status">
                  {metricsData.videoCalls.jaasConfigured ? "Configured" : "Not Configured"}
                </Badge>
              </div>

              {metricsData.videoCalls.activeCalls?.length > 0 && (
                <div className="space-y-2 pt-2 border-t">
                  <span className="text-sm font-medium">Active Calls</span>
                  {metricsData.videoCalls.activeCalls.map((call: any, i: number) => (
                    <div key={i} className="flex flex-wrap items-center justify-between gap-2 text-sm p-2 rounded-md bg-muted/30">
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-blue-600/80 animate-pulse" />
                        <span className="font-mono text-xs">{call.roomCode}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary" className="text-xs">{call.participants} users</Badge>
                        <span className="text-xs text-muted-foreground">{call.duration}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {metricsData.videoCalls.recentCalls?.length > 0 && (
                <div className="space-y-2 pt-2 border-t">
                  <span className="text-sm font-medium">Recent Calls</span>
                  {metricsData.videoCalls.recentCalls.map((call: any, i: number) => (
                    <div key={i} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                      <div className="flex items-center gap-2">
                        <PhoneOff className="w-3 h-3 text-muted-foreground" />
                        <span className="font-mono text-xs">{call.roomCode}</span>
                      </div>
                      <span className="text-xs text-muted-foreground">{call.duration}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 lg:gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Server className="w-5 h-5" />
              Service Status
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <div className={`w-3 h-3 rounded-full ${hasAlerts ? "bg-amber-500/80" : "bg-blue-600/80"} animate-pulse`} />
              <span className={`font-medium ${hasAlerts ? "text-amber-600 dark:text-amber-400" : "text-blue-700 dark:text-blue-500 dark:text-blue-400"}`}>
                {hasAlerts ? "Alerts Active" : "All Systems Operational"}
              </span>
            </div>
            <div className="mt-4 space-y-2 text-sm">
              <div className="flex flex-wrap justify-between gap-2" data-testid="status-translation-api">
                <span>Translation API</span>
                <Badge variant="outline" className="text-blue-700 dark:text-blue-500 dark:text-blue-400">Operational</Badge>
              </div>
              <div className="flex flex-wrap justify-between gap-2" data-testid="status-webrtc-relay">
                <span>WebRTC Relay</span>
                <Badge variant="outline" className="text-blue-700 dark:text-blue-500 dark:text-blue-400">Operational</Badge>
              </div>
              <div className="flex flex-wrap justify-between gap-2" data-testid="status-rooms">
                <span>Active Rooms</span>
                <Badge variant="outline">{metricsData?.rooms?.activeRooms || 0}</Badge>
              </div>
              <div className="flex flex-wrap justify-between gap-2" data-testid="status-rooms-created">
                <span>Rooms Created</span>
                <Badge variant="outline">{metricsData?.rooms?.totalCreated || 0}</Badge>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <TrendingUp className="w-5 h-5" />
              Translation Providers
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {metricsData?.translationRequests?.byProvider && Object.entries(metricsData.translationRequests.byProvider).map(([provider, count]: [string, any]) => (
                <div key={provider} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span className="capitalize font-medium">{provider}</span>
                  <Badge variant="secondary">{count} requests</Badge>
                </div>
              ))}
              {metricsData?.latency?.sampleCount > 0 && (
                <div className="pt-2 border-t mt-2">
                  <div className="flex flex-wrap justify-between gap-2 text-sm">
                    <span>Max Latency</span>
                    <span className="font-mono text-sm">{metricsData.latency.max}ms</span>
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {metricsData?.recentErrors?.length > 0 && (
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <AlertCircle className="w-5 h-5 text-destructive" />
                Recent Errors
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {metricsData.recentErrors.map((error: any, i: number) => (
                  <div key={i} className="flex flex-wrap items-start gap-3 text-sm">
                    <Badge variant="destructive" className="text-xs">{error.provider}</Badge>
                    <div className="flex-1">
                      <p className="break-all">{error.message}</p>
                      <p className="text-xs text-muted-foreground">{formatTimeAgo(error.timestamp)}</p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

function ModulesSection() {
  const [earningEnabled, setEarningEnabled] = useState(false);
  useEffect(() => {
    fetch("/api/feature/earning")
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) setEarningEnabled(data.enabled); })
      .catch(() => {});
  }, []);

  const modules = [
    {
      name: "Real-time Video Translation",
      description: "Live speech-to-text with instant translation during video calls",
      status: "active",
      endpoints: ["POST /v1/translate/session", "GET /v1/translate/status"],
    },
    {
      name: "Captions & Subtitles Generator",
      description: "Generate captions and downloadable subtitle files",
      status: "active",
      endpoints: ["POST /v1/captions/generate", "GET /v1/captions/:id"],
    },
    {
      name: "Language Detection",
      description: "Automatic spoken language detection from audio streams",
      status: "active",
      endpoints: ["POST /v1/detect/language"],
    },
    {
      name: "Speaker Diarization",
      description: "Identify and separate multiple speakers in a conversation",
      status: "coming_soon",
      endpoints: ["POST /v1/diarize/session"],
    },
    {
      name: "Translation Glossary",
      description: "Custom terminology and brand-specific translations",
      status: "coming_soon",
      endpoints: ["POST /v1/glossary", "PUT /v1/glossary/:id"],
    },
    {
      name: "Enterprise Compliance",
      description: "HIPAA, SOC2, and GDPR compliant processing options",
      status: "coming_soon",
      endpoints: ["GET /v1/compliance/audit-logs"],
    },
    {
      name: "Webhooks & Event Streaming",
      description: "Real-time event notifications and streaming updates",
      status: "coming_soon",
      endpoints: ["POST /v1/webhooks", "GET /v1/events/stream"],
    },
    {
      name: "Earning Hub",
      description: "Earning opportunities hub with partner platforms. Quick Earnings, Language Opportunities, Bonus Signups, and Remote Tasks categories with search and external links",
      status: "active",
      endpoints: ["GET /v1/earning/categories", "GET /v1/earning/search"],
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-2">Modules</h2>
        <p className="text-muted-foreground">Available product modules and their capabilities</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {modules.map((module, idx) => (
          <Card key={module.name} className={module.status === "coming_soon" ? "opacity-70" : ""} data-testid={`card-module-${idx}`}>
            <CardHeader className="pb-2 lg:pb-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <CardTitle className="text-base lg:text-lg" data-testid={`text-module-name-${idx}`}>{module.name}</CardTitle>
                <Badge variant={module.status === "active" ? "default" : "secondary"} data-testid={`badge-module-status-${idx}`}>
                  {module.status === "active" ? "Active" : "Coming Soon"}
                </Badge>
              </div>
              <CardDescription className="text-xs lg:text-sm">{module.description}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Endpoints</p>
                <div className="space-y-1">
                  {module.endpoints.map((endpoint) => (
                    <code key={endpoint} className="block text-xs bg-muted px-2 py-1 rounded">
                      {endpoint}
                    </code>
                  ))}
                </div>
              </div>
              <Button 
                variant="outline" 
                size="sm" 
                className="w-full mt-4"
                disabled={module.status === "coming_soon"}
                data-testid={`button-module-action-${idx}`}
              >
                {module.status === "active" ? "Configure" : "Notify Me"}
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function IntegrationSection() {
  const steps = [
    { step: 1, title: "Create API Key", description: "Generate your API credentials from the API Keys page" },
    { step: 2, title: "Configure Webhook", description: "Set up your webhook URL to receive real-time events" },
    { step: 3, title: "Use SDK / REST", description: "Integrate using our SDK or make direct REST API calls" },
    { step: 4, title: "Go Live", description: "Switch to production environment and launch" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-2">Integration Guide</h2>
        <p className="text-muted-foreground">Step-by-step guide to integrate JunoTalk API</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Quick Start Steps</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-4">
            {steps.map((s, i) => (
              <div key={s.step} className="flex-1 relative min-w-[120px]" data-testid={`step-${s.step}`}>
                <div className="flex flex-wrap items-center gap-3 mb-2">
                  <div className="w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-sm font-bold">
                    {s.step}
                  </div>
                  {i < steps.length - 1 && (
                    <div className="flex-1 h-0.5 bg-border hidden sm:block" />
                  )}
                </div>
                <h4 className="font-medium" data-testid={`text-step-title-${s.step}`}>{s.title}</h4>
                <p className="text-sm text-muted-foreground">{s.description}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Integration Architecture</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center justify-between gap-4 p-4 bg-muted rounded-lg text-sm" data-testid="integration-diagram">
            <div className="text-center" data-testid="diagram-node-app">
              <div className="w-12 h-12 rounded-lg bg-background border flex items-center justify-center mx-auto mb-2">
                <Globe className="w-6 h-6" />
              </div>
              <p className="font-medium">Your App</p>
            </div>
            <div className="flex-1 border-t-2 border-dashed hidden sm:block" />
            <div className="text-center" data-testid="diagram-node-api">
              <div className="w-12 h-12 rounded-lg bg-background border flex items-center justify-center mx-auto mb-2">
                <Server className="w-6 h-6" />
              </div>
              <p className="font-medium">JunoTalk API</p>
            </div>
            <div className="flex-1 border-t-2 border-dashed hidden sm:block" />
            <div className="text-center" data-testid="diagram-node-translation">
              <div className="w-12 h-12 rounded-lg bg-background border flex items-center justify-center mx-auto mb-2">
                <Zap className="w-6 h-6" />
              </div>
              <p className="font-medium">Translation</p>
            </div>
            <div className="flex-1 border-t-2 border-dashed hidden sm:block" />
            <div className="text-center" data-testid="diagram-node-results">
              <div className="w-12 h-12 rounded-lg bg-background border flex items-center justify-center mx-auto mb-2">
                <Activity className="w-6 h-6" />
              </div>
              <p className="font-medium">Results</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 lg:gap-6">
        <Card>
          <CardHeader className="pb-2 lg:pb-4">
            <CardTitle className="text-base lg:text-lg">REST API Example</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="bg-muted p-3 lg:p-4 rounded-lg text-xs overflow-x-auto">
{`POST /v1/translate/session
Content-Type: application/json
Authorization: Bearer YOUR_API_KEY

{
  "sourceLanguage": "auto",
  "targetLanguage": "es",
  "mode": "realtime",
  "webhookUrl": "https://your-app.com/webhook"
}`}
            </pre>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Webhook Payload</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="bg-muted p-4 rounded-lg text-xs overflow-x-auto">
{`{
  "event": "translation.complete",
  "sessionId": "sess_abc123",
  "data": {
    "original": "Hello, how are you?",
    "translated": "Hola, como estas?",
    "confidence": 0.98
  }
}`}
            </pre>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function ClaudeAISection() {
  const [status, setStatus] = useState<any>(null);
  const [isChecking, setIsChecking] = useState(true);
  const [agentLog, setAgentLog] = useState<any[]>([]);
  const [isAgentRunning, setIsAgentRunning] = useState(false);
  const [agentMeta, setAgentMeta] = useState<any>(null);
  const [availableActions, setAvailableActions] = useState<any[]>([]);
  const [expandedEntry, setExpandedEntry] = useState<string | null>(null);
  const [manualActionRunning, setManualActionRunning] = useState<string | null>(null);
  const [manualActionResult, setManualActionResult] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<"agent" | "manual" | "prompt" | "reports">("agent");
  const [reports, setReports] = useState<any[]>([]);
  const [reportsUnread, setReportsUnread] = useState(0);
  const [reportsFilter, setReportsFilter] = useState("all");
  const [task, setTask] = useState("");
  const [model, setModel] = useState("haiku");
  const [promptResult, setPromptResult] = useState<any>(null);
  const [isPromptRunning, setIsPromptRunning] = useState(false);

  const getAdminCode = () => {
    let code = sessionStorage.getItem("devPortalAccessCode") || "";
    if (!code) {
      const stored = localStorage.getItem("dev_portal_access");
      if (stored) { code = atob(stored); sessionStorage.setItem("devPortalAccessCode", code); }
    }
    return code;
  };

  const adminHeaders = () => ({ "Content-Type": "application/json", "x-admin-code": getAdminCode() });

  const fetchReports = async (filter?: string) => {
    try {
      const f = filter || reportsFilter;
      const res = await fetch(`/api/claude/reports?limit=50&filter=${f}&accessCode=${encodeURIComponent(getAdminCode())}`, { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setReports(data.reports || []);
        setReportsUnread(data.unread || 0);
      }
    } catch {}
  };

  const markReportsRead = async (ids?: string[]) => {
    try {
      const url = ids ? "/api/claude/reports/read" : "/api/claude/reports/read-all";
      const body = ids ? { reportIds: ids } : {};
      await fetch(url, { method: "POST", credentials: "include", headers: adminHeaders(), body: JSON.stringify(body) });
      fetchReports();
    } catch {}
  };

  useEffect(() => {
    checkStatus();
    fetchAgentLog();
    fetchActions();
    fetchReports();
  }, []);

  const checkStatus = async () => {
    setIsChecking(true);
    try {
      const res = await adminFetch("/api/claude/status");
      setStatus(await res.json());
    } catch { setStatus({ available: false, error: "Failed to connect" }); }
    setIsChecking(false);
  };

  const fetchAgentLog = async () => {
    try {
      const res = await fetch(`/api/claude/agent-log?limit=20&accessCode=${encodeURIComponent(getAdminCode())}`, { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setAgentLog(data.entries || []);
        setAgentMeta({ isRunning: data.isRunning, lastRun: data.lastRun, nextAutoRun: data.nextAutoRun, total: data.total });
      }
    } catch {}
  };

  const fetchActions = async () => {
    try {
      const res = await fetch(`/api/claude/agent-actions?accessCode=${encodeURIComponent(getAdminCode())}`, { credentials: "include" });
      if (res.ok) setAvailableActions(await res.json());
    } catch {}
  };

  const runAgent = async () => {
    setIsAgentRunning(true);
    try {
      const res = await fetch("/api/claude/agent-run", { method: "POST", credentials: "include", headers: adminHeaders(), body: JSON.stringify({}) });
      const data = await res.json();
      if (!data.error) {
        setAgentLog(prev => [data, ...prev].slice(0, 20));
        setExpandedEntry(data.id);
        fetchActions();
        fetchReports();
      }
    } catch {}
    setIsAgentRunning(false);
  };

  const runManualAction = async (actionId: string) => {
    setManualActionRunning(actionId);
    setManualActionResult(null);
    try {
      const res = await fetch(`/api/claude/agent-action/${actionId}`, { method: "POST", credentials: "include", headers: adminHeaders(), body: JSON.stringify({}) });
      const data = await res.json();
      setManualActionResult({ actionId, ...data });
      fetchActions();
    } catch (err: any) {
      setManualActionResult({ actionId, success: false, detail: err.message });
    }
    setManualActionRunning(null);
  };

  const runPrompt = async () => {
    if (!task.trim() || isPromptRunning) return;
    setIsPromptRunning(true);
    setPromptResult(null);
    try {
      const res = await fetch("/api/claude/run", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ task: task.trim(), model }) });
      setPromptResult(await res.json());
    } catch (err: any) { setPromptResult({ error: err.message }); }
    setIsPromptRunning(false);
  };

  const severityIcon = (s: string) => {
    if (s === "critical" || s === "high") return <AlertCircle className="w-3.5 h-3.5 text-red-500" />;
    if (s === "medium") return <TriangleAlert className="w-3.5 h-3.5 text-amber-500" />;
    if (s === "low") return <Info className="w-3.5 h-3.5 text-blue-500" />;
    return <CircleCheck className="w-3.5 h-3.5 text-emerald-500" />;
  };

  const severityColor = (s: string) => {
    if (s === "critical") return "bg-red-500/10 text-red-600 border-red-500/20";
    if (s === "high") return "bg-orange-500/10 text-orange-600 border-orange-500/20";
    if (s === "medium") return "bg-amber-500/10 text-amber-600 border-amber-500/20";
    if (s === "low") return "bg-blue-500/10 text-blue-600 border-blue-500/20";
    return "bg-emerald-500/10 text-emerald-600 border-emerald-500/20";
  };

  const scoreColor = (s: number) => {
    if (s >= 80) return "text-emerald-500";
    if (s >= 60) return "text-amber-500";
    return "text-red-500";
  };

  const categoryIcon = (c: string) => {
    if (c === "performance") return <Gauge className="w-3.5 h-3.5" />;
    if (c === "reliability") return <Activity className="w-3.5 h-3.5" />;
    if (c === "security") return <Shield className="w-3.5 h-3.5" />;
    if (c === "scalability") return <Server className="w-3.5 h-3.5" />;
    return <Wrench className="w-3.5 h-3.5" />;
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-bold mb-1" data-testid="heading-claude-agent">Claude Agent</h2>
        <p className="text-sm text-muted-foreground">Autonomous platform maintenance powered by Claude AI</p>
      </div>

      <Card data-testid="card-agent-status">
        <CardContent className="pt-4 pb-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              {isChecking ? (
                <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
              ) : status?.available ? (
                <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
              ) : (
                <div className="w-2.5 h-2.5 rounded-full bg-red-500" />
              )}
              <span className="text-sm font-medium" data-testid="text-agent-connection">
                {isChecking ? "Checking..." : status?.available ? "Agent Online" : "Agent Offline"}
              </span>
              {status?.model && <Badge variant="secondary" className="text-[10px]">{status.model}</Badge>}
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={checkStatus} disabled={isChecking} data-testid="button-recheck-agent">
                <RefreshCw className="w-3 h-3" />
              </Button>
              <Button size="sm" onClick={runAgent} disabled={isAgentRunning || !status?.available} data-testid="button-run-agent">
                {isAgentRunning ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Play className="w-3.5 h-3.5 mr-1.5" />}
                {isAgentRunning ? "Running..." : "Run Agent"}
              </Button>
            </div>
          </div>
          {agentMeta && (
            <div className="flex flex-wrap items-center gap-3 mt-2 text-[11px] text-muted-foreground">
              {agentMeta.lastRun > 0 && <span>Last run: {new Date(agentMeta.lastRun).toLocaleTimeString()}</span>}
              {agentMeta.nextAutoRun > 0 && <span>Next auto: {new Date(agentMeta.nextAutoRun).toLocaleTimeString()}</span>}
              <span>Total runs: {agentMeta.total}</span>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex gap-1 p-0.5 bg-muted rounded-lg">
        {[
          { id: "agent" as const, label: "Agent Log", icon: Bot },
          { id: "reports" as const, label: "Reports", icon: reportsUnread > 0 ? BellDot : Bell },
          { id: "manual" as const, label: "Actions", icon: Wrench },
          { id: "prompt" as const, label: "Prompt", icon: Send },
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => { setActiveTab(tab.id); if (tab.id === "reports") fetchReports(); }}
            data-testid={`tab-${tab.id}`}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-md text-xs font-medium transition-colors ${
              activeTab === tab.id ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <tab.icon className="w-3.5 h-3.5" />
            <span>{tab.label}</span>
            {tab.id === "reports" && reportsUnread > 0 && (
              <span className="ml-0.5 min-w-[16px] h-4 flex items-center justify-center rounded-full bg-red-500 text-white text-[9px] font-bold px-1">{reportsUnread}</span>
            )}
          </button>
        ))}
      </div>

      {activeTab === "agent" && (
        <div className="space-y-3">
          {agentLog.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                <Bot className="w-10 h-10 mx-auto mb-3 opacity-30" />
                <p className="text-sm font-medium">No agent runs yet</p>
                <p className="text-xs mt-1">Click "Run Agent" to start the first autonomous maintenance cycle</p>
              </CardContent>
            </Card>
          ) : (
            agentLog.map((entry) => {
              const isExpanded = expandedEntry === entry.id;
              const successActions = entry.actionsExecuted?.filter((a: any) => a.result.success).length || 0;
              const totalActions = entry.actionsExecuted?.length || 0;
              return (
                <Card key={entry.id} data-testid={`card-agent-run-${entry.id}`} className="overflow-hidden">
                  <button
                    className="w-full text-left p-4 hover:bg-muted/30 transition-colors"
                    onClick={() => setExpandedEntry(isExpanded ? null : entry.id)}
                    data-testid={`button-expand-${entry.id}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className={`text-2xl font-bold ${scoreColor(entry.analysis?.score || 0)}`} data-testid={`text-score-${entry.id}`}>
                          {entry.analysis?.score ?? "?"}
                        </span>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <Badge variant={entry.trigger === "auto" ? "secondary" : "default"} className="text-[10px]">
                              {entry.trigger === "auto" ? "AUTO" : "MANUAL"}
                            </Badge>
                            {totalActions > 0 && (
                              <Badge variant="outline" className="text-[10px] gap-1">
                                <Wrench className="w-2.5 h-2.5" />
                                {successActions}/{totalActions}
                              </Badge>
                            )}
                            <span className="text-[10px] text-muted-foreground">{entry.totalDurationMs}ms</span>
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5 truncate max-w-[280px]">
                            {new Date(entry.timestamp).toLocaleString()}
                          </p>
                        </div>
                      </div>
                      {isExpanded ? <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" /> : <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />}
                    </div>
                  </button>

                  {isExpanded && (
                    <div className="px-4 pb-4 space-y-3 border-t pt-3">
                      <p className="text-sm" data-testid={`text-summary-${entry.id}`}>{entry.analysis?.summary}</p>

                      {entry.analysis?.metrics && (
                        <div className="grid grid-cols-5 gap-1.5">
                          {Object.entries(entry.analysis.metrics).map(([key, val]) => (
                            <div key={key} className="text-center p-1.5 rounded bg-muted/50">
                              <p className={`text-sm font-bold ${scoreColor(val as number)}`}>{val as number}</p>
                              <p className="text-[9px] text-muted-foreground capitalize">{key}</p>
                            </div>
                          ))}
                        </div>
                      )}

                      {entry.actionsExecuted && entry.actionsExecuted.length > 0 && (
                        <div>
                          <p className="text-xs font-semibold mb-2 flex items-center gap-1.5">
                            <Wrench className="w-3.5 h-3.5" /> Actions Executed
                          </p>
                          <div className="space-y-2">
                            {entry.actionsExecuted.map((action: any, i: number) => (
                              <div key={i} className={`p-2.5 rounded-lg border text-xs ${action.result.success ? "bg-emerald-500/5 border-emerald-500/20" : "bg-red-500/5 border-red-500/20"}`} data-testid={`action-result-${action.actionId}`}>
                                <div className="flex items-center gap-1.5 mb-1">
                                  {action.result.success ? <CircleCheck className="w-3.5 h-3.5 text-emerald-500" /> : <AlertCircle className="w-3.5 h-3.5 text-red-500" />}
                                  <span className="font-medium">{action.actionName}</span>
                                  <span className="text-muted-foreground ml-auto">{action.durationMs}ms</span>
                                </div>
                                <p className="text-muted-foreground">{action.reason}</p>
                                <p className={`mt-1 ${action.result.success ? "text-emerald-600" : "text-red-600"}`}>{action.result.detail}</p>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {entry.analysis?.findings && entry.analysis.findings.length > 0 && (
                        <div>
                          <p className="text-xs font-semibold mb-2 flex items-center gap-1.5">
                            <Eye className="w-3.5 h-3.5" /> Findings
                          </p>
                          <div className="space-y-1.5">
                            {entry.analysis.findings.map((f: any, i: number) => (
                              <div key={i} className={`p-2 rounded border text-xs ${severityColor(f.severity)}`} data-testid={`finding-${f.id || i}`}>
                                <div className="flex items-center gap-1.5">
                                  {severityIcon(f.severity)}
                                  <span className="font-medium">{f.title}</span>
                                  <Badge variant="outline" className="text-[9px] ml-auto gap-0.5 py-0">
                                    {categoryIcon(f.category)}
                                    {f.category}
                                  </Badge>
                                </div>
                                <p className="mt-1 opacity-80">{f.description}</p>
                                {f.autoFixable && (
                                  <div className="flex items-center gap-1 mt-1 text-[10px] opacity-60">
                                    <Wrench className="w-2.5 h-2.5" /> Auto-fixable
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </Card>
              );
            })
          )}
        </div>
      )}

      {activeTab === "reports" && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex gap-1">
              {[
                { value: "all", label: "All" },
                { value: "unread", label: "Unread" },
                { value: "critical", label: "Critical" },
                { value: "error", label: "Errors" },
                { value: "warning", label: "Warnings" },
              ].map(f => (
                <button
                  key={f.value}
                  onClick={() => { setReportsFilter(f.value); fetchReports(f.value); }}
                  data-testid={`button-filter-${f.value}`}
                  className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${
                    reportsFilter === f.value
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
            {reportsUnread > 0 && (
              <Button variant="ghost" size="sm" className="h-7 text-[11px] gap-1" onClick={() => markReportsRead()} data-testid="button-mark-all-read">
                <CheckCheck className="w-3 h-3" />
                Mark all read
              </Button>
            )}
          </div>

          {reports.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                <Bell className="w-10 h-10 mx-auto mb-3 opacity-30" />
                <p className="text-sm font-medium">No reports yet</p>
                <p className="text-xs mt-1">Reports will appear here after agent runs complete</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {reports.map((report) => {
                const typeConfig: Record<string, { border: string; bg: string; icon: any; dot: string; text: string }> = {
                  critical: { border: "border-red-500/40", bg: "bg-red-500/10", icon: <AlertCircle className="w-4 h-4 text-red-500" />, dot: "bg-red-500", text: "text-red-400" },
                  error: { border: "border-orange-500/30", bg: "bg-orange-500/8", icon: <AlertCircle className="w-4 h-4 text-orange-500" />, dot: "bg-orange-500", text: "text-orange-400" },
                  warning: { border: "border-amber-500/30", bg: "bg-amber-500/8", icon: <TriangleAlert className="w-4 h-4 text-amber-500" />, dot: "bg-amber-500", text: "text-amber-400" },
                  success: { border: "border-emerald-500/30", bg: "bg-emerald-500/8", icon: <CircleCheck className="w-4 h-4 text-emerald-500" />, dot: "bg-emerald-500", text: "text-emerald-400" },
                  info: { border: "border-blue-500/30", bg: "bg-blue-500/8", icon: <Info className="w-4 h-4 text-blue-500" />, dot: "bg-blue-500", text: "text-blue-400" },
                };
                const cfg = typeConfig[report.type] || typeConfig.info;
                const catLabels: Record<string, string> = {
                  agent_run: "Agent Run",
                  action: "Action",
                  finding: "Finding",
                  service: "Service",
                  security: "Security",
                  performance: "Performance",
                };

                return (
                  <div
                    key={report.id}
                    data-testid={`report-${report.id}`}
                    className={`relative rounded-lg border p-3 transition-all ${cfg.border} ${cfg.bg} ${!report.read ? "ring-1 ring-offset-0" : "opacity-80"}`}
                    style={!report.read ? { "--tw-ring-color": cfg.dot === "bg-red-500" ? "rgba(239,68,68,0.3)" : "rgba(148,163,184,0.15)" } as React.CSSProperties : undefined}
                  >
                    {!report.read && (
                      <div className={`absolute top-3 right-3 w-2 h-2 rounded-full ${cfg.dot} animate-pulse`} />
                    )}
                    <div className="flex items-start gap-2.5">
                      <div className="mt-0.5 shrink-0">{cfg.icon}</div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 flex-wrap mb-1">
                          <span className={`text-xs font-semibold ${cfg.text}`} data-testid={`report-title-${report.id}`}>{report.title}</span>
                          <Badge variant="outline" className="text-[9px] py-0 h-4">{catLabels[report.category] || report.category}</Badge>
                        </div>
                        <p className="text-xs text-muted-foreground leading-relaxed" data-testid={`report-message-${report.id}`}>{report.message}</p>
                        <div className="flex items-center gap-2 mt-1.5">
                          <span className="text-[10px] text-muted-foreground/60">
                            {new Date(report.timestamp).toLocaleString()}
                          </span>
                          {!report.read && (
                            <button
                              onClick={() => markReportsRead([report.id])}
                              className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                              data-testid={`button-read-${report.id}`}
                            >
                              Mark read
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {activeTab === "manual" && (
        <div className="space-y-3">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Wrench className="w-4 h-4" />
                Available Maintenance Actions
              </CardTitle>
              <CardDescription className="text-xs">Execute individual actions manually or let the agent decide</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {availableActions.map((action) => (
                <div key={action.id} className="flex items-center justify-between gap-3 p-2.5 rounded-lg border bg-muted/30" data-testid={`action-${action.id}`}>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      {categoryIcon(action.category)}
                      <span className="text-xs font-medium">{action.name}</span>
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{action.description}</p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => runManualAction(action.id)}
                    disabled={manualActionRunning === action.id}
                    data-testid={`button-action-${action.id}`}
                    className="shrink-0 text-xs h-7 px-2.5"
                  >
                    {manualActionRunning === action.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
                  </Button>
                </div>
              ))}
            </CardContent>
          </Card>

          {manualActionResult && (
            <Card data-testid="card-manual-result">
              <CardContent className="pt-4 pb-3">
                <div className={`p-3 rounded-lg border text-sm ${manualActionResult.success ? "bg-emerald-500/5 border-emerald-500/20" : "bg-red-500/5 border-red-500/20"}`}>
                  <div className="flex items-center gap-2 mb-1">
                    {manualActionResult.success ? <CircleCheck className="w-4 h-4 text-emerald-500" /> : <AlertCircle className="w-4 h-4 text-red-500" />}
                    <span className="font-medium text-xs">{manualActionResult.actionName || manualActionResult.actionId}</span>
                    {manualActionResult.durationMs && <span className="text-[10px] text-muted-foreground ml-auto">{manualActionResult.durationMs}ms</span>}
                  </div>
                  <p className="text-xs">{manualActionResult.detail}</p>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {activeTab === "prompt" && (
        <Card data-testid="card-claude-runner">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Send className="w-4 h-4" />
              Task Runner
            </CardTitle>
            <CardDescription className="text-xs">Send a custom prompt to Claude</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Select value={model} onValueChange={setModel}>
              <SelectTrigger data-testid="select-claude-model" className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="haiku">Haiku (Fast)</SelectItem>
                <SelectItem value="sonnet">Sonnet (Balanced)</SelectItem>
                <SelectItem value="opus">Opus (Most Capable)</SelectItem>
              </SelectContent>
            </Select>
            <Textarea
              value={task}
              onChange={(e) => setTask(e.target.value)}
              placeholder="Describe your task..."
              className="min-h-[80px] resize-none text-sm"
              data-testid="textarea-claude-task"
            />
            <Button onClick={runPrompt} disabled={!task.trim() || isPromptRunning || !status?.available} className="w-full h-8 text-xs" data-testid="button-run-claude">
              {isPromptRunning ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Zap className="w-3.5 h-3.5 mr-1.5" />}
              {isPromptRunning ? "Running..." : "Run"}
            </Button>
            {promptResult && (
              <div data-testid="claude-result">
                {promptResult.error ? (
                  <div className="p-2.5 bg-destructive/10 border border-destructive/20 rounded-lg">
                    <p className="text-xs text-destructive">{promptResult.error}</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary" className="text-[10px]">{promptResult.model}</Badge>
                      <span className="text-[10px] text-muted-foreground">{promptResult.durationMs}ms</span>
                      <Button variant="ghost" size="icon" className="h-6 w-6 ml-auto" onClick={() => promptResult.result && navigator.clipboard.writeText(promptResult.result)} data-testid="button-copy-result">
                        <Copy className="w-3 h-3" />
                      </Button>
                    </div>
                    <div className="p-2.5 bg-muted rounded-lg">
                      <pre className="text-xs whitespace-pre-wrap break-words" data-testid="text-claude-result">{promptResult.result}</pre>
                    </div>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function ApiKeysSection() {
  const [serviceStatus, setServiceStatus] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const checkServices = async () => {
      try {
        const res = await adminFetch("/api/service-status");
        if (res.ok) {
          const data = await res.json();
          setServiceStatus(data);
        }
      } catch (err) {
        console.error("Failed to check service status:", err);
      } finally {
        setIsLoading(false);
      }
    };
    checkServices();
  }, []);

  const services = [
    { id: "libretranslate", name: "LibreTranslate", description: "Primary translation service", envKey: "LIBRETRANSLATE_API_KEY" },
    { id: "moonshot", name: "Moonshot AI (Kimi K2.5)", description: "Secondary translation, caption cleanup, call summaries", envKey: "MOONSHOT_API_KEY" },
    { id: "gemini", name: "Gemini API", description: "Translation via Google Gemini Flash", envKey: "GOOGLE_API_KEY" },
    { id: "anthropic", name: "Anthropic (Claude)", description: "AI chat, health analysis, translation fallback", envKey: "ANTHROPIC_API_KEY" },
    { id: "openai", name: "OpenAI API", description: "Speech-to-text transcription and final fallback", envKey: "OPENAI_API_KEY" },
    { id: "database", name: "PostgreSQL Database", description: "Primary data storage", envKey: "DATABASE_URL" },
    { id: "session", name: "Session Secret", description: "Session encryption key", envKey: "SESSION_SECRET" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-2">API Configuration</h2>
        <p className="text-muted-foreground">Service credentials and connection status</p>
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="space-y-4">
            {services.map((service) => {
              const status = serviceStatus[service.id];
              const isConfigured = status === "configured";
              return (
                <div key={service.id} className="flex flex-wrap items-center justify-between gap-4 p-4 bg-muted rounded-lg" data-testid={`service-status-${service.id}`}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <Key className="w-4 h-4 text-muted-foreground" />
                      <span className="font-medium">{service.name}</span>
                    </div>
                    <p className="text-sm text-muted-foreground">{service.description}</p>
                    <code className="text-xs text-muted-foreground mt-1 block">{service.envKey}</code>
                  </div>
                  <Badge variant={isConfigured ? "default" : "secondary"} data-testid={`badge-service-${service.id}`}>
                    {isLoading ? "Checking..." : isConfigured ? "Configured" : "Not Set"}
                  </Badge>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Service Capabilities</CardTitle>
          <CardDescription>Features enabled by configured services</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {[
              { name: "Speech-to-Text", requires: "OpenAI" },
              { name: "Translation", requires: "LibreTranslate → Kimi → Gemini → Claude" },
              { name: "AI Support Chat", requires: "Kimi / Claude" },
              { name: "Caption Cleanup", requires: "Kimi → Claude" },
              { name: "Call Summary", requires: "Kimi → Claude → OpenAI" },
              { name: "Session Auth", requires: "Session Secret" },
            ].map((cap, i) => (
              <div key={cap.name} className="flex flex-wrap items-center justify-between gap-2 p-3 bg-muted rounded-lg" data-testid={`capability-${i}`}>
                <div>
                  <span className="text-sm font-medium">{cap.name}</span>
                  <p className="text-xs text-muted-foreground">Requires: {cap.requires}</p>
                </div>
                <Badge variant="outline">Active</Badge>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function CookiesMonitor() {
  const [cookieData, setCookieData] = useState<any>(null);
  const [clientCookies, setClientCookies] = useState<{ name: string; value: string }[]>([]);
  const [localStorageItems, setLocalStorageItems] = useState<{ key: string; hasValue: boolean }[]>([]);
  const [sessionStorageItems, setSessionStorageItems] = useState<{ key: string; hasValue: boolean }[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<number>(Date.now());

  const fetchCookieInfo = async () => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/cookies-info", { credentials: "include" });
      if (res.ok) {
        setCookieData(await res.json());
      }
    } catch (err) {
      console.error("Failed to fetch cookie info:", err);
    }
    setIsLoading(false);
    setLastRefresh(Date.now());
  };

  const scanClientCookies = () => {
    const raw = document.cookie;
    if (!raw) {
      setClientCookies([]);
    } else {
      const parsed = raw.split(";").map(c => c.trim()).filter(Boolean).map(c => {
        const eqIdx = c.indexOf("=");
        if (eqIdx === -1) return { name: c, value: "" };
        return { name: c.substring(0, eqIdx).trim(), value: c.substring(eqIdx + 1).substring(0, 20) + "..." };
      });
      setClientCookies(parsed);
    }

    const knownLsKeys = [STORAGE_KEYS.uiLang, STORAGE_KEYS.legacyTheme, "dev_portal_access", STORAGE_KEYS.onboardingDone, "theme"];
    const lsItems: { key: string; hasValue: boolean }[] = [];
    knownLsKeys.forEach(k => {
      try {
        const val = localStorage.getItem(k);
        if (val !== null) lsItems.push({ key: k, hasValue: true });
      } catch {}
    });
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && !knownLsKeys.includes(k)) {
        lsItems.push({ key: k, hasValue: true });
      }
    }
    setLocalStorageItems(lsItems);

    const knownSsKeys = ["devPortalAccessCode"];
    const ssItems: { key: string; hasValue: boolean }[] = [];
    knownSsKeys.forEach(k => {
      try {
        const val = sessionStorage.getItem(k);
        if (val !== null) ssItems.push({ key: k, hasValue: true });
      } catch {}
    });
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k && !knownSsKeys.includes(k)) {
        ssItems.push({ key: k, hasValue: true });
      }
    }
    setSessionStorageItems(ssItems);
  };

  useEffect(() => {
    fetchCookieInfo();
    scanClientCookies();
  }, []);

  const categoryColors: Record<string, string> = {
    session: "text-blue-700 dark:text-blue-400",
    advertising: "text-amber-600 dark:text-amber-400",
    analytics: "text-blue-600 dark:text-blue-400",
    "video-conferencing": "text-blue-600 dark:text-blue-400",
    unknown: "text-muted-foreground",
  };

  const categoryBadgeVariant = (cat: string): "default" | "secondary" | "destructive" | "outline" => {
    if (cat === "session") return "default";
    if (cat === "advertising") return "secondary";
    if (cat === "video-conferencing") return "secondary";
    return "outline";
  };

  const credStatusColor = (status: string) => {
    if (status === "active" || status === "configured") return "text-blue-700 dark:text-blue-400";
    if (status === "idle") return "text-amber-600 dark:text-amber-400";
    return "text-destructive";
  };

  const credStatusBadge = (status: string): "default" | "secondary" | "destructive" | "outline" => {
    if (status === "active" || status === "configured") return "default";
    if (status === "idle") return "secondary";
    return "destructive";
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-lg font-bold flex items-center gap-2">
            <Eye className="w-5 h-5" />
            Cookie &amp; Credential Monitor
          </h3>
          <p className="text-sm text-muted-foreground">Full visibility into cookies, credentials, and network connections</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => { fetchCookieInfo(); scanClientCookies(); }} disabled={isLoading} data-testid="button-refresh-cookies">
          <RefreshCw className={`w-4 h-4 mr-1 ${isLoading ? "animate-spin" : ""}`} />
          Scan
        </Button>
      </div>

      {isLoading && !cookieData ? (
        <div className="text-center py-8 text-muted-foreground">Scanning platform...</div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Card data-testid="card-cookie-total">
              <CardContent className="pt-4 pb-3">
                <div className="text-2xl font-bold" data-testid="text-total-cookies">
                  {cookieData?.totalCookies || 0}
                </div>
                <p className="text-xs text-muted-foreground">
                  Cookies Detected
                  {clientCookies.length > 0 && <span className="block text-[10px]">({clientCookies.length} JS-accessible)</span>}
                </p>
              </CardContent>
            </Card>
            <Card data-testid="card-services-total">
              <CardContent className="pt-4 pb-3">
                <div className="text-2xl font-bold text-blue-700 dark:text-blue-400" data-testid="text-total-services">
                  {cookieData?.networkCredentials?.filter((c: any) => c.status === "active" || c.status === "configured").length || 0}
                  <span className="text-sm font-normal text-muted-foreground">/{cookieData?.networkCredentials?.length || 0}</span>
                </div>
                <p className="text-xs text-muted-foreground">Services Connected</p>
              </CardContent>
            </Card>
          </div>

          {cookieData?.networkCredentials && (
            <Card data-testid="card-network-credentials">
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Key className="w-4 h-4" />
                  Network Credentials &amp; Services
                </CardTitle>
                <CardDescription className="text-xs">All credentials connecting platform features to the network</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {cookieData.networkCredentials.map((cred: any, i: number) => (
                    <div key={i} className="p-3 rounded-lg bg-muted/50 space-y-2" data-testid={`network-cred-${i}`}>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-sm font-medium">{cred.service}</span>
                        <Badge variant={credStatusBadge(cred.status)} className="text-[10px] capitalize">{cred.status === "not_configured" ? "Not Set" : cred.status}</Badge>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <Badge variant="outline" className="text-[10px]">{cred.type}</Badge>
                        <span className="font-mono text-[10px]">{cred.credential}</span>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {cred.features?.map((f: string, fi: number) => (
                          <Badge key={fi} variant="secondary" className="text-[10px]">{f}</Badge>
                        ))}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {cred.security?.httpOnly !== undefined && (
                          <Badge variant={cred.security.httpOnly ? "default" : "outline"} className="text-[10px]">
                            {cred.security.httpOnly ? "Server-Only" : "Client-Exposed"}
                          </Badge>
                        )}
                        {cred.security?.secure !== undefined && (
                          <Badge variant={cred.security.secure ? "default" : "destructive"} className="text-[10px]">
                            {cred.security.secure ? "Encrypted" : "Unencrypted"}
                          </Badge>
                        )}
                      </div>
                      {cred.liveStats && (
                        <div className="flex flex-wrap gap-3 text-[10px] text-muted-foreground pt-1 border-t">
                          <span>Connections: <strong className={credStatusColor(cred.status)}>{cred.liveStats.activeConnections}</strong></span>
                          <span>Rooms: <strong>{cred.liveStats.activeRooms}</strong></span>
                          <span>Users in rooms: <strong>{cred.liveStats.usersInRooms}</strong></span>
                        </div>
                      )}
                      {cred.note && (
                        <p className="text-[10px] text-muted-foreground">{cred.note}</p>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {cookieData?.categories && (
            <Card data-testid="card-cookie-categories">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Cookie Categories</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {Object.entries(cookieData.categories).map(([cat, count]: [string, any]) => (
                    <div key={cat} className="flex flex-wrap items-center justify-between gap-2 p-2 rounded-md bg-muted/50" data-testid={`cookie-category-${cat}`}>
                      <div className="flex items-center gap-2">
                        <CircleDot className={`w-3 h-3 ${categoryColors[cat] || "text-muted-foreground"}`} />
                        <span className="text-sm font-medium capitalize">{cat.replace("-", " ")}</span>
                      </div>
                      <Badge variant={categoryBadgeVariant(cat)} className="text-xs">{count}</Badge>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {cookieData?.activeCookies?.length > 0 && (
            <Card data-testid="card-server-cookies">
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Lock className="w-4 h-4" />
                  Server-Side Cookies
                </CardTitle>
                <CardDescription className="text-xs">Cookies detected in server requests (includes httpOnly)</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {cookieData.activeCookies.map((cookie: any, i: number) => (
                    <div key={i} className="p-3 rounded-lg bg-muted/50 space-y-2" data-testid={`server-cookie-${i}`}>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-mono text-sm font-medium break-all">{cookie.name}</span>
                        <Badge variant={categoryBadgeVariant(cookie.category)} className="text-xs capitalize">{cookie.category}</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">{cookie.purpose}</p>
                      <div className="flex flex-wrap gap-2">
                        <Badge variant={cookie.httpOnly ? "default" : "destructive"} className="text-[10px]">
                          {cookie.httpOnly ? "HttpOnly" : "No HttpOnly"}
                        </Badge>
                        <Badge variant={cookie.secure ? "default" : "destructive"} className="text-[10px]">
                          {cookie.secure ? "Secure" : "Not Secure"}
                        </Badge>
                        <Badge variant="outline" className="text-[10px]">
                          SameSite: {cookie.sameSite}
                        </Badge>
                        {cookie.essential && (
                          <Badge variant="outline" className="text-[10px] text-blue-700 dark:text-blue-400">
                            Essential
                          </Badge>
                        )}
                      </div>
                      {cookie.usedBy?.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {cookie.usedBy.map((feature: string, fi: number) => (
                            <Badge key={fi} variant="secondary" className="text-[10px]">{feature}</Badge>
                          ))}
                        </div>
                      )}
                      {cookie.duration && cookie.duration !== "unknown" && (
                        <p className="text-[10px] text-muted-foreground">Duration: {cookie.duration}</p>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {clientCookies.length > 0 && (
            <Card data-testid="card-client-cookies">
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Globe className="w-4 h-4" />
                  Client-Side Cookies
                </CardTitle>
                <CardDescription className="text-xs">Cookies readable by JavaScript (document.cookie)</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {clientCookies.map((cookie, i) => (
                    <div key={i} className="flex flex-wrap items-center justify-between gap-2 p-2 rounded-md bg-muted/50" data-testid={`client-cookie-${i}`}>
                      <span className="font-mono text-xs break-all">{cookie.name}</span>
                      <Badge variant="outline" className="text-[10px]">JS-accessible</Badge>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {clientCookies.length === 0 && (!cookieData?.activeCookies || cookieData.activeCookies.length <= 1) && (
            <Card data-testid="card-no-extra-cookies">
              <CardContent className="pt-6 text-center">
                <Shield className="w-8 h-8 mx-auto mb-2 text-blue-600 dark:text-blue-400" />
                <p className="font-medium text-sm">No Third-Party Cookies Detected</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Only the essential session cookie is active. Ad/video cookies may appear on the published site.
                </p>
              </CardContent>
            </Card>
          )}

          {(localStorageItems.length > 0 || sessionStorageItems.length > 0) && (
            <Card data-testid="card-browser-storage">
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Database className="w-4 h-4" />
                  Browser Storage
                </CardTitle>
                <CardDescription className="text-xs">localStorage and sessionStorage data used by the platform</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {localStorageItems.length > 0 && (
                    <div>
                      <p className="text-xs font-medium mb-2 text-muted-foreground uppercase tracking-wide">localStorage</p>
                      <div className="space-y-1">
                        {localStorageItems.map((item, i) => {
                          const knownInfo = cookieData?.localStorageKeys?.find((k: any) => k.key === item.key);
                          return (
                            <div key={i} className="flex flex-wrap items-center justify-between gap-2 p-2 rounded-md bg-muted/50" data-testid={`ls-item-${i}`}>
                              <div className="min-w-0">
                                <span className="font-mono text-xs block break-all">{item.key}</span>
                                {knownInfo && <span className="text-[10px] text-muted-foreground">{knownInfo.purpose}</span>}
                              </div>
                              <div className="flex items-center gap-1">
                                {knownInfo?.sensitive && <Badge variant="destructive" className="text-[10px]">Sensitive</Badge>}
                                <Badge variant="outline" className="text-[10px]">Persistent</Badge>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  {sessionStorageItems.length > 0 && (
                    <div>
                      <p className="text-xs font-medium mb-2 text-muted-foreground uppercase tracking-wide">sessionStorage</p>
                      <div className="space-y-1">
                        {sessionStorageItems.map((item, i) => {
                          const knownInfo = cookieData?.sessionStorageKeys?.find((k: any) => k.key === item.key);
                          return (
                            <div key={i} className="flex flex-wrap items-center justify-between gap-2 p-2 rounded-md bg-muted/50" data-testid={`ss-item-${i}`}>
                              <div className="min-w-0">
                                <span className="font-mono text-xs block break-all">{item.key}</span>
                                {knownInfo && <span className="text-[10px] text-muted-foreground">{knownInfo.purpose}</span>}
                              </div>
                              <div className="flex items-center gap-1">
                                {knownInfo?.sensitive && <Badge variant="destructive" className="text-[10px]">Sensitive</Badge>}
                                <Badge variant="secondary" className="text-[10px]">Session Only</Badge>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {cookieData?.thirdPartyDomains && (
            <Card data-testid="card-third-party-domains">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Third-Party Network Domains</CardTitle>
                <CardDescription className="text-xs">External domains allowed by CSP that connect to the platform</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {cookieData.thirdPartyDomains.map((d: any, i: number) => (
                    <div key={i} className="p-2 rounded-md bg-muted/50 space-y-1" data-testid={`third-party-${i}`}>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="min-w-0">
                          <span className="font-mono text-xs block break-all">{d.domain}</span>
                          <span className="text-[10px] text-muted-foreground">{d.service}</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <Badge variant="outline" className="text-[10px] capitalize">{d.type.replace("-", " ")}</Badge>
                          {d.cookiesLikely && (
                            <Badge variant="secondary" className="text-[10px]">Sets cookies</Badge>
                          )}
                        </div>
                      </div>
                      {d.features?.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {d.features.map((f: string, fi: number) => (
                            <Badge key={fi} variant="secondary" className="text-[10px]">{f}</Badge>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {cookieData?.serverConfig && (
            <Card data-testid="card-security-config">
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Shield className="w-4 h-4" />
                  Security Configuration
                </CardTitle>
                <CardDescription className="text-xs">Server-side cookie and header security settings</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div className="p-3 rounded-lg bg-muted/50" data-testid="config-session-cookie">
                    <p className="text-sm font-medium mb-2">Session Cookie Configuration</p>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <span className="text-muted-foreground">Name:</span>
                      <span className="font-mono">{cookieData.serverConfig.sessionCookie.name}</span>
                      <span className="text-muted-foreground">HttpOnly:</span>
                      <Badge variant={cookieData.serverConfig.sessionCookie.httpOnly ? "default" : "destructive"} className="text-[10px] w-fit">
                        {cookieData.serverConfig.sessionCookie.httpOnly ? "Yes" : "No"}
                      </Badge>
                      <span className="text-muted-foreground">Secure:</span>
                      <Badge variant={cookieData.serverConfig.sessionCookie.secure ? "default" : "destructive"} className="text-[10px] w-fit">
                        {cookieData.serverConfig.sessionCookie.secure ? "Yes" : "No"}
                      </Badge>
                      <span className="text-muted-foreground">Rolling:</span>
                      <span>{cookieData.serverConfig.sessionCookie.rolling ? "Yes" : "No"}</span>
                      <span className="text-muted-foreground">TTL:</span>
                      <span>{cookieData.serverConfig.sessionCookie.ttl}</span>
                      <span className="text-muted-foreground">MaxAge:</span>
                      <span>{cookieData.serverConfig.sessionCookie.maxAge}</span>
                      <span className="text-muted-foreground">Store:</span>
                      <span>{cookieData.serverConfig.sessionCookie.store}</span>
                    </div>
                  </div>

                  <div className="p-3 rounded-lg bg-muted/50" data-testid="config-security-headers">
                    <p className="text-sm font-medium mb-2">Security Headers</p>
                    <div className="space-y-1">
                      {Object.entries(cookieData.serverConfig.securityHeaders).map(([key, value]: [string, any]) => (
                        <div key={key} className="flex flex-wrap items-start justify-between gap-2 text-xs">
                          <span className="text-muted-foreground capitalize">{key.replace(/([A-Z])/g, " $1").trim()}:</span>
                          <span className="font-mono text-right break-all max-w-[60%]">{value}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          <p className="text-[10px] text-muted-foreground text-center">
            Last scanned: {new Date(lastRefresh).toLocaleTimeString()}
          </p>
        </>
      )}
    </div>
  );
}

function SecurityMonitoringToggle() {
  const [enabled, setEnabled] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const getAccessCode = () => {
    let accessCode = sessionStorage.getItem("devPortalAccessCode") || "";
    if (!accessCode) {
      const storedCode = localStorage.getItem("dev_portal_access");
      if (storedCode) {
        accessCode = atob(storedCode);
        sessionStorage.setItem("devPortalAccessCode", accessCode);
      }
    }
    return accessCode;
  };

  useEffect(() => {
    fetch("/api/feature/security-monitoring")
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) setEnabled(data.enabled); })
      .catch(() => {})
      .finally(() => setIsLoading(false));
  }, []);

  const handleToggle = async () => {
    if (isSaving) return;
    setIsSaving(true);
    try {
      const res = await apiRequest("POST", "/api/feature/security-monitoring", {
        enabled: !enabled,
        accessCode: getAccessCode(),
      });
      const data = await res.json();
      setEnabled(data.enabled);
    } catch (err) {
      console.error("Failed to toggle security monitoring:", err);
    }
    setIsSaving(false);
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-4 p-4 bg-muted rounded-lg" data-testid="setting-security-monitoring">
      <div>
        <p className="font-medium">Security Monitoring</p>
        <p className="text-sm text-muted-foreground">
          {enabled
            ? "Active. Login activity is being tracked (device, IP, browser)"
            : "Disabled. Enable to start tracking login activity for all users"}
        </p>
        {enabled && (
          <span className="inline-flex items-center gap-1 mt-1.5 px-2 py-0.5 rounded-full text-xs font-semibold bg-green-500/15 text-green-600 dark:text-green-400" data-testid="badge-security-monitoring-live">
            Security Monitoring Active
          </span>
        )}
      </div>
      {isLoading ? (
        <Badge variant="secondary">Loading...</Badge>
      ) : (
        <button
          onClick={handleToggle}
          disabled={isSaving}
          className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
            enabled ? "bg-primary" : "bg-input"
          }`}
          data-testid="toggle-security-monitoring"
        >
          <span
            className={`inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${
              enabled ? "translate-x-6" : "translate-x-1"
            }`}
          />
        </button>
      )}
    </div>
  );
}

function LoginActivityPanel() {
  const [activity, setActivity] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const getAccessCode = () => {
    let accessCode = sessionStorage.getItem("devPortalAccessCode") || "";
    if (!accessCode) {
      const storedCode = localStorage.getItem("dev_portal_access");
      if (storedCode) {
        accessCode = atob(storedCode);
        sessionStorage.setItem("devPortalAccessCode", accessCode);
      }
    }
    return accessCode;
  };

  const fetchActivity = () => {
    setIsLoading(true);
    apiRequest("POST", "/api/security/login-activity/all", {
      accessCode: getAccessCode(),
    })
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data?.activity) setActivity(data.activity); })
      .catch(() => {})
      .finally(() => setIsLoading(false));
  };

  useEffect(() => { fetchActivity(); }, []);

  const handleFlag = async (id: string, flagged: boolean) => {
    try {
      await apiRequest("POST", "/api/security/login-activity/flag", {
        id,
        flagged,
        accessCode: getAccessCode(),
      });
      setActivity(prev => prev.map(a => a.id === id ? { ...a, flagged } : a));
    } catch (err) {
      console.error("Failed to flag login:", err);
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          <Shield className="h-5 w-5" />
          Login Activity Log
        </CardTitle>
        <button onClick={fetchActivity} className="text-sm text-muted-foreground hover:text-foreground" data-testid="button-refresh-login-activity">
          Refresh
        </button>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading login activity...</p>
        ) : activity.length === 0 ? (
          <p className="text-sm text-muted-foreground">No login activity recorded yet. Activity will appear here once security monitoring is enabled and users log in.</p>
        ) : (
          <div className="space-y-2 max-h-[400px] overflow-y-auto">
            {activity.map((entry) => (
              <div
                key={entry.id}
                className={`flex flex-wrap items-center justify-between gap-3 p-3 rounded-lg text-sm ${
                  entry.flagged ? "bg-red-500/10 border border-red-500/30" : "bg-muted"
                }`}
                data-testid={`login-activity-${entry.id}`}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium">{entry.username || "Unknown"}</span>
                    <Badge variant="secondary" className="text-xs">{entry.deviceType || "Unknown"}</Badge>
                    <Badge variant="secondary" className="text-xs">{entry.browser || "Unknown"}</Badge>
                    {entry.flagged && <Badge variant="destructive" className="text-xs">Flagged</Badge>}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    IP: {entry.ipAddress || "N/A"} · {entry.createdAt ? new Date(entry.createdAt).toLocaleString() : "Unknown time"}
                  </p>
                </div>
                <button
                  onClick={() => handleFlag(entry.id, !entry.flagged)}
                  className={`text-xs px-2 py-1 rounded ${
                    entry.flagged
                      ? "bg-muted hover:bg-muted/80 text-foreground"
                      : "bg-red-500/10 hover:bg-red-500/20 text-red-500"
                  }`}
                  data-testid={`button-flag-login-${entry.id}`}
                >
                  {entry.flagged ? "Unflag" : "Flag Suspicious"}
                </button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function EarningFeatureToggle() {
  const [enabled, setEnabled] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const getAccessCode = () => {
    let accessCode = sessionStorage.getItem("devPortalAccessCode") || "";
    if (!accessCode) {
      const storedCode = localStorage.getItem("dev_portal_access");
      if (storedCode) {
        accessCode = atob(storedCode);
        sessionStorage.setItem("devPortalAccessCode", accessCode);
      }
    }
    return accessCode;
  };

  useEffect(() => {
    fetch("/api/feature/earning")
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) setEnabled(data.enabled); })
      .catch(() => {})
      .finally(() => setIsLoading(false));
  }, []);

  const handleToggle = async () => {
    if (isSaving) return;
    setIsSaving(true);
    try {
      const res = await apiRequest("POST", "/api/feature/earning", {
        enabled: !enabled,
        accessCode: getAccessCode(),
      });
      const data = await res.json();
      setEnabled(data.enabled);
    } catch (err) {
      console.error("Failed to toggle earning feature:", err);
    }
    setIsSaving(false);
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-4 p-4 bg-muted rounded-lg" data-testid="setting-earning-feature">
      <div>
        <p className="font-medium">Earning Hub</p>
        <p className="text-sm text-muted-foreground">
          {enabled
            ? "Live. Users see \"Earning Hub\" link with 4 partner categories"
            : "Teaser. Users see earning announcement"}
        </p>
        {enabled && (
          <span className="inline-flex items-center gap-1 mt-1.5 px-2 py-0.5 rounded-full text-xs font-semibold bg-green-500/15 text-green-600 dark:text-green-400" data-testid="badge-earning-hub-live">
            Earning Hub is now live
          </span>
        )}
      </div>
      {isLoading ? (
        <Badge variant="secondary">Loading...</Badge>
      ) : (
        <button
          onClick={handleToggle}
          disabled={isSaving}
          className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
            enabled ? "bg-primary" : "bg-input"
          }`}
          data-testid="toggle-earning-feature"
        >
          <span
            className={`inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${
              enabled ? "translate-x-6" : "translate-x-1"
            }`}
          />
        </button>
      )}
    </div>
  );
}

function SettingsSection() {
  const [translationService, setTranslationService] = useState<"libretranslate" | "openai" | "kimi" | "gemini">("libretranslate");
  const [autoSwitch, setAutoSwitch] = useState(true);
  const [providerStats, setProviderStats] = useState<Record<string, { avg: number; samples: number; failures: number; available: boolean }>>({});
  const [isLoadingService, setIsLoadingService] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const [serviceError, setServiceError] = useState<string | null>(null);

  const fetchServiceData = async () => {
    try {
      const response = await adminFetch("/api/translation-service");
      if (response.ok) {
        const data = await response.json();
        setTranslationService(data.service || "libretranslate");
        setAutoSwitch(data.autoSwitch ?? true);
        if (data.providers) setProviderStats(data.providers);
      } else if (response.status === 401) {
        setServiceError("Please log in to view settings");
      } else {
        setServiceError("Failed to load translation settings");
      }
    } catch (err) {
      setServiceError("Failed to connect to server");
    }
    setIsLoadingService(false);
  };

  useEffect(() => {
    fetchServiceData();
    const interval = setInterval(fetchServiceData, 10000);
    return () => clearInterval(interval);
  }, []);

  const getAccessCode = () => {
    let accessCode = sessionStorage.getItem("devPortalAccessCode") || "";
    if (!accessCode) {
      const storedCode = localStorage.getItem("dev_portal_access");
      if (storedCode) {
        accessCode = atob(storedCode);
        sessionStorage.setItem("devPortalAccessCode", accessCode);
      }
    }
    return accessCode;
  };

  const handleServiceChange = async (service: "libretranslate" | "openai" | "kimi" | "gemini") => {
    if (isSaving) return;
    setIsSaving(true);
    setServiceError(null);
    try {
      await apiRequest("POST", "/api/translation-service", { service, accessCode: getAccessCode() });
      setTranslationService(service);
    } catch (error) {
      console.error("Failed to save translation service:", error);
      setServiceError("Failed to save. Please try again.");
    }
    setIsSaving(false);
  };

  const handleAutoSwitchToggle = async () => {
    if (isSaving) return;
    setIsSaving(true);
    setServiceError(null);
    try {
      const newValue = !autoSwitch;
      await apiRequest("POST", "/api/translation-service", { autoSwitch: newValue, accessCode: getAccessCode() });
      setAutoSwitch(newValue);
    } catch (error) {
      console.error("Failed to toggle auto-switch:", error);
      setServiceError("Failed to save. Please try again.");
    }
    setIsSaving(false);
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-2">Settings</h2>
        <p className="text-muted-foreground">Configure your API settings and preferences</p>
      </div>

      <Tabs defaultValue="translation" data-testid="settings-tabs">
        <TabsList className="flex-wrap">
          <TabsTrigger value="translation" data-testid="tab-translation">Translation</TabsTrigger>
          <TabsTrigger value="architecture" data-testid="tab-architecture">Architecture</TabsTrigger>
          <TabsTrigger value="cookies" data-testid="tab-cookies">Cookies</TabsTrigger>
          <TabsTrigger value="general" data-testid="tab-general">General</TabsTrigger>
          <TabsTrigger value="security" data-testid="tab-security">Security</TabsTrigger>
          <TabsTrigger value="branding" data-testid="tab-branding">Branding</TabsTrigger>
          <TabsTrigger value="compliance" data-testid="tab-compliance">Compliance</TabsTrigger>
        </TabsList>

        <TabsContent value="translation" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle>Translation Service</CardTitle>
              <CardDescription>Choose which translation API to use for video calls</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {isLoadingService ? (
                <div className="text-center py-4 text-muted-foreground">Loading...</div>
              ) : serviceError && !translationService ? (
                <div className="text-center py-4 text-destructive">{serviceError}</div>
              ) : (
                <>
                  <div className="space-y-4">
                    {([
                      { id: "libretranslate" as const, label: "LibreTranslate (Primary)", desc: "Open-source, self-hosted translation. Primary service" },
                      { id: "kimi" as const, label: "Kimi K2.5 (Secondary)", desc: "Moonshot AI. Also handles caption cleanup and call summaries" },
                      { id: "gemini" as const, label: "Gemini Flash (Tertiary)", desc: "Google Gemini 2.0 Flash. Fast, cost-effective translations" },
                      { id: "openai" as const, label: "OpenAI (Final Fallback)", desc: "Uses gpt-4o-mini. Also sole provider for speech-to-text" },
                    ]).map(({ id, label, desc }) => (
                      <div
                        key={id}
                        className={`flex flex-wrap items-center justify-between gap-4 p-4 rounded-lg border-2 cursor-pointer transition-colors ${
                          translationService === id ? "border-primary bg-primary/5" : "border-muted hover-elevate"
                        }`}
                        onClick={() => handleServiceChange(id)}
                        data-testid={`option-${id}`}
                      >
                        <div className="flex items-center gap-3">
                          <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                            translationService === id ? "border-primary" : "border-muted-foreground"
                          }`}>
                            {translationService === id && <div className="w-2 h-2 rounded-full bg-primary" />}
                          </div>
                          <div>
                            <p className="font-medium">{label}</p>
                            <p className="text-sm text-muted-foreground">{desc}</p>
                          </div>
                        </div>
                        <Badge variant={translationService === id ? "default" : "secondary"}>
                          {translationService === id ? "Active" : "Available"}
                        </Badge>
                      </div>
                    ))}
                  </div>

                  {isSaving && (
                    <p className="text-sm text-muted-foreground text-center">Saving...</p>
                  )}

                  {serviceError && (
                    <p className="text-sm text-destructive text-center">{serviceError}</p>
                  )}

                  <Card data-testid="auto-switch-card">
                    <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
                      <div>
                        <CardTitle className="text-base">Auto-Switch</CardTitle>
                        <CardDescription className="text-xs">Automatically switch providers based on latency and failures</CardDescription>
                      </div>
                      <Button
                        size="sm"
                        variant={autoSwitch ? "default" : "outline"}
                        onClick={handleAutoSwitchToggle}
                        disabled={isSaving}
                        data-testid="button-auto-switch-toggle"
                      >
                        {autoSwitch ? "On" : "Off"}
                      </Button>
                    </CardHeader>
                    {autoSwitch && (
                      <CardContent className="pt-0">
                        <p className="text-xs text-muted-foreground mb-3">
                          Switches when avg latency exceeds 2000ms or after 3 consecutive failures. Providers recover after 60s cooldown.
                        </p>
                        <div className="space-y-2">
                          {(["libretranslate", "kimi", "gemini"] as const).map(prov => {
                            const stats = providerStats[prov];
                            if (!stats) return null;
                            const isActive = translationService === prov;
                            const displayName = prov === "libretranslate" ? "LibreTranslate" : prov === "gemini" ? "Gemini Flash" : "Kimi K2.5";
                            return (
                              <div
                                key={prov}
                                className={`flex flex-wrap items-center justify-between gap-2 p-2 rounded-md text-xs ${
                                  isActive ? "bg-primary/10 border border-primary/30" : "bg-muted/50"
                                }`}
                                data-testid={`provider-stat-${prov}`}
                              >
                                <div className="flex items-center gap-2">
                                  <div className={`w-2 h-2 rounded-full ${
                                    !stats.available ? "bg-destructive" : isActive ? "bg-primary" : "bg-muted-foreground/40"
                                  }`} />
                                  <span className="font-medium capitalize">{displayName}</span>
                                  {isActive && <Badge variant="default" className="text-[10px] px-1.5 py-0">Active</Badge>}
                                </div>
                                <div className="flex items-center gap-3 text-muted-foreground">
                                  <span>{stats.avg > 0 ? `${stats.avg}ms` : "-"}</span>
                                  <span>{stats.samples > 0 ? `${stats.samples} calls` : "no data"}</span>
                                  {stats.failures > 0 && <span className="text-destructive">{stats.failures} fail</span>}
                                  {!stats.available && <Badge variant="destructive" className="text-[10px] px-1.5 py-0">Down</Badge>}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </CardContent>
                    )}
                  </Card>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="architecture" className="mt-6">
          <div className="space-y-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">AI Provider Chains</CardTitle>
                <CardDescription className="text-xs">Complete fallback order for each AI-powered feature</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {[
                  { feature: "Translation (Main)", chain: ["LibreTranslate", "Kimi", "Gemini", "Claude"], note: "Primary translation pipeline for all text" },
                  { feature: "Segment Translation", chain: ["Kimi", "Claude", "OpenAI"], note: "Video caption segments with numbered format" },
                  { feature: "Caption Cleanup", chain: ["Kimi", "Claude", "Raw (no cleanup)"], note: "Removes filler words, fixes grammar" },
                  { feature: "Call Summary", chain: ["Kimi", "Claude", "OpenAI"], note: "Post-call AI summary with key points" },
                  { feature: "Language Detection", chain: ["Gemini", "Claude", "OpenAI"], note: "Detects source language of text" },
                  { feature: "Batch Translation", chain: ["Kimi", "Gemini", "Claude"], note: "Chat message batch translation" },
                  { feature: "FAQ Chat", chain: ["Claude", "OpenAI"], note: "AI-powered support chat" },
                  { feature: "Speech-to-Text", chain: ["OpenAI (gpt-4o-mini-transcribe)"], note: "Audio transcription, OpenAI only" },
                  { feature: "Health Analysis", chain: ["Claude", "Gemini", "OpenAI"], note: "AI-driven system health scoring" },
                ].map(({ feature, chain, note }) => (
                  <div key={feature} className="p-3 bg-muted rounded-lg" data-testid={`chain-${feature.toLowerCase().replace(/[^a-z]/g, "-")}`}>
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                      <span className="font-medium text-sm">{feature}</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-1 mb-1">
                      {chain.map((provider, i) => (
                        <span key={i} className="flex items-center gap-1">
                          <Badge variant={i === 0 ? "default" : "secondary"} className="text-[10px] px-1.5 py-0">
                            {provider}
                          </Badge>
                          {i < chain.length - 1 && <span className="text-muted-foreground text-xs">→</span>}
                        </span>
                      ))}
                    </div>
                    <p className="text-[11px] text-muted-foreground">{note}</p>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Operational Limits</CardTitle>
                <CardDescription className="text-xs">Rate limits, caps, and thresholds</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { label: "Room Capacity", value: "2 members", desc: "Max active members per room" },
                    { label: "Room Creation", value: "50/hr per user", desc: "Also 50/hr global limit" },
                    { label: "Upload Limit", value: "25 MB", desc: "Audio/video file size cap" },
                    { label: "Message Retention", value: "24 hours", desc: "DB cleanup every 30 min, in-memory 12h" },
                    { label: "Room Message Cache", value: "50 messages", desc: "In-memory per room" },
                    { label: "Text Input Limit", value: "5,000 chars", desc: "Translation input max" },
                    { label: "Session TTL", value: "4 hours", desc: "Inactivity timeout for cookies" },
                    { label: "Room Code Length", value: "6 characters", desc: "Alphanumeric codes" },
                  ].map(({ label, value, desc }) => (
                    <div key={label} className="p-2.5 bg-muted rounded-lg" data-testid={`limit-${label.toLowerCase().replace(/\s/g, "-")}`}>
                      <p className="font-medium text-xs">{label}</p>
                      <p className="text-sm font-mono text-primary">{value}</p>
                      <p className="text-[10px] text-muted-foreground">{desc}</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Auto-Switch Configuration</CardTitle>
                <CardDescription className="text-xs">Translation provider failover parameters</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { label: "Latency Threshold", value: "2,000 ms", desc: "Triggers provider evaluation" },
                    { label: "Failure Threshold", value: "3 consecutive", desc: "Marks provider unavailable" },
                    { label: "Base Cooldown", value: "60 seconds", desc: "Before retrying failed provider" },
                    { label: "Max Cooldown", value: "10 minutes", desc: "Exponential backoff cap" },
                    { label: "Provider Timeout", value: "5-10 seconds", desc: "Per-request abort signal" },
                    { label: "Health Check Interval", value: "5 minutes", desc: "AI health analysis cycle" },
                  ].map(({ label, value, desc }) => (
                    <div key={label} className="p-2.5 bg-muted rounded-lg" data-testid={`config-${label.toLowerCase().replace(/\s/g, "-")}`}>
                      <p className="font-medium text-xs">{label}</p>
                      <p className="text-sm font-mono text-primary">{value}</p>
                      <p className="text-[10px] text-muted-foreground">{desc}</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Cache Configuration</CardTitle>
                <CardDescription className="text-xs">In-memory cache sizes and TTLs</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { label: "Video Captions", value: "50 entries", desc: "Max age 25 hours" },
                    { label: "Translated Captions", value: "100 entries", desc: "Per-language cache" },
                    { label: "Language Detection", value: "500 entries", desc: "Cached detection results" },
                    { label: "Chat Translation", value: "1,000 entries", desc: "TTL 10 minutes" },
                    { label: "Translation Cache", value: "AES-256-GCM", desc: "Encrypted values at rest" },
                    { label: "Cleanup Cycle", value: "30 minutes", desc: "Stale entry purge interval" },
                  ].map(({ label, value, desc }) => (
                    <div key={label} className="p-2.5 bg-muted rounded-lg" data-testid={`cache-${label.toLowerCase().replace(/\s/g, "-")}`}>
                      <p className="font-medium text-xs">{label}</p>
                      <p className="text-sm font-mono text-primary">{value}</p>
                      <p className="text-[10px] text-muted-foreground">{desc}</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">WebSocket Configuration</CardTitle>
                <CardDescription className="text-xs">Real-time communication parameters</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { label: "Path", value: "/ws", desc: "WebSocket endpoint" },
                    { label: "Heartbeat", value: "30 seconds", desc: "Ping/pong keepalive" },
                    { label: "E2E Keepalive", value: "15 seconds", desc: "Encryption health check" },
                    { label: "E2E Timeout", value: "45 seconds", desc: "Re-handshake trigger" },
                    { label: "Reconnect Backoff", value: "1s → 15s", desc: "×1.5 exponential scaling" },
                    { label: "Auth Required", value: "Yes", desc: "Session middleware on handshake" },
                  ].map(({ label, value, desc }) => (
                    <div key={label} className="p-2.5 bg-muted rounded-lg" data-testid={`ws-${label.toLowerCase().replace(/\s/g, "-")}`}>
                      <p className="font-medium text-xs">{label}</p>
                      <p className="text-sm font-mono text-primary">{value}</p>
                      <p className="text-[10px] text-muted-foreground">{desc}</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Guardian Service Health</CardTitle>
                <CardDescription className="text-xs">Autonomous service recovery. Claude agent auto-restores disabled services</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { label: "Auto-Switch Recovery", value: "Enabled", desc: "Re-enables provider auto-switching if disabled" },
                    { label: "Provider Restoration", value: "All providers", desc: "Resets unavailable providers back to active" },
                    { label: "Primary Provider Reset", value: "LibreTranslate", desc: "Resets active provider to primary (LibreTranslate)" },
                    { label: "Stale WS Cleanup", value: "Automatic", desc: "Removes dead WebSocket connections" },
                    { label: "Critical Key Check", value: "6 keys", desc: "LibreTranslate, Kimi, Claude, OpenAI, DB, Session" },
                    { label: "Trigger", value: "Every agent run", desc: "Runs as part of autonomous health check" },
                  ].map(({ label, value, desc }) => (
                    <div key={label} className="p-2.5 bg-muted rounded-lg" data-testid={`guardian-${label.toLowerCase().replace(/\s/g, "-")}`}>
                      <p className="font-medium text-xs">{label}</p>
                      <p className="text-sm font-mono text-primary">{value}</p>
                      <p className="text-[10px] text-muted-foreground">{desc}</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">E2E Encryption</CardTitle>
                <CardDescription className="text-xs">End-to-end encryption parameters</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { label: "Key Exchange", value: "ECDH P-256", desc: "Elliptic curve Diffie-Hellman" },
                    { label: "Key Derivation", value: "HKDF-SHA256", desc: "Shared secret derivation" },
                    { label: "Cipher", value: "AES-256-GCM", desc: "Authenticated encryption" },
                    { label: "Key Ratcheting", value: "Enabled", desc: "Forward secrecy per message" },
                    { label: "Decrypt Failures", value: "3 → re-handshake", desc: "Auto-recovery threshold" },
                    { label: "Handshake Retry", value: "6 attempts", desc: "2s→10s backoff, 15s cooldown restart" },
                    { label: "Tiebreaker", value: "userId comparison", desc: "Resolves race conditions" },
                  ].map(({ label, value, desc }) => (
                    <div key={label} className="p-2.5 bg-muted rounded-lg" data-testid={`e2e-${label.toLowerCase().replace(/\s/g, "-")}`}>
                      <p className="font-medium text-xs">{label}</p>
                      <p className="text-sm font-mono text-primary">{value}</p>
                      <p className="text-[10px] text-muted-foreground">{desc}</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="cookies" className="mt-6">
          <CookiesMonitor />
        </TabsContent>

        <TabsContent value="general" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle>General Configuration</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-4 p-4 bg-muted rounded-lg" data-testid="setting-app-name">
                <div>
                  <p className="font-medium">Application</p>
                  <p className="text-sm text-muted-foreground">JunoTalk. Video Calling with Translated Captions</p>
                </div>
                <Badge>Active</Badge>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-4 p-4 bg-muted rounded-lg" data-testid="setting-default-language">
                <div>
                  <p className="font-medium">Default Language</p>
                  <p className="text-sm text-muted-foreground">English (configurable per user in Settings)</p>
                </div>
                <Badge variant="secondary">English</Badge>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-4 p-4 bg-muted rounded-lg" data-testid="setting-timezone">
                <div>
                  <p className="font-medium">Server Timezone</p>
                  <p className="text-sm text-muted-foreground">All timestamps stored in UTC</p>
                </div>
                <Badge variant="secondary">UTC</Badge>
              </div>
              <EarningFeatureToggle />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="security" className="mt-6">
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Security Configuration</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-4 p-4 bg-muted rounded-lg" data-testid="setting-auth">
                  <div>
                    <p className="font-medium">Authentication</p>
                    <p className="text-sm text-muted-foreground">Replit Auth with PostgreSQL session storage</p>
                  </div>
                  <Badge>Active</Badge>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-4 p-4 bg-muted rounded-lg" data-testid="setting-session">
                  <div>
                    <p className="font-medium">Session Duration</p>
                    <p className="text-sm text-muted-foreground">Sessions expire after 4 hours of inactivity (rolling TTL)</p>
                  </div>
                  <Badge variant="secondary">4 Hours</Badge>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-4 p-4 bg-muted rounded-lg" data-testid="setting-encryption">
                  <div>
                    <p className="font-medium">Transport Security</p>
                    <p className="text-sm text-muted-foreground">HTTPS enforced, secure cookies, HTTP-only sessions</p>
                  </div>
                  <Badge>Enabled</Badge>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-4 p-4 bg-muted rounded-lg" data-testid="setting-room-codes">
                  <div>
                    <p className="font-medium">Room Code Security</p>
                    <p className="text-sm text-muted-foreground">6-character codes prevent link manipulation attacks</p>
                  </div>
                  <Badge>Active</Badge>
                </div>
                <SecurityMonitoringToggle />
              </CardContent>
            </Card>

            <LoginActivityPanel />
            <RoomCodeSecurityCard />
          </div>
        </TabsContent>

        <TabsContent value="branding" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle>Branding Configuration</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-4 p-4 bg-muted rounded-lg" data-testid="setting-domain">
                <div>
                  <p className="font-medium">Domain</p>
                  <p className="text-sm text-muted-foreground">junotalk.app</p>
                </div>
                <Badge>Active</Badge>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-4 p-4 bg-muted rounded-lg" data-testid="setting-theme">
                <div>
                  <p className="font-medium">Theme</p>
                  <p className="text-sm text-muted-foreground">Blue-Teal brand identity, dark mode only</p>
                </div>
                <Badge variant="secondary">hsl(213 72% 44%)</Badge>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-4 p-4 bg-muted rounded-lg" data-testid="setting-design">
                <div>
                  <p className="font-medium">Design</p>
                  <p className="text-sm text-muted-foreground">Mobile-first responsive layout (iOS Safari, Android Chrome)</p>
                </div>
                <Badge variant="secondary">Responsive</Badge>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="compliance" className="mt-6">
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Compliance Status</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-3 gap-2 lg:gap-4">
                  <div className="p-2 lg:p-4 bg-muted rounded-lg text-center" data-testid="compliance-soc2">
                    <Shield className="w-6 h-6 lg:w-8 lg:h-8 mx-auto mb-1 lg:mb-2 text-amber-500" />
                    <p className="font-medium text-xs lg:text-base">SOC 2</p>
                    <Badge variant="secondary" className="mt-1 lg:mt-2 text-xs">Planned</Badge>
                  </div>
                  <div className="p-2 lg:p-4 bg-muted rounded-lg text-center" data-testid="compliance-gdpr">
                    <Shield className="w-6 h-6 lg:w-8 lg:h-8 mx-auto mb-1 lg:mb-2 text-green-500" />
                    <p className="font-medium text-xs lg:text-base">GDPR</p>
                    <Badge className="mt-1 lg:mt-2 text-xs bg-green-600">Active</Badge>
                  </div>
                  <div className="p-2 lg:p-4 bg-muted rounded-lg text-center" data-testid="compliance-hipaa">
                    <Shield className="w-6 h-6 lg:w-8 lg:h-8 mx-auto mb-1 lg:mb-2 text-muted-foreground" />
                    <p className="font-medium text-xs lg:text-base">HIPAA</p>
                    <Badge variant="outline" className="mt-1 lg:mt-2 text-xs">Optional</Badge>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">GDPR Implementation Details</CardTitle>
                <CardDescription className="text-xs">Active data protection measures and user rights</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { label: "Cookie Consent", status: "Active", desc: "GDPR-compliant banner with accept/decline" },
                    { label: "Privacy Policy", status: "Active", desc: "Full disclosure of data collection and usage" },
                    { label: "Data Export", status: "Active", desc: "GET /api/gdpr/export, JSON download of all user data" },
                    { label: "Account Deletion", status: "Active", desc: "DELETE /api/gdpr/delete-account, full erasure" },
                    { label: "Data Minimization", status: "Active", desc: "sanitizeUser() strips emails from API responses" },
                    { label: "Encryption at Rest", status: "Active", desc: "AES-256-GCM encrypted translation cache" },
                    { label: "E2E Encryption", status: "Active", desc: "ECDH P-256 + AES-256-GCM for all communications" },
                    { label: "Data Retention", status: "Active", desc: "Messages are permanently saved in chat history" },
                    { label: "No Data Selling", status: "Active", desc: "User data never shared with third parties" },
                    { label: "Consent Management", status: "Active", desc: "Cookie consent with granular user control" },
                  ].map(({ label, status, desc }) => (
                    <div key={label} className="p-2.5 bg-muted rounded-lg" data-testid={`gdpr-${label.toLowerCase().replace(/\s/g, "-")}`}>
                      <div className="flex items-center justify-between mb-0.5">
                        <p className="font-medium text-xs">{label}</p>
                        <Badge className="text-[9px] px-1 py-0 bg-green-600">{status}</Badge>
                      </div>
                      <p className="text-[10px] text-muted-foreground">{desc}</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">SOC 2 Roadmap</CardTitle>
                <CardDescription className="text-xs">Service Organization Control requirements</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { label: "Access Controls", status: "Partial", desc: "Admin gates, session auth, rate limiting" },
                    { label: "Encryption", status: "Active", desc: "AES-256-GCM, HTTPS, E2E encryption" },
                    { label: "Monitoring", status: "Active", desc: "AI health agent, metrics, error tracking" },
                    { label: "Audit Logging", status: "Planned", desc: "Formal audit trail for data access events" },
                    { label: "Incident Response", status: "Planned", desc: "Documented incident handling procedures" },
                    { label: "Vendor Management", status: "Planned", desc: "Third-party service risk assessment" },
                  ].map(({ label, status, desc }) => (
                    <div key={label} className="p-2.5 bg-muted rounded-lg" data-testid={`soc2-${label.toLowerCase().replace(/\s/g, "-")}`}>
                      <div className="flex items-center justify-between mb-0.5">
                        <p className="font-medium text-xs">{label}</p>
                        <Badge variant={status === "Active" ? "default" : status === "Partial" ? "secondary" : "outline"} className={`text-[9px] px-1 py-0 ${status === "Active" ? "bg-green-600" : ""}`}>{status}</Badge>
                      </div>
                      <p className="text-[10px] text-muted-foreground">{desc}</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function RoomCodeSecurityCard() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    adminFetch("/api/room-code-security")
      .then(r => r.ok ? r.json() : null)
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <Card data-testid="card-room-code-security">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="w-5 h-5" />
            Room Code Manipulation Detection
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-6">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!data) {
    return (
      <Card data-testid="card-room-code-security">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="w-5 h-5" />
            Room Code Manipulation Detection
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Unable to load security data.</p>
        </CardContent>
      </Card>
    );
  }

  const hasAlerts = data.recentAlerts && data.recentAlerts.length > 0;
  const hasBlocked = data.currentlyBlocked > 0;
  const threatLevel = hasBlocked ? "high" : hasAlerts ? "medium" : data.failedLastHour > 5 ? "low" : "none";

  return (
    <Card data-testid="card-room-code-security">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2">
          <Shield className="w-5 h-5" />
          Room Code Manipulation Detection
        </CardTitle>
        <CardDescription className="text-xs">
          Monitors brute force attempts on 6-digit room codes. Users are auto-blocked after {data.config?.threshold || 10} failed attempts within {(data.config?.windowMs || 60000) / 1000}s.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-2">
          <div className="p-3 bg-muted rounded-lg" data-testid="metric-failed-total">
            <p className="text-xs text-muted-foreground">Total Failed</p>
            <p className="text-xl font-bold">{data.totalFailed}</p>
          </div>
          <div className="p-3 bg-muted rounded-lg" data-testid="metric-successful-total">
            <p className="text-xs text-muted-foreground">Total Successful</p>
            <p className="text-xl font-bold">{data.totalSuccessful}</p>
          </div>
          <div className="p-3 bg-muted rounded-lg" data-testid="metric-failed-hour">
            <p className="text-xs text-muted-foreground">Failed (Last Hour)</p>
            <p className="text-xl font-bold">{data.failedLastHour}</p>
          </div>
          <div className="p-3 bg-muted rounded-lg" data-testid="metric-blocked-users">
            <p className="text-xs text-muted-foreground">Currently Blocked</p>
            <p className={`text-xl font-bold ${hasBlocked ? "text-red-500" : ""}`}>{data.currentlyBlocked}</p>
          </div>
        </div>

        <div className="flex items-center justify-between p-3 rounded-lg bg-muted" data-testid="threat-level">
          <div>
            <p className="font-medium text-sm">Threat Level</p>
            <p className="text-xs text-muted-foreground">Based on recent activity</p>
          </div>
          <Badge
            variant={threatLevel === "none" ? "secondary" : "destructive"}
            className={threatLevel === "none" ? "bg-green-600 text-white" : threatLevel === "low" ? "bg-yellow-600" : ""}
            data-testid="badge-threat-level"
          >
            {threatLevel === "none" ? "Clear" : threatLevel === "low" ? "Low" : threatLevel === "medium" ? "Medium" : "High"}
          </Badge>
        </div>

        {hasAlerts && (
          <div className="space-y-2" data-testid="recent-alerts">
            <p className="font-medium text-sm flex items-center gap-1.5">
              <AlertCircle className="w-4 h-4 text-red-500" />
              Recent Brute Force Alerts
            </p>
            {data.recentAlerts.map((alert: any, i: number) => (
              <div key={i} className="p-2.5 bg-red-500/10 border border-red-500/20 rounded-lg text-sm" data-testid={`alert-${i}`}>
                <div className="flex items-center justify-between mb-1">
                  <span className="font-medium text-xs">User: {alert.userId}</span>
                  <Badge variant="destructive" className="text-[10px]">{alert.attemptCount} attempts</Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  Detected: {new Date(alert.detectedAt).toLocaleString()}
                </p>
              </div>
            ))}
          </div>
        )}

        {hasBlocked && data.blockedUsers && (
          <div className="space-y-2" data-testid="blocked-users-list">
            <p className="font-medium text-sm flex items-center gap-1.5">
              <Lock className="w-4 h-4 text-orange-500" />
              Currently Blocked Users
            </p>
            {data.blockedUsers.map((user: any, i: number) => (
              <div key={i} className="p-2.5 bg-orange-500/10 border border-orange-500/20 rounded-lg" data-testid={`blocked-user-${i}`}>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium">{user.userId.slice(0, 12)}...</span>
                  <span className="text-xs text-muted-foreground">
                    {Math.ceil(user.remainingMs / 60000)}m remaining
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}

        {!hasAlerts && !hasBlocked && data.failedLastHour === 0 && (
          <div className="flex items-center gap-2 p-3 bg-green-500/10 border border-green-500/20 rounded-lg" data-testid="status-clear">
            <CheckCircle className="w-4 h-4 text-green-500" />
            <p className="text-sm text-green-700 dark:text-green-400">No manipulation attempts detected. Room codes are secure.</p>
          </div>
        )}

        <div className="p-3 bg-muted rounded-lg" data-testid="protection-config">
          <p className="font-medium text-xs mb-2">Protection Configuration</p>
          <div className="grid grid-cols-3 gap-2 text-[11px] text-muted-foreground">
            <div>
              <p className="font-medium text-foreground">Window</p>
              <p>{(data.config?.windowMs || 60000) / 1000}s</p>
            </div>
            <div>
              <p className="font-medium text-foreground">Threshold</p>
              <p>{data.config?.threshold || 10} attempts</p>
            </div>
            <div>
              <p className="font-medium text-foreground">Block Time</p>
              <p>{(data.config?.blockDurationMs || 300000) / 60000}m</p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function DocsSection() {
  const endpoints = [
    { method: "GET", path: "/v1/status", description: "Check API status" },
    { method: "POST", path: "/v1/translate/session", description: "Create translation session" },
    { method: "POST", path: "/v1/webrtc/offer", description: "Initiate WebRTC connection" },
    { method: "POST", path: "/v1/webhooks", description: "Configure webhooks" },
    { method: "GET", path: "/v1/usage", description: "Get usage statistics" },
    { method: "GET", path: "/v1/audit-logs", description: "Get audit logs (Enterprise)" },
  ];

  const pricingTiers = [
    { name: "Starter", price: "$49/mo", limits: "10,000 minutes, 2 API keys", features: ["Real-time translation", "5 languages", "Email support"] },
    { name: "Pro", price: "$199/mo", limits: "50,000 minutes, 10 API keys", features: ["All Starter features", "25 languages", "Priority support", "Webhooks"] },
    { name: "Enterprise", price: "Custom", limits: "Unlimited", features: ["All Pro features", "Custom languages", "Dedicated support", "SLA guarantee", "Compliance options"] },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-2">API Documentation</h2>
        <p className="text-muted-foreground">Complete reference for JunoTalk API</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 lg:gap-6">
        <div className="lg:col-span-1 space-y-4">
          <Card>
            <CardHeader className="pb-2 lg:pb-4">
              <CardTitle className="text-base lg:text-lg">Quick Reference</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div>
                <p className="font-medium text-xs lg:text-sm">Base URL</p>
                <code className="text-xs bg-muted px-2 py-1 rounded block mt-1 break-all">https://api.junotalk.app/v1</code>
              </div>
              <div>
                <p className="font-medium text-xs lg:text-sm">Authentication</p>
                <code className="text-xs bg-muted px-2 py-1 rounded block mt-1">Bearer YOUR_API_KEY</code>
              </div>
              <div>
                <p className="font-medium text-xs lg:text-sm">Content Type</p>
                <code className="text-xs bg-muted px-2 py-1 rounded block mt-1">application/json</code>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="lg:col-span-2">
          <Card>
            <CardHeader className="pb-2 lg:pb-4">
              <CardTitle className="text-base lg:text-lg">API Endpoints</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {endpoints.map((ep, idx) => (
                  <div key={ep.path} className="flex flex-wrap items-center gap-2 lg:gap-3 p-2 lg:p-3 bg-muted rounded-lg" data-testid={`endpoint-${idx}`}>
                    <Badge variant={ep.method === "GET" ? "secondary" : "default"} className="w-14 lg:w-16 justify-center text-xs">
                      {ep.method}
                    </Badge>
                    <code className="text-xs lg:text-sm flex-1 break-all">{ep.path}</code>
                    <span className="text-xs lg:text-sm text-muted-foreground w-full lg:w-auto">{ep.description}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-2 lg:pb-4">
          <CardTitle className="text-base lg:text-lg">Pricing Tiers</CardTitle>
          <CardDescription className="text-xs lg:text-sm">Choose the plan that fits your needs</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {pricingTiers.map((tier, idx) => (
              <div key={tier.name} className="p-3 lg:p-4 bg-muted rounded-lg" data-testid={`pricing-tier-${idx}`}>
                <h4 className="font-bold text-base lg:text-lg" data-testid={`text-tier-name-${idx}`}>{tier.name}</h4>
                <p className="text-xl lg:text-2xl font-bold text-primary mt-1" data-testid={`text-tier-price-${idx}`}>{tier.price}</p>
                <p className="text-xs lg:text-sm text-muted-foreground mt-1">{tier.limits}</p>
                <ul className="mt-3 lg:mt-4 space-y-1 lg:space-y-2">
                  {tier.features.map((f) => (
                    <li key={f} className="text-xs lg:text-sm flex flex-wrap items-center gap-2">
                      <CheckCircle className="w-3 h-3 lg:w-4 lg:h-4 text-blue-600 dark:text-blue-500 flex-shrink-0" />
                      {f}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function AccessGate({ onUnlock }: { onUnlock: () => void }) {
  const [accessCode, setAccessCode] = useState("");
  const [error, setError] = useState("");
  const [isVerifying, setIsVerifying] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsVerifying(true);
    
    try {
      const response = await apiRequest("POST", "/api/developer/verify-access", { accessCode });
      const data = await response.json();
      
      if (data.valid) {
        localStorage.setItem("dev_portal_access", btoa(accessCode));
        sessionStorage.setItem("devPortalAccessCode", accessCode);
        onUnlock();
      } else {
        setError("Invalid access code");
      }
    } catch (err) {
      setError("Verification failed. Please try again.");
    } finally {
      setIsVerifying(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
            <Lock className="w-8 h-8 text-primary" />
          </div>
          <CardTitle className="text-2xl">Management Platform</CardTitle>
          <CardDescription>
            Enter your admin access code to continue
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Input
                type="password"
                placeholder="Enter access code"
                value={accessCode}
                onChange={(e) => setAccessCode(e.target.value)}
                className="text-center text-lg tracking-widest"
                data-testid="input-access-code"
              />
              {error && (
                <p className="text-sm text-destructive mt-2 text-center">{error}</p>
              )}
            </div>
            <Button 
              type="submit" 
              className="w-full" 
              disabled={!accessCode || isVerifying}
              data-testid="button-verify-access"
            >
              {isVerifying ? "Verifying..." : "Access Portal"}
            </Button>
          </form>
          <div className="mt-6 pt-4 border-t">
            <Link href="/">
              <BackTriangle onClick={() => {}} testId="button-back-home" />
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function UserFeedbackSection() {
  const [feedbackItems, setFeedbackItems] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [filter, setFilter] = useState("all");
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [reviewingAll, setReviewingAll] = useState(false);

  const fetchFeedback = async () => {
    setIsLoading(true);
    try {
      const accessCode = sessionStorage.getItem("devPortalAccessCode");
      const res = await fetch(`/api/feedback/all?accessCode=${encodeURIComponent(accessCode || "")}`, { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setFeedbackItems(data);
        setFetchError(null);
      } else if (res.status === 403) {
        setFetchError("Access denied. Please re-enter the access code.");
      } else {
        setFetchError("Failed to load feedback.");
      }
    } catch {
      setFetchError("Network error. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { fetchFeedback(); }, []);

  const toggleStatus = async (id: string, currentStatus: string) => {
    const newStatus = currentStatus === "resolved" ? "needs_work" : "resolved";
    try {
      const accessCode = sessionStorage.getItem("devPortalAccessCode");
      const res = await fetch(`/api/feedback/${id}/status`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessCode, status: newStatus }),
      });
      if (res.ok) fetchFeedback();
    } catch {}
  };

  const runAiReview = async (id: string) => {
    setReviewingId(id);
    try {
      const accessCode = sessionStorage.getItem("devPortalAccessCode");
      await fetch(`/api/feedback/${id}/ai-review`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessCode }),
      });
      fetchFeedback();
    } catch {}
    setReviewingId(null);
  };

  const runAiReviewAll = async () => {
    setReviewingAll(true);
    try {
      const accessCode = sessionStorage.getItem("devPortalAccessCode");
      await fetch("/api/feedback/ai-review-all", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessCode }),
      });
      fetchFeedback();
    } catch {}
    setReviewingAll(false);
  };

  const filteredItems = filter === "all" ? feedbackItems : feedbackItems.filter(f => f.status === filter);
  const statusCounts = {
    needs_work: feedbackItems.filter(f => f.status === "needs_work").length,
    resolved: feedbackItems.filter(f => f.status === "resolved").length,
  };

  return (
    <div className="space-y-6" data-testid="feedback-section">
      <div>
        <h2 className="text-2xl font-bold">User Feedback</h2>
        <p className="text-muted-foreground">Review and manage all user feedback, never deleted</p>
      </div>

      {fetchError && (
        <div className="p-3 rounded-md bg-destructive/10 text-destructive text-sm" data-testid="feedback-error">
          {fetchError}
        </div>
      )}

      <div className="grid grid-cols-3 gap-3">
        <Card className="cursor-pointer" onClick={() => setFilter("needs_work")} data-testid="filter-needs-work">
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-amber-500">{statusCounts.needs_work}</p>
            <p className="text-xs text-muted-foreground">Needs Work</p>
          </CardContent>
        </Card>
        <Card className="cursor-pointer" onClick={() => setFilter("resolved")} data-testid="filter-feedback-resolved">
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-emerald-500">{statusCounts.resolved}</p>
            <p className="text-xs text-muted-foreground">Resolved</p>
          </CardContent>
        </Card>
        <Card className="cursor-pointer" onClick={() => setFilter("all")} data-testid="filter-feedback-all">
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold">{feedbackItems.length}</p>
            <p className="text-xs text-muted-foreground">Total</p>
          </CardContent>
        </Card>
      </div>

      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="font-medium">
          {filter === "all" ? "All Feedback" : filter === "needs_work" ? "Needs Work" : "Resolved"} ({filteredItems.length})
        </h3>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={runAiReviewAll} disabled={reviewingAll} data-testid="button-ai-review-all">
            {reviewingAll ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Sparkles className="w-4 h-4 mr-1" />}
            {reviewingAll ? "Reviewing..." : "AI Review All"}
          </Button>
          <Button variant="outline" size="sm" onClick={fetchFeedback} disabled={isLoading} data-testid="button-refresh-feedback">
            {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <Card key={i}><CardContent className="p-4 animate-pulse">
              <div className="h-4 w-48 bg-muted rounded mb-2" />
              <div className="h-3 w-full bg-muted rounded" />
            </CardContent></Card>
          ))}
        </div>
      ) : filteredItems.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            <MessageSquareText className="w-10 h-10 mx-auto mb-2 opacity-50" />
            <p>No {filter === "all" ? "" : filter === "needs_work" ? "needs work " : "resolved "}feedback found</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filteredItems.map((item) => (
            <Card key={item.id} data-testid={`feedback-item-${item.id}`}>
              <CardContent className="p-4 space-y-3">
                <div className="flex items-start justify-between gap-2 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm">{item.firstName}</p>
                    <p className="text-xs text-muted-foreground">
                      {item.createdAt ? new Date(item.createdAt).toLocaleString() : "Unknown date"}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge
                      variant={item.status === "resolved" ? "outline" : "default"}
                      className={`text-xs cursor-pointer select-none ${
                        item.status === "resolved"
                          ? "border-emerald-500/50 text-emerald-400"
                          : "bg-amber-500/20 text-amber-400 border-amber-500/30"
                      }`}
                      onClick={() => toggleStatus(item.id, item.status)}
                      data-testid={`status-toggle-${item.id}`}
                    >
                      {item.status === "resolved" ? (
                        <><CheckCircle className="w-3 h-3 mr-1" /> Resolved</>
                      ) : (
                        <><AlertCircle className="w-3 h-3 mr-1" /> Needs Work</>
                      )}
                    </Badge>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => runAiReview(item.id)}
                      disabled={reviewingId === item.id}
                      className="h-7 px-2"
                      data-testid={`button-ai-review-${item.id}`}
                    >
                      {reviewingId === item.id ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Sparkles className="w-3.5 h-3.5" />
                      )}
                    </Button>
                  </div>
                </div>

                <p className="text-sm text-foreground">{item.comment}</p>

                {item.aiReview && (
                  <div className="p-3 rounded-lg bg-primary/5 border border-primary/10">
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <Bot className="w-3.5 h-3.5 text-primary" />
                      <p className="text-xs font-medium text-primary">AI Review</p>
                    </div>
                    <p className="text-xs text-foreground/80 whitespace-pre-wrap">{item.aiReview}</p>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function SupportTicketsSection() {
  const [tickets, setTickets] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [filter, setFilter] = useState("all");
  const [editingTicket, setEditingTicket] = useState<string | null>(null);
  const [editStatus, setEditStatus] = useState("");
  const [editPriority, setEditPriority] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const fetchTickets = async () => {
    setIsLoading(true);
    try {
      const accessCode = sessionStorage.getItem("devPortalAccessCode");
      const res = await fetch(`/api/support/tickets/all?accessCode=${encodeURIComponent(accessCode || "")}`, { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setTickets(data);
        setFetchError(null);
      } else if (res.status === 403) {
        setFetchError("Access denied. Please re-enter the access code.");
      } else {
        setFetchError("Failed to load tickets.");
      }
    } catch (err) {
      console.error("Failed to fetch tickets:", err);
      setFetchError("Network error. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { fetchTickets(); }, []);

  const updateTicket = async (id: string) => {
    setSaving(true);
    try {
      const accessCode = sessionStorage.getItem("devPortalAccessCode");
      const res = await fetch(`/api/support/tickets/${id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accessCode,
          status: editStatus,
          priority: editPriority,
          adminNotes: editNotes,
        }),
      });
      if (res.ok) {
        setEditingTicket(null);
        fetchTickets();
      }
    } catch (err) {
      console.error("Failed to update ticket:", err);
    } finally {
      setSaving(false);
    }
  };

  const filteredTickets = filter === "all" ? tickets : tickets.filter(t => t.status === filter);
  const statusCounts = {
    open: tickets.filter(t => t.status === "open").length,
    in_progress: tickets.filter(t => t.status === "in_progress").length,
    resolved: tickets.filter(t => t.status === "resolved").length,
    closed: tickets.filter(t => t.status === "closed").length,
  };

  const priorityColor = (p: string) => {
    switch (p) {
      case "critical": return "text-red-600/90";
      case "high": return "text-orange-500";
      case "medium": return "text-amber-500";
      default: return "text-muted-foreground";
    }
  };

  return (
    <div className="space-y-6" data-testid="tickets-section">
      <div>
        <h2 className="text-2xl font-bold">Support Tickets</h2>
        <p className="text-muted-foreground">Track and manage user-reported issues</p>
      </div>

      {fetchError && (
        <div className="p-3 rounded-md bg-destructive/10 text-destructive text-sm" data-testid="tickets-error">
          {fetchError}
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card className="cursor-pointer" onClick={() => setFilter("open")} data-testid="filter-open">
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-primary">{statusCounts.open}</p>
            <p className="text-xs text-muted-foreground">Open</p>
          </CardContent>
        </Card>
        <Card className="cursor-pointer" onClick={() => setFilter("in_progress")} data-testid="filter-in-progress">
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-blue-500">{statusCounts.in_progress}</p>
            <p className="text-xs text-muted-foreground">In Progress</p>
          </CardContent>
        </Card>
        <Card className="cursor-pointer" onClick={() => setFilter("resolved")} data-testid="filter-resolved">
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-blue-600 dark:text-blue-500">{statusCounts.resolved}</p>
            <p className="text-xs text-muted-foreground">Resolved</p>
          </CardContent>
        </Card>
        <Card className="cursor-pointer" onClick={() => setFilter("all")} data-testid="filter-all">
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold">{tickets.length}</p>
            <p className="text-xs text-muted-foreground">Total</p>
          </CardContent>
        </Card>
      </div>

      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="font-medium">
          {filter === "all" ? "All Tickets" : `${filter.replace("_", " ")} Tickets`} ({filteredTickets.length})
        </h3>
        <Button variant="outline" size="sm" onClick={fetchTickets} disabled={isLoading} data-testid="button-refresh-tickets">
          {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Refresh"}
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <Card key={i}><CardContent className="p-4 animate-pulse">
              <div className="h-4 w-48 bg-muted rounded mb-2" />
              <div className="h-3 w-full bg-muted rounded" />
            </CardContent></Card>
          ))}
        </div>
      ) : filteredTickets.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            <TicketCheck className="w-10 h-10 mx-auto mb-2 opacity-50" />
            <p>No {filter === "all" ? "" : filter.replace("_", " ") + " "}tickets found</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filteredTickets.map((ticket) => (
            <Card key={ticket.id} data-testid={`admin-ticket-${ticket.id}`}>
              <CardContent className="p-4 space-y-2">
                <div className="flex items-start justify-between gap-2 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium">{ticket.subject}</p>
                    <p className="text-xs text-muted-foreground">
                      by {ticket.username || "Unknown"} &middot; {new Date(ticket.createdAt).toLocaleString()}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 flex-wrap">
                    <Badge variant="secondary" className="text-xs">{ticket.category}</Badge>
                    <Badge variant={
                      ticket.status === "open" ? "default" :
                      ticket.status === "in_progress" ? "secondary" :
                      ticket.status === "resolved" ? "outline" : "secondary"
                    } className="text-xs">
                      {ticket.status === "in_progress" ? "In Progress" : ticket.status.charAt(0).toUpperCase() + ticket.status.slice(1)}
                    </Badge>
                    <span className={`text-xs font-medium ${priorityColor(ticket.priority)}`}>
                      {ticket.priority.toUpperCase()}
                    </span>
                  </div>
                </div>
                <p className="text-sm text-foreground">{ticket.description}</p>

                {editingTicket === ticket.id ? (
                  <div className="space-y-2 p-3 rounded-lg bg-muted/30 border">
                    <div className="grid sm:grid-cols-2 gap-2">
                      <Select value={editStatus} onValueChange={setEditStatus}>
                        <SelectTrigger><SelectValue placeholder="Status" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="open">Open</SelectItem>
                          <SelectItem value="in_progress">In Progress</SelectItem>
                          <SelectItem value="resolved">Resolved</SelectItem>
                          <SelectItem value="closed">Closed</SelectItem>
                        </SelectContent>
                      </Select>
                      <Select value={editPriority} onValueChange={setEditPriority}>
                        <SelectTrigger><SelectValue placeholder="Priority" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="low">Low</SelectItem>
                          <SelectItem value="medium">Medium</SelectItem>
                          <SelectItem value="high">High</SelectItem>
                          <SelectItem value="critical">Critical</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <Textarea
                      placeholder="Add notes visible to the user..."
                      value={editNotes}
                      onChange={(e) => setEditNotes(e.target.value)}
                    />
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => updateTicket(ticket.id)} disabled={saving}>
                        {saving ? "Saving..." : "Save"}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditingTicket(null)}>Cancel</Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    {ticket.adminNotes && (
                      <div className="flex-1 p-2 rounded bg-primary/5 border border-primary/10">
                        <p className="text-xs font-medium text-primary">Team Notes:</p>
                        <p className="text-xs">{ticket.adminNotes}</p>
                      </div>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setEditingTicket(ticket.id);
                        setEditStatus(ticket.status);
                        setEditPriority(ticket.priority);
                        setEditNotes(ticket.adminNotes || "");
                      }}
                      data-testid={`button-edit-ticket-${ticket.id}`}
                    >
                      Manage
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

export default function DeveloperPortal() {
  const { user } = useAuth();
  const [isMobile, setIsMobile] = useState(false);
  const [activeSection, setActiveSection] = useState<PortalSection>("dashboard");
  const [hasAccess, setHasAccess] = useState(false);
  const [isCheckingAccess, setIsCheckingAccess] = useState(true);

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 1024);
    };
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  useEffect(() => {
    const verifyStoredAccess = async () => {
      const storedCode = localStorage.getItem("dev_portal_access");
      if (storedCode) {
        try {
          const decodedCode = atob(storedCode);
          const response = await apiRequest("POST", "/api/developer/verify-access", { 
            accessCode: decodedCode 
          });
          const data = await response.json();
          if (data.valid) {
            // Restore to session storage for API calls
            sessionStorage.setItem("devPortalAccessCode", decodedCode);
            setHasAccess(true);
          } else {
            localStorage.removeItem("dev_portal_access");
            sessionStorage.removeItem("devPortalAccessCode");
          }
        } catch (err) {
          localStorage.removeItem("dev_portal_access");
          sessionStorage.removeItem("devPortalAccessCode");
        }
      }
      setIsCheckingAccess(false);
    };
    verifyStoredAccess();
  }, []);

  if (isCheckingAccess) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-pulse text-muted-foreground">Verifying access...</div>
      </div>
    );
  }

  if (!hasAccess) {
    return <AccessGate onUnlock={() => setHasAccess(true)} />;
  }

  const navItems: { id: PortalSection; label: string; icon: React.ElementType }[] = [
    { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
    { id: "modules", label: "Modules", icon: Puzzle },
    { id: "integration", label: "Integration", icon: Plug },
    { id: "api-keys", label: "API Keys", icon: Key },
    { id: "claude-ai", label: "Claude AI", icon: Bot },
    { id: "settings", label: "Settings", icon: SettingsIcon },
    { id: "docs", label: "Docs", icon: FileText },
    { id: "tickets", label: "Tickets", icon: TicketCheck },
    { id: "feedback", label: "Feedback", icon: MessageSquareText },
  ];

  // Mobile layout with bottom tabs
  if (isMobile) {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        {/* Mobile Header */}
        <header className="h-14 border-b bg-card flex flex-wrap items-center justify-between gap-2 px-4 sticky top-0 z-50" data-testid="mobile-header">
          <Link href="/">
            <div className="flex flex-col">
              <span className="font-bold text-sm leading-tight">JunoTalk</span>
              <span className="text-[10px] text-muted-foreground leading-tight">Management Platform</span>
            </div>
          </Link>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="gap-1 text-xs" data-testid="badge-environment-mobile">
              <div className="w-2 h-2 rounded-full bg-blue-600/80" />
              Live
            </Badge>
          </div>
        </header>

        {/* Mobile Content */}
        <main className="flex-1 overflow-auto p-4 pb-20">
          {activeSection === "dashboard" && <SectionBoundary label="Dashboard"><DashboardSection /></SectionBoundary>}
          {activeSection === "modules" && <SectionBoundary label="Modules"><ModulesSection /></SectionBoundary>}
          {activeSection === "integration" && <SectionBoundary label="Integration"><IntegrationSection /></SectionBoundary>}
          {activeSection === "api-keys" && <SectionBoundary label="API Keys"><ApiKeysSection /></SectionBoundary>}
          {activeSection === "claude-ai" && <SectionBoundary label="Claude AI"><ClaudeAISection /></SectionBoundary>}

          {activeSection === "settings" && <SectionBoundary label="Settings"><SettingsSection /></SectionBoundary>}
          {activeSection === "docs" && <SectionBoundary label="Docs"><DocsSection /></SectionBoundary>}
          {activeSection === "tickets" && <SectionBoundary label="Tickets"><SupportTicketsSection /></SectionBoundary>}
          {activeSection === "feedback" && <SectionBoundary label="Feedback"><UserFeedbackSection /></SectionBoundary>}
        </main>

        {/* Mobile Bottom Navigation */}
        <nav className="fixed bottom-0 left-0 right-0 h-16 bg-card border-t flex flex-wrap items-center justify-around gap-1 px-2 z-50" data-testid="mobile-nav">
          {navItems.map((item) => (
            <Button
              key={item.id}
              variant="ghost"
              onClick={() => setActiveSection(item.id)}
              data-testid={`mobile-nav-${item.id}`}
              className={`flex flex-col items-center justify-center gap-1 h-14 px-2 min-w-[48px] ${
                activeSection === item.id
                  ? "text-primary"
                  : "text-muted-foreground"
              }`}
            >
              <item.icon className="w-5 h-5" />
              <span className="text-[10px] font-medium truncate">{item.label}</span>
            </Button>
          ))}
        </nav>
      </div>
    );
  }

  // Desktop layout with sidebar
  return (
    <div className="min-h-screen bg-background flex">
      <aside className="w-64 bg-card border-r flex flex-col">
        <div className="p-4 border-b">
          <Link href="/">
            <div className="flex items-center gap-2 cursor-pointer">
              <div>
                <span className="font-bold text-lg">JunoTalk</span>
                <p className="text-xs text-muted-foreground">Management Platform</p>
              </div>
            </div>
          </Link>
        </div>

        <nav className="flex-1 p-4 space-y-1" data-testid="portal-nav">
          {navItems.map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveSection(item.id)}
              data-testid={`nav-${item.id}`}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                activeSection === item.id
                  ? "bg-primary text-primary-foreground"
                  : "hover-elevate"
              }`}
            >
              <item.icon className="w-4 h-4" />
              {item.label}
            </button>
          ))}
        </nav>

        <div className="p-4 border-t">
          <Link href="/">
            <BackTriangle onClick={() => {}} testId="button-sidebar-back" />
          </Link>
        </div>
      </aside>

      <div className="flex-1 flex flex-col">
        <header className="h-14 border-b bg-card flex flex-wrap items-center justify-between gap-4 px-6" data-testid="portal-header">
          <div className="flex items-center gap-4">
            <Badge variant="outline" className="gap-1" data-testid="badge-environment">
              <div className="w-2 h-2 rounded-full bg-blue-600/80" />
              Live
            </Badge>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm text-muted-foreground" data-testid="text-user-name">
              {safeDisplayName(user?.firstName, user?.lastName)}
            </span>
          </div>
        </header>

        <main className="flex-1 overflow-auto p-6">
          {activeSection === "dashboard" && <SectionBoundary label="Dashboard"><DashboardSection /></SectionBoundary>}
          {activeSection === "modules" && <SectionBoundary label="Modules"><ModulesSection /></SectionBoundary>}
          {activeSection === "integration" && <SectionBoundary label="Integration"><IntegrationSection /></SectionBoundary>}
          {activeSection === "api-keys" && <SectionBoundary label="API Keys"><ApiKeysSection /></SectionBoundary>}
          {activeSection === "claude-ai" && <SectionBoundary label="Claude AI"><ClaudeAISection /></SectionBoundary>}

          {activeSection === "settings" && <SectionBoundary label="Settings"><SettingsSection /></SectionBoundary>}
          {activeSection === "docs" && <SectionBoundary label="Docs"><DocsSection /></SectionBoundary>}
          {activeSection === "tickets" && <SectionBoundary label="Tickets"><SupportTicketsSection /></SectionBoundary>}
          {activeSection === "feedback" && <SectionBoundary label="Feedback"><UserFeedbackSection /></SectionBoundary>}
        </main>
      </div>
    </div>
  );
}
