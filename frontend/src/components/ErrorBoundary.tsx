import React from "react";

type State = {
  message: string | null;
};

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { message: null };

  static getDerivedStateFromError(error: unknown): State {
    return { message: error instanceof Error ? error.message : String(error) };
  }

  componentDidCatch(error: unknown) {
    console.error("Page render failed", error);
  }

  render() {
    if (this.state.message) {
      return (
        <div className="page">
          <section className="card">
            <h2>Page Error</h2>
            <p className="subvalue">A telemetry field could not be rendered. The live connection is still running.</p>
            <pre className="error-box">{this.state.message}</pre>
          </section>
        </div>
      );
    }

    return this.props.children;
  }
}
