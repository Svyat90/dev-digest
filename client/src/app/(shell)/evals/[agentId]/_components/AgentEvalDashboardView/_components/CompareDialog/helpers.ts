import type { EvalPromotePreview } from "@devdigest/shared";

export type Translate = (key: string, values?: Record<string, string | number>) => string;

/** Lines of the Promote confirmation (AC22): what is replaced, which skill
   bodies are restored, which other agents change, which skills are left out.
   `t` is the `eval` namespace translator; the dialog renders lines with
   `white-space: pre-line`. */
export function promoteConfirmBody(preview: EvalPromotePreview, t: Translate): string {
  const lines = [t("compare.promoteReplaces", { version: preview.current_agent_version })];
  for (const s of preview.skills_to_restore) {
    lines.push(
      t("compare.promoteSkill", {
        name: s.name,
        current: s.current_version,
        recorded: s.recorded_version,
      }),
    );
  }
  if (preview.affected_agents.length > 0) {
    lines.push(
      t("compare.promoteAffects", { agents: preview.affected_agents.map((a) => a.name).join(", ") }),
    );
  }
  for (const d of preview.deleted_skills) {
    lines.push(t("compare.promoteDeleted", { name: d.name }));
  }
  return lines.join("\n");
}
