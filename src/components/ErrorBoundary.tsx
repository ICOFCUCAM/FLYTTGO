import React, { Component, ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * Top-level React error boundary.
 *
 * Without this, any uncaught exception in a child component blanks
 * the entire app to a white screen — bad UX and worse for trust.
 * This catches the error, logs it (so it shows up in browser dev
 * tools and any future error-tracking provider), and renders a
 * branded fallback with a "Reload" button.
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    /* eslint-disable-next-line no-console */
    console.error('[FlyttGo] Uncaught error:', error, info.componentStack);
    /* TODO: forward to Sentry / Logsnag / your error tracker once one is wired up. */
  }

  handleReload = () => {
    if (typeof window !== 'undefined') window.location.reload();
  };

  handleHome = () => {
    if (typeof window !== 'undefined') window.location.assign('/');
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-sm border border-gray-100 p-8 text-center">
          <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-5">
            <svg className="w-7 h-7 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.732-.833-2.5 0L4.268 16.5C3.498 18.333 4.46 20 6 20z" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-gray-900 mb-2">Something went wrong</h1>
          <p className="text-gray-500 text-sm mb-1">
            FlyttGo ran into an unexpected error. Reloading the page should fix it.
          </p>
          {this.state.error?.message && (
            <p className="text-xs text-gray-400 font-mono mt-2 mb-5 break-words">
              {this.state.error.message}
            </p>
          )}

          <div className="flex flex-col sm:flex-row gap-3 mt-6">
            <button
              onClick={this.handleReload}
              className="flex-1 py-2.5 bg-emerald-600 text-white rounded-xl font-semibold hover:bg-emerald-700 transition"
            >
              Reload
            </button>
            <button
              onClick={this.handleHome}
              className="flex-1 py-2.5 border border-gray-200 text-gray-700 rounded-xl font-semibold hover:bg-gray-50 transition"
            >
              Back to home
            </button>
          </div>

          <p className="text-xs text-gray-400 mt-6">
            If this keeps happening, contact <a href="mailto:support@flyttgo.no" className="text-emerald-600 hover:underline">support@flyttgo.no</a>.
          </p>
        </div>
      </div>
    );
  }
}
