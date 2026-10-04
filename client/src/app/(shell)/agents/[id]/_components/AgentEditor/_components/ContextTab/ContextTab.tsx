"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useActiveRepo } from "@/lib/repo-context";
import {
  useAgentContextDocs,
  useContextDoc,
  useContextDocs,
  useSetAgentContextDocs,
} from "@/lib/hooks/project-context";
import { formatTokenCount } from "@/lib/format";
import {
  AttachableDocList,
  DocPreview,
  DocTypeTag,
  TokenEstimate,
  mergeRows,
} from "@/components/project-context";
import { s } from "./styles";

/** Agent editor "Context" tab: attach repository documents, see inherited ones. */
export function ContextTab({ agentId }: { agentId: string }) {
  const t = useTranslations("context");
  const { repoId, activeRepo } = useActiveRepo();
  const [q, setQ] = useState("");
  const [previewPath, setPreviewPath] = useState<string | null>(null);

  const listing = useContextDocs(repoId, q);
  const unfiltered = useContextDocs(repoId, "");
  const agentDocs = useAgentContextDocs(agentId, repoId);
  const setDocs = useSetAgentContextDocs(agentId, repoId);
  const preview = useContextDoc(repoId, previewPath);

  if (!repoId) return <div style={s.message}>{t("docs.tab.noRepo")}</div>;

  const data = agentDocs.data;
  const own = data?.own ?? [];
  const needle = q.trim().toLowerCase();
  // The filter narrows the list, attached rows included; an attached row's
  // "not found" state comes from the server, not from absence in the listing.
  const rows = mergeRows(listing.data?.documents ?? [], own).filter(
    (r) => !needle || r.path.toLowerCase().includes(needle),
  );
  const total = unfiltered.data?.total ?? listing.data?.total ?? 0;
  const repoName = data?.repo.full_name ?? listing.data?.repo.full_name ?? activeRepo?.full_name ?? "";
  const notCloned = listing.data?.status === "not_cloned";

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <h2 style={s.h2}>{t("docs.tab.title")}</h2>
        <span style={s.meta}>{t("docs.tab.repoLabel", { repo: repoName })}</span>
        <span style={s.meta}>{t("docs.tab.attachedCount", { attached: own.length, total })}</span>
        <Link href={`/repos/${repoId}/context`} style={s.link}>
          {t("docs.tab.openPage")}
        </Link>
      </div>
      <div style={s.hint}>
        {data ? `${t("docs.tab.total", { tokens: formatTokenCount(data.total_tokens) })} · ` : ""}
        {t("docs.tab.untrustedNote")}
      </div>

      {data && data.left_out.length > 0 ? (
        <div role="alert" style={s.warning}>
          {t("docs.tab.capWarning", { cap: formatTokenCount(data.cap_tokens), paths: data.left_out.join(", ") })}
        </div>
      ) : null}

      {notCloned ? (
        <div style={s.message}>{t("docs.notCloned")}</div>
      ) : (
        <>
          <input
            type="search"
            style={s.filter}
            value={q}
            placeholder={t("docs.filterPlaceholder")}
            aria-label={t("docs.filterPlaceholder")}
            onChange={(e) => setQ(e.target.value)}
          />
          {listing.isError ? (
            <div style={s.message}>{t("docs.loadError")}</div>
          ) : rows.length === 0 && !listing.isLoading ? (
            <div style={s.message}>
              {q ? t("docs.noMatches") : t("docs.empty", { roots: (listing.data?.roots ?? []).join(", ") })}
            </div>
          ) : (
            <AttachableDocList rows={rows} onChange={(paths) => setDocs.mutate(paths)} onPreview={setPreviewPath} />
          )}
        </>
      )}

      {data && data.inherited.length > 0 ? (
        <>
          <h3 style={s.inheritedTitle}>{t("docs.tab.inheritedTitle")}</h3>
          <ul style={s.inheritedList}>
            {data.inherited.map((d) => (
              <li key={`${d.skill_id}:${d.path}`} style={s.inheritedRow}>
                <button type="button" style={{ ...s.mono, background: "none", border: "none", padding: 0, textAlign: "left", color: "inherit", cursor: "pointer" }} disabled={!d.found} onClick={() => setPreviewPath(d.path)}>
                  {d.path}
                </button>
                <DocTypeTag type={d.type} />
                {d.found ? <TokenEstimate tokens={d.tokens} truncated={d.truncated} /> : <span>{t("docs.notFound")}</span>}
                <span style={s.from}>{t("docs.tab.inheritedFrom", { skill: d.skill_name })}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {previewPath && preview.data ? (
        <div style={s.previewBox}>
          <DocPreview path={preview.data.path} content={preview.data.content} onClose={() => setPreviewPath(null)} />
        </div>
      ) : null}
    </div>
  );
}
