"use client";

import { useDeferredValue, useState } from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Skeleton, EmptyState, ErrorState } from "@devdigest/ui";
import { useCrumb } from "@/components/app-shell";
import { DocTypeTag, TokenEstimate } from "@/components/project-context";
import { useContextDocs } from "@/lib/hooks/project-context";
import { useActiveRepo } from "@/lib/repo-context";
import { DocDetail } from "./_components/DocDetail";
import { s } from "./styles";

export function ProjectContextView() {
  const t = useTranslations("context");
  const { repoId } = useParams<{ repoId: string }>();
  const { activeRepo } = useActiveRepo();
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const q = useDeferredValue(filter.trim());
  const { data, isLoading, isError, error, refetch } = useContextDocs(repoId, q);

  const repoName = activeRepo?.full_name ?? data?.repo.full_name ?? repoId;
  useCrumb([{ label: t("docs.page.crumb") }, { label: repoName, mono: true }]);

  const header = (
    <div style={s.pageHeader}>
      <h1 style={s.pageTitle}>{t("docs.page.heading", { repo: repoName })}</h1>
      <p style={s.pageSubtitle}>{t("docs.page.subtitle")}</p>
    </div>
  );

  const renderBody = () => {
    if (isLoading) {
      return Array.from({ length: 6 }, (_, i) => (
        <Skeleton key={i} height={40} style={{ marginBottom: 8, borderRadius: 8 }} />
      ));
    }
    if (isError) {
      return <ErrorState title={t("docs.loadError")} body={(error as Error)?.message} onRetry={() => refetch()} />;
    }
    if (!data) return null;
    if (data.status === "not_cloned") return <p style={s.note}>{t("docs.notCloned")}</p>;
    if (data.documents.length === 0) {
      if (q) return <p style={s.note}>{t("docs.noMatches")}</p>;
      return <EmptyState icon="FileText" title={t("docs.empty", { roots: data.roots.join(", ") })} />;
    }
    return (
      <>
        <ul style={s.list}>
          {data.documents.map((d) => (
            <li key={d.path}>
              <button type="button" style={s.row(d.path === selected)} onClick={() => setSelected(d.path)}>
                <span style={s.path}>{d.path}</span>
                <DocTypeTag type={d.type} />
                <TokenEstimate tokens={d.tokens} truncated={d.truncated} />
              </button>
            </li>
          ))}
        </ul>
        {data.total > data.documents.length ? (
          <p style={s.note}>{t("docs.moreNotListed", { count: data.total - data.documents.length })}</p>
        ) : null}
      </>
    );
  };

  return (
    <>
      {header}
      <div style={s.body}>
        <div>
          <input
            type="search"
            style={s.filter}
            value={filter}
            placeholder={t("docs.filterPlaceholder")}
            aria-label={t("docs.filterPlaceholder")}
            onChange={(e) => setFilter(e.target.value)}
          />
          {renderBody()}
        </div>
        <div>
          {selected ? (
            <DocDetail key={selected} repoId={repoId} path={selected} onClose={() => setSelected(null)} />
          ) : (
            <p style={s.prompt}>{t("docs.selectPrompt")}</p>
          )}
        </div>
      </div>
    </>
  );
}
