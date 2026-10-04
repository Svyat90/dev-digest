"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Skeleton, ErrorState } from "@devdigest/ui";
import { DocPreview } from "@/components/project-context";
import { useAgents, useSkills } from "@/lib/hooks";
import {
  useContextDoc,
  useContextDocUsage,
  useAttachDocToAgent,
  useAttachDocToSkill,
} from "@/lib/hooks/project-context";
import { s } from "../../styles";

/** Appends the document to the chosen owner once, then clears the pending pick.
   The mutation hooks are bound to an owner id, so they live here, keyed by the pick. */
function AttachRunner({
  kind,
  id,
  path,
  onDone,
}: {
  kind: "agent" | "skill";
  id: string;
  path: string;
  onDone: () => void;
}) {
  const attachAgent = useAttachDocToAgent(kind === "agent" ? id : null);
  const attachSkill = useAttachDocToSkill(kind === "skill" ? id : null);
  useEffect(() => {
    (kind === "agent" ? attachAgent : attachSkill).mutate(path);
    onDone();
    // Runs once per pick.
  }, []);
  return null;
}

/** Preview, usage count and "Attach to…" for the selected document. */
export function DocDetail({
  repoId,
  path,
  onClose,
}: {
  repoId: string;
  path: string;
  onClose: () => void;
}) {
  const t = useTranslations("context");
  const doc = useContextDoc(repoId, path);
  const usage = useContextDocUsage(path);
  const agents = useAgents();
  const skills = useSkills();
  const [pending, setPending] = useState<{ kind: "agent" | "skill"; id: string } | null>(null);

  const pick = (value: string) => {
    const [kind, id] = value.split(":");
    if (id && (kind === "agent" || kind === "skill")) setPending({ kind, id });
  };

  return (
    <div style={s.detail}>
      <div style={s.detailMeta}>
        {usage.data ? (
          <span>
            {t("docs.usedBy", { agents: usage.data.agents.length, skills: usage.data.skills.length })}
          </span>
        ) : null}
        <select
          aria-label={t("docs.attachTo")}
          style={s.select}
          value=""
          onChange={(e) => pick(e.target.value)}
        >
          <option value="">{t("docs.attachTo")}</option>
          <optgroup label={t("docs.attachAgents")}>
            {(agents.data ?? []).map((a) => (
              <option key={a.id} value={`agent:${a.id}`}>
                {a.name}
              </option>
            ))}
          </optgroup>
          <optgroup label={t("docs.attachSkills")}>
            {(skills.data ?? []).map((sk) => (
              <option key={sk.id} value={`skill:${sk.id}`}>
                {sk.name}
              </option>
            ))}
          </optgroup>
        </select>
      </div>
      {pending ? (
        <AttachRunner kind={pending.kind} id={pending.id} path={path} onDone={() => setPending(null)} />
      ) : null}
      {doc.isLoading ? <Skeleton height={160} /> : null}
      {doc.isError ? <ErrorState title={t("docs.previewError")} /> : null}
      {doc.data ? <DocPreview path={doc.data.path} content={doc.data.content} onClose={onClose} /> : null}
    </div>
  );
}
