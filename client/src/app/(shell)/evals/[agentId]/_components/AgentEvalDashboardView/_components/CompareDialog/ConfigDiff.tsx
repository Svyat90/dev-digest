import { useTranslations } from "next-intl";
import type { EvalConfigChange, EvalSkillChange } from "@devdigest/shared";
import { DiffLines } from "./DiffLines";
import { s } from "./styles";

function SkillChange({ change }: { change: EvalSkillChange }) {
  const t = useTranslations("eval");
  const label =
    change.change === "added"
      ? t("compare.skillAdded", { name: change.name, version: change.to_version ?? 0 })
      : change.change === "removed"
        ? t("compare.skillRemoved", { name: change.name, version: change.from_version ?? 0 })
        : t("compare.skillVersionChanged", {
            name: change.name,
            from: change.from_version ?? 0,
            to: change.to_version ?? 0,
          });
  // The side that does not exist is the empty text; an existing side with no stored body is unavailable.
  const beforeMissing = change.change !== "added" && change.from_body == null;
  const afterMissing = change.change !== "removed" && change.to_body == null;
  return (
    <div style={s.change}>
      <div style={s.changeLine}>{label}</div>
      {beforeMissing || afterMissing ? (
        <div style={s.muted}>{t("compare.bodyUnavailable")}</div>
      ) : (
        <DiffLines before={change.from_body ?? ""} after={change.to_body ?? ""} />
      )}
    </div>
  );
}

/** Provider / model / strategy changes and per-skill changes with body diffs. */
export function ConfigDiff({
  configChanges,
  skillChanges,
}: {
  configChanges: EvalConfigChange[];
  skillChanges: EvalSkillChange[];
}) {
  const t = useTranslations("eval");
  if (configChanges.length === 0 && skillChanges.length === 0) {
    return <div style={s.muted}>{t("compare.noConfigChanges")}</div>;
  }
  return (
    <div style={s.section}>
      {configChanges.map((c) => (
        <div key={c.field} style={s.changeLine}>
          {t("compare.configChange", {
            field: t(`compare.field.${c.field}`),
            from: c.from,
            to: c.to,
          })}
        </div>
      ))}
      {skillChanges.map((c) => (
        <SkillChange key={c.skill_id} change={c} />
      ))}
    </div>
  );
}
