import React from "react";
import { initialLanguage, translate } from "../i18n/core";

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
      const language = initialLanguage();
      return (
        <div className="page">
          <section className="card">
            <h2>{translate(language, "errors.pageError")}</h2>
            <p className="subvalue">{translate(language, "errors.renderFailed")}</p>
            <pre className="error-box">{this.state.message}</pre>
          </section>
        </div>
      );
    }

    return this.props.children;
  }
}
