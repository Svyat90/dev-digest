"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Button, Modal, Skeleton } from "@devdigest/ui";
import { validateCaseDraft, type EvalCaseDetail, type EvalCaseDraft, type EvalCaseIssue, type EvalCaseOwner } from "@devdigest/shared";
import { useCreateEvalCaseDraft, useEvalCase, useStartEvalCaseCheck, useUpdateEvalCase } from "@/lib/hooks/eval-cases";
import { useKeydown } from "@/lib/hooks/useKeydown";
import { LastRunLine, rateLimitedUntil } from "@/components/eval-suite";
import { DiffInput } from "./DiffInput";
import { ExpectationFields } from "./ExpectationFields";
import { ExpectedOutputEditor } from "./ExpectedOutputEditor";
import { firstIssue, issueMessageKey, issueValues } from "./helpers";
import { draftFromDetail, emptyDraft, refusalKey, runCaseBlocker, serverIssuesOf } from "./draft";
import { useCaseDraft } from "./useCaseDraft";
import { useRunOnSave } from "./useRunOnSave";
import { s } from "./styles";
import { ds } from "./dialogStyles";

export interface CaseEditorProps {
  owner: EvalCaseOwner;
  ownerName: string;
  caseId: string | null;
  otherNames: readonly string[];
  runBlocker: "noAgent" | null;
  viaAgentName: string | null;
  returnFocusTo: HTMLElement | null;
  onClose: () => void;
}

/** The Case Editor dialog (SPEC-06): write or edit one eval case of an agent or a skill. */
export function CaseEditor(props: CaseEditorProps) {
  const { owner, ownerName, caseId, returnFocusTo, onClose } = props;
  const t = useTranslations("eval");
  const loaded = useEvalCase(owner, caseId);
  const focusRef = useRef(returnFocusTo);
  useKeydown((e) => {
    if (e.key === "Escape") onClose();
  });
  useEffect(() => () => focusRef.current?.focus(), []);

  const subtitle = t(owner.kind === "skill" ? "caseEditor.ownerSkill" : "caseEditor.ownerAgent", { name: ownerName });
  if (caseId !== null && !loaded.data) {
    return (
      <div onClick={(e) => e.stopPropagation()}>
        <Modal width={860} title={t("caseEditor.caseTitle", { name: "…" })} subtitle={subtitle} onClose={onClose}>
          <div style={ds.body}>
            {loaded.isError ? <div role="alert" style={ds.alert}>{t("caseEditor.errors.generic")}</div> : <Skeleton height={240} />}
          </div>
        </Modal>
      </div>
    );
  }
  return <EditorForm {...props} subtitle={subtitle} initialDetail={loaded.data ?? null} />;
}

