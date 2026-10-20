/* EvalCaseAction — "Turn into eval case" under a finding's accept/dismiss row.
   Rendered only by FindingCard; stateless, the owner supplies the mutation. */
"use client";

import { useTranslations } from "next-intl";
import { Button } from "@devdigest/ui";
import { EvalErrorCode } from "@devdigest/shared";
import { s } from "./styles";

export interface EvalCaseControl {
  onCreate: () => void;
  pending: boolean;
  errorCode: string | null;
}

export function EvalCaseAction({
  findingId,
  decided,
  exists,
  control,
}: {
  findingId: string;
  decided: boolean;
  exists: boolean;
  control: EvalCaseControl;
}) {
  const t = useTranslations("prReview");
  const hintId = `eval-case-hint-${findingId}`;
  const known = EvalErrorCode.safeParse(control.errorCode);
  const errorKey = control.errorCode ? (known.success ? known.data : "generic") : null;

  if (exists) {
    return <div style={s.evalNote}>{t("finding.evalCase.exists")}</div>;
  }

  return (
    <>
      <div style={s.actions}>
        <Button
          kind="secondary"
          size="sm"
          icon="FlaskConical"
          disabled={!decided || control.pending}
          aria-describedby={decided ? undefined : hintId}
          onClick={() => control.onCreate()}
        >
          {control.pending ? t("finding.evalCase.creating") : t("finding.evalCase.action")}
        </Button>
      </div>
      {!decided && (
        <div id={hintId} style={s.evalNote}>
          {t("finding.evalCase.undecidedHint")}
        </div>
      )}
      {errorKey && (
        <div role="alert" style={s.evalError}>
          {t(`finding.evalCase.errors.${errorKey}`)}
        </div>
      )}
    </>
  );
}
