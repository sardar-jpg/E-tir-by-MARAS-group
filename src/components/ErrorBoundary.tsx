import React from "react";

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

/**
 * Wraps only the root <App /> render (see main.tsx). A render-time
 * exception anywhere in the tree below no longer white-screens the whole
 * app — it falls back to a minimal, static "Something went wrong" screen
 * with a manual reload. A boundary this high sits above App's own state
 * (session, language, routing), so it deliberately doesn't try to recover
 * into any app-specific view; a full reload is the only safe path back to
 * a known-good state.
 */
export default class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: unknown, errorInfo: React.ErrorInfo) {
    console.error("Uncaught application error:", error, errorInfo);
  }

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-6 font-sans">
          <div className="flex flex-col items-center gap-4 max-w-sm text-center">
            <h1 className="text-lg font-bold text-white">Something went wrong.</h1>
            <button
              type="button"
              onClick={this.handleReload}
              className="px-5 py-2.5 bg-orange-600 hover:bg-orange-700 text-white font-semibold rounded-xl shadow-lg transition-all cursor-pointer"
            >
              Reload Application
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
