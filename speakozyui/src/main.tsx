import { Component, StrictMode, type ErrorInfo, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import App from "./app/App";
import "./styles/app.css";

interface RootBoundaryState { error: Error | null }

class RootBoundary extends Component<{ children: ReactNode }, RootBoundaryState> {
  state: RootBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): RootBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Speakozy render failed", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    const detail = `${this.state.error.name}: ${this.state.error.message}`;
    return <main lang="ar" dir="rtl" style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24, background: "#f5f7fa", color: "#1e2d4d", fontFamily: "system-ui, sans-serif" }}>
      <section role="alert" style={{ width: "min(100%, 560px)", padding: 24, border: "1px solid #d8dee8", borderRadius: 18, background: "#fff", boxShadow: "0 12px 36px #1e2d4d18" }}>
        <h1 style={{ marginTop: 0 }}>حصل خطأ أثناء فتح النظام</h1>
        <p>بياناتك لم تتأثر. أعد تحميل الصفحة، وإذا تكرر الخطأ أرسل تفاصيله للدعم.</p>
        <button type="button" onClick={() => window.location.reload()} style={{ padding: "10px 16px", border: 0, borderRadius: 10, background: "#1e2d4d", color: "#fff", cursor: "pointer" }}>إعادة تحميل الصفحة</button>
        <details style={{ marginTop: 18 }}>
          <summary style={{ cursor: "pointer" }}>تفاصيل الخطأ</summary>
          <pre dir="ltr" style={{ overflowWrap: "anywhere", whiteSpace: "pre-wrap" }}>{detail}</pre>
        </details>
      </section>
    </main>;
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode><RootBoundary><App /></RootBoundary></StrictMode>
);
