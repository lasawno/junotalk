import { Component, type ReactNode, type ErrorInfo } from "react";
import { RotateCcw, Home, WifiOff } from "lucide-react";

interface Props {
  children: ReactNode;
  fallbackTitle?: string;
  fallbackMessage?: string;
  onRetry?: () => void;
  /** Render nothing on error — silently log + auto-retry in background. Use for sub-components that must never interrupt the host page. */
  silent?: boolean;
}

interface State {
  hasError: boolean;
  error: Error | null;
  isAutoRecovering: boolean;
  autoRecoveryAttempt: number;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null, isAutoRecovering: false, autoRecoveryAttempt: 0 };
  private recoveryTimer: ReturnType<typeof setTimeout> | null = null;
  private lastUrl = typeof window !== "undefined" ? window.location.href : "";

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack);

    // Report to server (always, even in silent mode)
    try {
      fetch("/api/client-error", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: error.message,
          stack: error.stack?.slice(0, 2000),
          componentStack: info.componentStack?.slice(0, 2000),
          url: window.location.href,
          userAgent: navigator.userAgent,
          silent: !!this.props.silent,
        }),
      }).catch(() => {});
    } catch {}

    // Silent mode: just schedule a background retry — never show UI
    if (this.props.silent) {
      if (this.state.autoRecoveryAttempt < 5) {
        this.startAutoRecovery();
      }
      return;
    }

    // Chunk/module load failure → reload once, then show UI (avoid infinite reload loops)
    if (
      error.message?.includes("Failed to fetch dynamically imported module") ||
      error.message?.includes("Importing a module script failed") ||
      error.message?.includes("Loading chunk") ||
      error.message?.includes("Loading CSS chunk")
    ) {
      const key = "__retry_reload__";
      const last = Number(sessionStorage.getItem(key) || 0);
      if (Date.now() - last > 15000) {
        sessionStorage.setItem(key, String(Date.now()));
        window.location.reload();
        return;
      }
      // Already reloaded recently — fall through to show the error UI with a Tap to Reload button
    }

    // Transient network errors → auto-recover with backoff
    if (this.isTransientError(error) && this.state.autoRecoveryAttempt < 3) {
      this.startAutoRecovery();
    }
  }

  componentDidMount() {
    // Reset when the user navigates to a new page (wouter uses history API)
    window.addEventListener("popstate", this.handleNavigation);
    window.addEventListener("hashchange", this.handleNavigation);
  }

  componentWillUnmount() {
    if (this.recoveryTimer) clearTimeout(this.recoveryTimer);
    window.removeEventListener("popstate", this.handleNavigation);
    window.removeEventListener("hashchange", this.handleNavigation);
  }

  handleNavigation = () => {
    if (this.state.hasError && window.location.href !== this.lastUrl) {
      this.lastUrl = window.location.href;
      this.setState({ hasError: false, error: null, isAutoRecovering: false, autoRecoveryAttempt: 0 });
    }
  };

  private isTransientError(error: Error): boolean {
    const msg = error.message || "";
    return (
      msg.includes("Failed to fetch") ||
      msg.includes("Load failed") ||
      msg.includes("NetworkError") ||
      msg.includes("502:") || msg.includes("503:") || msg.includes("504:") ||
      msg.includes("ECONNREFUSED") || msg.includes("fetch")
    );
  }

  private startAutoRecovery() {
    this.setState({ isAutoRecovering: true });
    const delay = Math.min(2000 * Math.pow(1.5, this.state.autoRecoveryAttempt), 8000);
    this.recoveryTimer = setTimeout(() => {
      this.setState(prev => ({
        hasError: false, error: null, isAutoRecovering: false,
        autoRecoveryAttempt: prev.autoRecoveryAttempt + 1,
      }));
    }, delay);
  }

  handleRetry = () => {
    if (this.recoveryTimer) clearTimeout(this.recoveryTimer);
    if (this.props.onRetry) {
      this.setState({ hasError: false, error: null, isAutoRecovering: false, autoRecoveryAttempt: 0 });
      this.props.onRetry();
    } else {
      window.location.reload();
    }
  };

  handleGoHome = () => {
    if (this.recoveryTimer) clearTimeout(this.recoveryTimer);
    this.setState({ hasError: false, error: null, isAutoRecovering: false, autoRecoveryAttempt: 0 });
    window.location.href = "/";
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    // Silent mode: render nothing — error is logged + retried in background
    if (this.props.silent) return null;

    const isNetwork = this.state.error ? this.isTransientError(this.state.error) : false;

    // Auto-recovering spinner
    if (this.state.isAutoRecovering) {
      return (
        <div style={{
          position: "fixed", inset: 0, zIndex: 9999,
          background: "linear-gradient(160deg, #0a0f1e 0%, #0d1b3e 60%, #152a58 100%)",
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16,
        }}>
          <div style={{
            width: 48, height: 48, borderRadius: "50%",
            border: "3px solid rgba(96,165,250,0.2)",
            borderTopColor: "#60a5fa",
            animation: "junoBounce 0.8s linear infinite",
          }} />
          <style>{`@keyframes junoBounce { to { transform: rotate(360deg); } }`}</style>
          <p style={{ color: "rgba(255,255,255,0.5)", fontSize: 13, margin: 0 }}>Reconnecting…</p>
        </div>
      );
    }

    // Branded fallback page
    return (
      <div style={{
        position: "fixed", inset: 0, zIndex: 9999,
        background: "linear-gradient(160deg, #0a0f1e 0%, #0d1b3e 60%, #152a58 100%)",
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        padding: "24px",
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      }}>
        {/* Logo */}
        <div style={{ marginBottom: 32, textAlign: "center" }}>
          <div style={{ fontSize: 28, fontWeight: 800, letterSpacing: "-0.02em" }}>
            <span style={{ color: "#ffffff" }}>Juno</span>
            <span style={{ color: "#60a5fa" }}>Talk</span>
          </div>
        </div>

        {/* Error card */}
        <div style={{
          maxWidth: 340, width: "100%",
          background: "rgba(255,255,255,0.05)",
          backdropFilter: "blur(20px)",
          borderRadius: 20,
          border: "1px solid rgba(255,255,255,0.08)",
          padding: "28px 24px",
          textAlign: "center",
        }}>
          {/* Icon */}
          <div style={{
            width: 56, height: 56, borderRadius: "50%",
            background: isNetwork ? "rgba(251,191,36,0.12)" : "rgba(239,68,68,0.12)",
            display: "flex", alignItems: "center", justifyContent: "center",
            margin: "0 auto 18px",
          }}>
            {isNetwork
              ? <WifiOff size={26} color="#fbbf24" />
              : <span style={{ fontSize: 26 }}>⚠️</span>
            }
          </div>

          {/* Title */}
          <h2 style={{
            color: "#ffffff", fontSize: 18, fontWeight: 700,
            margin: "0 0 10px", lineHeight: 1.3,
          }} data-testid="error-title">
            {this.props.fallbackTitle || (isNetwork ? "Connection lost" : "Something went wrong")}
          </h2>

          {/* Message */}
          <p style={{
            color: "rgba(255,255,255,0.45)", fontSize: 13, lineHeight: 1.55,
            margin: "0 0 24px",
          }} data-testid="error-message">
            {this.props.fallbackMessage || (isNetwork
              ? "Check your connection and try again. Your data is safe."
              : "A temporary error occurred. Tap retry and you'll be right back."
            )}
          </p>

          {/* Buttons */}
          <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
            <button
              onClick={this.handleRetry}
              data-testid="button-retry"
              style={{
                display: "flex", alignItems: "center", gap: 7,
                background: "#3b82f6", color: "#fff",
                border: "none", borderRadius: 12,
                padding: "11px 20px", fontSize: 14, fontWeight: 600,
                cursor: "pointer", transition: "opacity 0.15s",
              }}
              onMouseEnter={e => (e.currentTarget.style.opacity = "0.85")}
              onMouseLeave={e => (e.currentTarget.style.opacity = "1")}
            >
              <RotateCcw size={15} />
              Retry
            </button>
            <button
              onClick={this.handleGoHome}
              data-testid="button-go-home"
              style={{
                display: "flex", alignItems: "center", gap: 7,
                background: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.75)",
                border: "1px solid rgba(255,255,255,0.12)", borderRadius: 12,
                padding: "11px 20px", fontSize: 14, fontWeight: 600,
                cursor: "pointer", transition: "opacity 0.15s",
              }}
              onMouseEnter={e => (e.currentTarget.style.opacity = "0.7")}
              onMouseLeave={e => (e.currentTarget.style.opacity = "1")}
            >
              <Home size={15} />
              Home
            </button>
          </div>
        </div>

        {/* Footer note */}
        <p style={{
          color: "rgba(255,255,255,0.18)", fontSize: 11, marginTop: 24, textAlign: "center",
        }}>
          If this keeps happening, contact support.
        </p>
      </div>
    );
  }
}