function EditorForm({ owner, otherNames, runBlocker, viaAgentName, onClose, subtitle, initialDetail }: CaseEditorProps & { subtitle: string; initialDetail: EvalCaseDetail | null }) {
  const t = useTranslations("eval");
  const nameId = useId();
  const hintId = useId();
  const [savedId, setSavedId] = useState(initialDetail?.id ?? null);
  const detail = useEvalCase(owner, savedId).data ?? initialDetail;
  const [initialDraft] = useState(() => (initialDetail ? draftFromDetail(initialDetail) : emptyDraft()));
  const { draft, check, dirty, saved, update, markSaved, flush } = useCaseDraft(initialDraft, initialDetail ? initialDraft : null, otherNames);
  const [runOnSave, setRunOnSave] = useRunOnSave();
  const [serverIssues, setServerIssues] = useState<EvalCaseIssue[]>([]);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [limitedUntil, setLimitedUntil] = useState<number | null>(null);
  const create = useCreateEvalCaseDraft(owner);
  const updateCase = useUpdateEvalCase(owner);
  const startCheck = useStartEvalCaseCheck(owner);

  useEffect(() => {
    if (limitedUntil === null) return;
    const timer = setTimeout(() => setLimitedUntil(null), Math.max(0, limitedUntil - Date.now()));
    return () => clearTimeout(timer);
  }, [limitedUntil]);

  // A finding-made case keeps its content (AC10): only the name is checked and editable.
  const readOnly = detail?.origin === "finding";
  const ownIssues = (list: readonly EvalCaseIssue[]) => (readOnly ? list.filter((i) => i.field === "name") : list);
  const issues = [...ownIssues(check.issues), ...serverIssues];
  const nameIssue = firstIssue(issues, "name");
  const saving = create.isPending || updateCase.isPending;
  const blocker = runCaseBlocker({
    isNew: savedId === null,
    dirty,
    checkRunning: detail?.check?.status === "running",
    rateLimitedUntil: limitedUntil,
    nowMs: Date.now(),
    runBlocker,
  });

  const edit = (patch: Partial<EvalCaseDraft>) => {
    update(patch);
    setServerIssues([]);
  };

  const runCheck = async (id: string) => {
    setRefusal(null);
    try {
      await startCheck.mutateAsync(id);
    } catch (err) {
      const until = rateLimitedUntil(err, Date.now());
      if (until !== null) setLimitedUntil(until);
      else setRefusal(refusalKey(err));
    }
  };

  const onSave = async () => {
    if (ownIssues(validateCaseDraft(draft, otherNames).issues).length > 0) return flush();
    setRefusal(null);
    try {
      const res = savedId === null ? await create.mutateAsync(draft) : await updateCase.mutateAsync({ caseId: savedId, draft });
      markSaved(draft);
      setSavedId(res.case.id);
      if (runOnSave) await runCheck(res.case.id);
    } catch (err) {
      const fromServer = serverIssuesOf(err);
      if (fromServer !== null) setServerIssues(fromServer);
      else setRefusal(refusalKey(err));
    }
  };

  const title = savedId === null ? t("caseEditor.newCase") : t("caseEditor.caseTitle", { name: detail?.name ?? saved?.name ?? "" });
  const footer = (
    <div style={ds.footer}>
      <div style={ds.footerStart}>
        <button type="button" role="switch" aria-checked={runOnSave} onClick={() => setRunOnSave(!runOnSave)} style={ds.switch}>
          <span aria-hidden style={ds.track(runOnSave)}>
            <span style={ds.knob(runOnSave)} />
          </span>
          {t("caseEditor.runOnSave")}
        </button>
        {viaAgentName !== null && <span style={ds.muted}>{t("caseEditor.viaAgent", { name: viaAgentName })}</span>}
      </div>
      {refusal !== null && (
        <span role="alert" style={ds.alert}>
          {t(`caseEditor.errors.${refusal}`)}
        </span>
      )}
      {blocker !== null && (
        <span id={hintId} style={ds.muted}>
          {t(`caseEditor.runBlocked.${blocker}`)}
        </span>
      )}
      <Button kind="ghost" onClick={onClose}>
        {t("caseEditor.cancel")}
      </Button>
      <Button
        disabled={blocker !== null}
        aria-describedby={blocker !== null ? hintId : undefined}
        loading={startCheck.isPending}
        onClick={() => savedId !== null && void runCheck(savedId)}
      >
        {t("caseEditor.runCase")}
      </Button>
      <Button kind="primary" aria-label={t("caseEditor.save")} disabled={issues.length > 0 || saving} onClick={() => void onSave()}>
        {t(saving ? "caseEditor.saving" : "caseEditor.save")}
      </Button>
    </div>
  );

  return (
    <div onClick={(e) => e.stopPropagation()}>
      <Modal width={860} title={title} subtitle={subtitle} onClose={onClose} footer={footer}>
        <div style={ds.body}>
          <div style={ds.name}>
            <label htmlFor={nameId} style={s.label}>
              {t("caseEditor.nameLabel")}
            </label>
            <input
              id={nameId}
              type="text"
              aria-label={t("caseEditor.nameLabel")}
              aria-invalid={nameIssue !== null}
              aria-describedby={nameIssue !== null ? `${nameId}-issue` : undefined}
              value={draft.name}
              placeholder={t("caseEditor.namePlaceholder")}
              onChange={(e) => edit({ name: e.target.value })}
              style={s.field(nameIssue !== null)}
            />
            {nameIssue !== null && (
              <div id={`${nameId}-issue`} role="alert" style={s.issue}>
                {t(issueMessageKey(nameIssue), issueValues(nameIssue))}
              </div>
            )}
          </div>
          {readOnly && <div style={ds.muted}>{t("caseEditor.fromFindingHint")}</div>}
          <span style={s.label}>{t("caseEditor.inputLabel")}</span>
          <DiffInput
            diff={draft.input_diff}
            prTitle={draft.pr_title}
            prDescription={draft.pr_description}
            parse={check.diff}
            issues={issues}
            readOnly={readOnly}
            onChange={edit}
          />
          <ExpectationFields
            expectationType={draft.expectation_type}
            expectation={draft.expectation}
            files={check.diff.files}
            issues={issues}
            readOnly={readOnly}
            onChange={edit}
          />
          <ExpectedOutputEditor
            value={draft.expected_output_json}
            expectationType={draft.expectation_type}
            expectation={draft.expectation}
            issue={firstIssue(issues, "expected_output")}
            readOnly={readOnly}
            onChange={(v) => edit({ expected_output_json: v })}
          />
          <LastRunLine lastRun={detail?.last_run ?? null} running={detail?.check?.status === "running"} />
        </div>
      </Modal>
    </div>
  );
}
