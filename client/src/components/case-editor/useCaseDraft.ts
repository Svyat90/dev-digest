import { useCallback, useEffect, useMemo, useState } from "react";
import { validateCaseDraft, type CaseDraftCheck, type EvalCaseDraft } from "@devdigest/shared";
import { isDirty } from "./draft";

const DEBOUNCE_MS = 300;

export interface CaseDraftState {
  draft: EvalCaseDraft;
  /** Validation of the debounced draft (spec NFR Latency: 300 ms after typing stops). */
  check: CaseDraftCheck;
  dirty: boolean;
  /** The last saved draft; null until the case exists. */
  saved: EvalCaseDraft | null;
  update: (patch: Partial<EvalCaseDraft>) => void;
  markSaved: (draft: EvalCaseDraft) => void;
  /** Validate the current draft now, skipping the debounce. */
  flush: () => void;
}

/** The editor's draft, its debounced copy and the shared validation run on it. */
export function useCaseDraft(
  initial: EvalCaseDraft,
  initialSaved: EvalCaseDraft | null,
  otherNames: readonly string[],
): CaseDraftState {
  const [draft, setDraft] = useState(initial);
  const [debounced, setDebounced] = useState(initial);
  const [saved, setSaved] = useState(initialSaved);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(draft), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [draft]);

  const check = useMemo(() => validateCaseDraft(debounced, otherNames), [debounced, otherNames]);
  const update = useCallback((patch: Partial<EvalCaseDraft>) => setDraft((d) => ({ ...d, ...patch })), []);
  const flush = useCallback(() => setDebounced(draft), [draft]);

  return { draft, check, dirty: isDirty(draft, saved), saved, update, markSaved: setSaved, flush };
}
