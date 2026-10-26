interface ErrorStateProps {
  message: string;
  onRetry: () => void;
}

export function ErrorState({ message, onRetry }: ErrorStateProps) {
  return (
    <div className="flex flex-col items-center gap-3 py-16 text-center">
      <p className="text-danger">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="min-h-11 min-w-11 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-accent-text hover:opacity-90 focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
      >
        Retry
      </button>
    </div>
  );
}
