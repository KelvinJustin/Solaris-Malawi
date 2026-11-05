import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError } from "./api";
import { useAuth } from "./auth";

type State<T> =
  | { status: "loading"; data: null; error: null }
  | { status: "success"; data: T; error: null }
  | { status: "error"; data: null; error: unknown };

export type Resource<T> = State<T> & {
  /** Fetch again, showing the loading state while it runs. */
  reload: () => void;
};

/**
 * Loads data once on mount (and again when `key` changes or `reload()` is called) and reports
 * loading / success / error so every page handles the three cases the same way.
 *
 * A 401 means the session ended mid-use (token expired or revoked), so the app is told and the
 * auth gate sends the merchant back to the login page.
 */
export function useResource<T>(load: () => Promise<T>, key = ""): Resource<T> {
  const { expireSession } = useAuth();
  const [state, setState] = useState<State<T>>({ status: "loading", data: null, error: null });
  const [attempt, setAttempt] = useState(0);

  // Always call the latest loader without making it a dependency of the effect.
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    let cancelled = false; // ignore answers that arrive after unmount / a newer request
    setState({ status: "loading", data: null, error: null });
    loadRef
      .current()
      .then((data) => {
        if (!cancelled) setState({ status: "success", data, error: null });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (error instanceof ApiError && error.status === 401) expireSession();
        setState({ status: "error", data: null, error });
      });
    return () => {
      cancelled = true;
    };
  }, [key, attempt, expireSession]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  return useMemo(() => ({ ...state, reload }), [state, reload]);
}
