"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useActiveRepo } from "@/lib/repo-context";
import { formatTokenCount } from "@/lib/format";
import {
  useContextDoc,
  useContextDocs,
  useSetSkillContextDocs,
  useSkillContextDocs,
} from "@/lib/hooks/project-context";
import { AttachableDocList, DocPreview, mergeRows } from "@/components/project-context";
import { s } from "./styles";

/** Skill detail "Context" tab: attach repository documents to the skill. */
export function ContextTab({ skillId }: { skillId: string }) {
  const t = useTranslations("context");
  const { activeRepo } = useActiveRepo();
  const repoId = activeRepo?.id ?? null;
  const [q, setQ] = useState("");
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const docs = useContextDocs(repoId, q);
  const attached = useSkillContextDocs(skillId, repoId);
  const setDocs = useSetSkillContextDocs(skillId, repoId);
  const preview = useContextDoc(repoId, previewPath);

  if (!repoId) return <p style={s.note}>{t("docs.tab.noRepo")}</p>;

  const own = attached.data?.own ?? [];
  const savedPaths = own.map((d) => d.path);
  const needle = q.trim().toLowerCase();
  const rows = mergeRows(docs.data?.documents ?? [], own).filter(
    (r) => !needle || r.path.toLowerCase().includes(needle),
  );
  const serialized = ["## Project context", ...savedPaths].join("\n");

  return (
    <div style={s.wrap}>
      <h2 style={s.title}>{t("docs.skillTab.title")}</h2>
      <p style={s.note}>{t("docs.skillTab.inheritNote")}</p>
      <div style={s.toolbar}>
        <input
          type="search"
          style={s.filter}
          value={q}
          placeholder={t("docs.filterPlaceholder")}
          aria-label={t("docs.filterPlaceholder")}
          onChange={(e) => setQ(e.target.value)}
        />
        <Link href={`/repos/${repoId}/context`} style={s.link}>
          {t("docs.tab.openPage")}
        </Link>
      </div>
      <span style={s.meta}>
        {t("docs.tab.repoLabel", { repo: attached.data?.repo.full_name ?? activeRepo?.full_name ?? "" })}
        {" · "}
        {t("docs.tab.total", { tokens: formatTokenCount(attached.data?.total_tokens ?? 0) })}
      </span>
      {docs.data?.status === "not_cloned" ? <p style={s.note}>{t("docs.notCloned")}</p> : null}
      {docs.isError ? <p style={s.note}>{t("docs.loadError")}</p> : null}
      {docs.data && rows.length === 0 && docs.data.status === "ok" ? (
        <p style={s.note}>{q ? t("docs.noMatches") : t("docs.empty", { roots: docs.data.roots.join(", ") })}</p>
      ) : null}
      <AttachableDocList rows={rows} onChange={(paths) => setDocs.mutate(paths)} onPreview={setPreviewPath} />
      {previewPath && preview.data ? (
        <DocPreview path={previewPath} content={preview.data.content} onClose={() => setPreviewPath(null)} />
      ) : null}
      {previewPath && preview.isError ? <p style={s.note}>{t("docs.previewError")}</p> : null}
      <span style={s.serializesLabel}>{t("docs.skillTab.serializesAs")}</span>
      <pre style={s.serializes}>{serialized}</pre>
    </div>
  );
}
