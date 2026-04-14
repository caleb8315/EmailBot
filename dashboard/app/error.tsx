"use client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="min-h-screen bg-[#050505] flex items-center justify-center px-4">
      <div className="max-w-md w-full bg-[#0c0c0c] border border-red-500/20 rounded-xl p-6 text-center space-y-4">
        <p className="text-red-400 font-mono text-sm font-bold">Something went wrong</p>
        <p className="text-gray-400 text-xs break-all">{error.message}</p>
        {error.digest && (
          <p className="text-gray-600 text-[10px] font-mono">Digest: {error.digest}</p>
        )}
        <button
          onClick={reset}
          className="px-4 py-2 rounded-lg bg-[#00FF41]/10 text-[#00FF41] text-xs font-bold hover:bg-[#00FF41]/20 transition"
        >
          Try Again
        </button>
      </div>
    </div>
  );
}
