import { Component, type ReactNode } from "react";

interface Props {
  /** Shown in the fallback, e.g. "details". */
  area: string;
  children: ReactNode;
}

/** Keeps a rendering error in one part of the UI from blanking the whole window. */
export class ErrorBoundary extends Component<Props, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="error-boundary">
        <span className="error-text">[!] the {this.props.area} view hit an error: {this.state.error.message}</span>
        <button className="btn" onClick={() => this.setState({ error: null })}>
          retry
        </button>
        <button className="btn ghost" onClick={() => location.reload()}>
          reload window
        </button>
      </div>
    );
  }
}
