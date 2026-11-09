import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";
import { cn } from "../../lib/cn";

type Tone = "info" | "success" | "error";
interface Toast {
  id: number;
  message: ReactNode;
  tone: Tone;
}
interface ToastCtx {
  toast: (message: ReactNode, tone?: Tone) => void;
}
const Ctx = createContext<ToastCtx | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);
  const toast = useCallback((message: ReactNode, tone: Tone = "info") => {
    const id = ++seq.current;
    setToasts((ts) => [...ts, { id, message, tone }]);
    setTimeout(
      () => setToasts((ts) => ts.filter((t) => t.id !== id)),
      tone === "error" ? 6000 : 3500,
    );
  }, []);
  const value = useMemo(() => ({ toast }), [toast]);
  return (
    <Ctx.Provider value={value}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-center gap-2 p-4 safe-bottom"
        aria-live="polite"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className={cn(
              "pointer-events-auto max-w-md rounded-xl border px-4 py-3 text-sm shadow-lg",
              t.tone === "error" && "border-danger-500/40 bg-danger-500/10 text-fg",
              t.tone === "success" && "border-ok-500/40 bg-ok-500/10 text-fg",
              t.tone === "info" && "border-line bg-elev text-fg",
            )}
          >
            {t.message}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast(): ToastCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useToast outside ToastProvider");
  return v;
}
