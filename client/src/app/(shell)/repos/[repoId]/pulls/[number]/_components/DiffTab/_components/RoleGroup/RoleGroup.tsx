/* RoleGroup — one collapsible role bucket (core/tests/wiring/docs/boilerplate)
   inside Smart order. Sticky header with a coloured swatch, the role's label +
   description, the findings counter (or the "review not run yet" hint) and a
   file count; the body is the same DiffViewer used by Original order, so each
   FileCard keeps its own auto-expand rule. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { DiffViewer, type DiffCommentApi, type DiffFindingApi } from "@/components/diff-viewer";
import { COLLAPSED_BY_DEFAULT, ROLE_COLOR, ROLE_LABEL_KEY } from "../../constants";
import type { RoleGroupView } from "../../helpers";
import { s } from "../../styles";

export function RoleGroup({
  group,
  reviewed,
  commenting,
  findings,
}: {
  group: RoleGroupView;
  /** Whether at least one `kind==='review'` review exists for this PR. */
  reviewed: boolean;
  commenting?: DiffCommentApi;
  findings?: DiffFindingApi;
}) {
  const t = useTranslations("prReview");
  const [open, setOpen] = React.useState(!COLLAPSED_BY_DEFAULT.has(group.role));
  const label = t(ROLE_LABEL_KEY[group.role]);

  return (
    <div style={s.roleGroup}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={t(open ? "smartDiff.collapseGroup" : "smartDiff.expandGroup", { role: label })}
        style={s.roleHeader}
      >
        <span style={{ ...s.roleSwatch, background: ROLE_COLOR[group.role] }} />
        <span style={s.roleLabel}>{label}</span>
        <span style={s.roleDescription}>{t(`smartDiff.roleDescription.${group.role}`)}</span>
        <span style={s.roleFindings}>
          {reviewed ? (
            <>
              <span
                role="img"
                aria-label={t("smartDiff.groupFindings", { count: group.filesWithFindings })}
                style={s.roleFindingsDot}
              />
              {group.filesWithFindings}
            </>
          ) : (
            t("smartDiff.reviewNotRunYet")
          )}
        </span>
        <span style={s.roleFilesCount}>{t("smartDiff.filesCount", { count: group.files.length })}</span>
      </button>
      {open && (
        <div style={s.roleBody}>
          <DiffViewer files={group.files} commenting={commenting} findings={findings} />
        </div>
      )}
    </div>
  );
}
