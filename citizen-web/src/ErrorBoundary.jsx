import { Component } from "react";
import i18n from "./i18n";

export default class ErrorBoundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error, info) {
    console.error("Citizen application error", error, info.componentStack);
  }
  render() {
    if (this.state.failed)
      return (
        <main className="panel-card" role="alert">
          <h1>{i18n.t("appError")}</h1>
          <p>{i18n.t("appErrorHelp")}</p>
          <button onClick={() => window.location.reload()}>
            {i18n.t("retry")}
          </button>
        </main>
      );
    return this.props.children;
  }
}
