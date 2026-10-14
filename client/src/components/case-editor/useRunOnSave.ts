import { useCallback, useState } from "react";

const STORAGE_KEY = "dd-eval-run-on-save";

function readStored(): boolean {
  try {
    return typeof window !== "undefined" && window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

/** The "Run on save" toggle, off by default and remembered per browser. */
export function useRunOnSave(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(readStored);
  const set = useCallback((next: boolean) => {
    setOn(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
    } catch {
      // Storage unavailable (private mode): the toggle still works for this dialog.
    }
  }, []);
  return [on, set];
}
