import { Component, ReactNode } from "react";

interface Props {
  label?: string;
  children: ReactNode;
}
interface State {
  hasError: boolean;
  errorMsg: string;
}

export default class SectionBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, errorMsg: "" };
  }
  static getDerivedStateFromError(err: any): State {
    return { hasError: true, errorMsg: err?.message || "Unknown error" };
  }
  retry = () => this.setState({ hasError: false, errorMsg: "" });
  render() {
    if (this.state.hasError) {
      return (
        <div
          className="rounded-xl flex flex-col items-center justify-center gap-2 py-4"
          style={{ background: "rgba(18,38,88,0.5)", border: "1px solid rgba(99,155,255,0.15)" }}
        >
          <p className="text-white/40 text-[11px]">{this.props.label || "Section"} could not load</p>
          <button
            onClick={this.retry}
            className="px-3 py-1 rounded-full text-[10px] font-semibold text-white"
            style={{ background: "rgba(96,165,250,0.25)", border: "1px solid rgba(96,165,250,0.4)" }}
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
