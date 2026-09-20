import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

type FinishActivity = () => void;
const MIN_VISIBLE_MS = 300;

interface ActivityProgressContextValue {
  startActivity: (label?: string) => FinishActivity;
}

const ActivityProgressContext = createContext<ActivityProgressContextValue | null>(null);

function nextFrame(callback: () => void): void {
  window.requestAnimationFrame(callback);
}

export function ActivityProgressProvider({ children }: { children: ReactNode }) {
  const activeCountRef = useRef(0);
  const [activeCount, setActiveCount] = useState(0);

  const startActivity = useCallback((_label?: string): FinishActivity => {
    const startedAt = Date.now();
    activeCountRef.current += 1;
    setActiveCount(activeCountRef.current);
    let finished = false;

    return () => {
      if (finished) return;
      finished = true;
      const remainingMs = Math.max(0, MIN_VISIBLE_MS - (Date.now() - startedAt));
      window.setTimeout(() => {
        nextFrame(() => {
          activeCountRef.current = Math.max(0, activeCountRef.current - 1);
          setActiveCount(activeCountRef.current);
        });
      }, remainingMs);
    };
  }, []);

  useEffect(() => {
    const originalFetch = window.fetch.bind(window);
    const trackedFetch: typeof window.fetch = (input, init) => {
      const finishActivity = startActivity("Network request");
      return originalFetch(input, init).finally(finishActivity);
    };

    window.fetch = trackedFetch;
    return () => {
      if (window.fetch === trackedFetch) {
        window.fetch = originalFetch;
      }
    };
  }, [startActivity]);

  const contextValue = useMemo(
    () => ({ startActivity }),
    [startActivity],
  );

  return (
    <ActivityProgressContext.Provider value={contextValue}>
      {activeCount > 0 && (
        <div
          role="progressbar"
          aria-label="Activity in progress"
          aria-valuetext="Working"
          data-activity-progress="true"
          className="pointer-events-none fixed inset-x-0 top-0 z-[9999] h-1 overflow-hidden border-b border-primary/50 bg-primary/25"
        >
          <div className="activity-progress-indicator h-full w-1/2 bg-primary shadow-[0_0_8px_hsl(var(--primary))]" />
        </div>
      )}
      {children}
    </ActivityProgressContext.Provider>
  );
}

export function useActivityProgress(): ActivityProgressContextValue {
  const context = useContext(ActivityProgressContext);
  if (!context) {
    throw new Error("useActivityProgress must be used within ActivityProgressProvider");
  }
  return context;
}