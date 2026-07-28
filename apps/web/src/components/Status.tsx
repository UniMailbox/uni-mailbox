import { AlertTriangle, CheckCircle2, LoaderCircle } from "lucide-react";

export function LoadingState({ label = "Loading" }: { label?: string }) {
  return (
    <div className="state-card" role="status">
      <LoaderCircle className="spin" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

export function ErrorState({
  error,
  retry,
}: {
  error: unknown;
  retry?: () => void;
}) {
  return (
    <div className="state-card error-state" role="alert">
      <AlertTriangle aria-hidden="true" />
      <div>
        <strong>That request did not complete</strong>
        <p>{error instanceof Error ? error.message : "Please try again."}</p>
      </div>
      {retry ? (
        <button className="button secondary" onClick={retry} type="button">
          Retry
        </button>
      ) : null}
    </div>
  );
}

export function SuccessNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="success-note" role="status">
      <CheckCircle2 aria-hidden="true" />
      {children}
    </div>
  );
}
