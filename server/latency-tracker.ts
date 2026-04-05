// Latency and performance tracking for message flow through the system
// Tracks: client send → server receive → transcription result
// Accounts for network jitter and measures end-to-end timing

interface LatencyMetric {
  messageId: string;
  clientTimestamp: number;
  serverReceiveTime: number;
  transcriptionStartTime?: number;
  transcriptionEndTime?: number;
  networkLatency?: number; // client→server
  transcriptionLatency?: number; // transcription processing
  totalE2ELatency?: number; // client send → transcription complete
  jitterEstimate?: number;
}

const latencyMetrics = new Map<string, LatencyMetric>();
const windowMetrics: number[] = []; // Track all latencies for jitter analysis

export function recordClientSendTime(messageId: string, clientTimestamp: number) {
  if (!latencyMetrics.has(messageId)) {
    latencyMetrics.set(messageId, {
      messageId,
      clientTimestamp,
      serverReceiveTime: 0,
    });
  }
}

export function recordServerReceiveTime(messageId: string) {
  const metric = latencyMetrics.get(messageId);
  if (metric) {
    metric.serverReceiveTime = Date.now();
    metric.networkLatency = metric.serverReceiveTime - metric.clientTimestamp;
    
    console.log(
      `[LatencyTracker] Message ${messageId.slice(0, 8)}: ` +
      `Network latency = ${metric.networkLatency}ms`
    );
  }
}

export function recordTranscriptionStart(messageId: string) {
  const metric = latencyMetrics.get(messageId);
  if (metric) {
    metric.transcriptionStartTime = Date.now();
  }
}

export function recordTranscriptionEnd(messageId: string) {
  const metric = latencyMetrics.get(messageId);
  if (metric && metric.transcriptionStartTime) {
    metric.transcriptionEndTime = Date.now();
    metric.transcriptionLatency = metric.transcriptionEndTime - metric.transcriptionStartTime;
    metric.totalE2ELatency = metric.transcriptionEndTime - metric.clientTimestamp;
    
    // Track for jitter analysis
    windowMetrics.push(metric.totalE2ELatency);
    if (windowMetrics.length > 100) windowMetrics.shift(); // Keep last 100
    
    // Calculate jitter (standard deviation of recent measurements)
    const jitter = calculateJitter(windowMetrics);
    metric.jitterEstimate = jitter;
    
    const inWindow = metric.totalE2ELatency >= 3000 && metric.totalE2ELatency <= 6000;
    const status = inWindow ? "✓ IN-WINDOW" : "⚠ OUT-OF-WINDOW";
    
    console.log(
      `[LatencyTracker] Message ${messageId.slice(0, 8)}: ` +
      `${status} | Network: ${metric.networkLatency}ms | ` +
      `Transcription: ${metric.transcriptionLatency}ms | ` +
      `Total E2E: ${metric.totalE2ELatency}ms | ` +
      `Jitter (σ): ${jitter.toFixed(0)}ms`
    );

    // Detailed breakdown log
    console.log(`[LatencyTracker] Breakdown:
  - Client timestamp: ${metric.clientTimestamp}
  - Server received: ${metric.serverReceiveTime} (+${metric.networkLatency}ms)
  - Transcription started: ${metric.transcriptionStartTime}
  - Transcription ended: ${metric.transcriptionEndTime} (+${metric.transcriptionLatency}ms)
  - Total E2E: ${metric.totalE2ELatency}ms
  - Window: [3000ms - 6000ms]
  - Deviation from window: ${
    metric.totalE2ELatency < 3000 
      ? `${3000 - metric.totalE2ELatency}ms EARLY`
      : metric.totalE2ELatency > 6000
      ? `${metric.totalE2ELatency - 6000}ms LATE`
      : "IN-WINDOW"
  }`);
  }
}

function calculateJitter(latencies: number[]): number {
  if (latencies.length < 2) return 0;
  
  const mean = latencies.reduce((a, b) => a + b, 0) / latencies.length;
  const variance = latencies.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / latencies.length;
  return Math.sqrt(variance); // Standard deviation
}

export function getLatencyMetric(messageId: string): LatencyMetric | undefined {
  return latencyMetrics.get(messageId);
}

export function getLatencyStats() {
  const metrics = Array.from(latencyMetrics.values()).filter(m => m.totalE2ELatency);
  
  if (metrics.length === 0) return null;
  
  const e2eLatencies = metrics.map(m => m.totalE2ELatency!);
  const networkLatencies = metrics.map(m => m.networkLatency!);
  const transcriptionLatencies = metrics.filter(m => m.transcriptionLatency).map(m => m.transcriptionLatency!);
  
  const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
  const min = (arr: number[]) => Math.min(...arr);
  const max = (arr: number[]) => Math.max(...arr);
  
  const inWindow = metrics.filter(m => m.totalE2ELatency! >= 3000 && m.totalE2ELatency! <= 6000).length;
  const outOfWindow = metrics.length - inWindow;
  
  return {
    totalMessages: metrics.length,
    e2eLatency: {
      avg: avg(e2eLatencies).toFixed(0),
      min: min(e2eLatencies),
      max: max(e2eLatencies),
    },
    networkLatency: {
      avg: avg(networkLatencies).toFixed(0),
      min: min(networkLatencies),
      max: max(networkLatencies),
    },
    transcriptionLatency: transcriptionLatencies.length > 0 ? {
      avg: avg(transcriptionLatencies).toFixed(0),
      min: min(transcriptionLatencies),
      max: max(transcriptionLatencies),
    } : null,
    windowCompliance: {
      inWindow,
      outOfWindow,
      complianceRate: ((inWindow / metrics.length) * 100).toFixed(1) + "%",
    },
    jitterEstimate: windowMetrics.length > 0 ? calculateJitter(windowMetrics).toFixed(0) + "ms" : "N/A",
  };
}

export function clearLatencyMetrics() {
  latencyMetrics.clear();
  windowMetrics.length = 0;
}
