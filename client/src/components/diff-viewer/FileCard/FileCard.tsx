/* FileCard — one collapsible file in the diff: header (path, findings dot,
   +/- stat, comment count) and, when open, its parsed lines plus any
   outdated comments and off-patch findings. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import type { FindingRecord } from "@devdigest/shared";
import type { PrFile } from "@/lib/types";
import { AUTO_EXPAND_MAX_LINES } from "../constants";
import { parsePatch, type Line } from "../helpers";
import {
  buildThreads,
  keysForLine,
  lineKey,
  partitionThreads,
  type CommentThread,
  type DiffCommentApi,
} from "../comments";
import { isOpenFinding, partitionFindings, type DiffFindingApi, type DiffTarget } from "../findings";
import { s, chevronFor } from "../styles";
import { CodeLine } from "../CodeLine";
import { OutdatedComments } from "../OutdatedComments";
import { OffPatchFindings } from "../OffPatchFindings";

/** Threads anchored to a given parsed line (RIGHT=new, LEFT=old). */
function threadsForLine(ln: Line, matched: Map<string, CommentThread[]>): CommentThread[] {
  if (matched.size === 0) return [];
  const out: CommentThread[] = [];
  for (const key of keysForLine(ln)) {
    const list = matched.get(key);
    if (list) out.push(...list);
  }
  return out;
}

/** Findings anchored to a given parsed line — RIGHT side only (findings
 *  never bind to a deleted, LEFT-side line; see findings.ts). */
function findingsForLine(ln: Line, matched: Map<string, FindingRecord[]>): FindingRecord[] {
  if (matched.size === 0) return [];
  const key = lineKey("RIGHT", ln.newNo);
  return key ? matched.get(key) ?? [] : [];
}

export function FileCard({
  file,
  commenting,
  findings,
  target,
}: {
  file: PrFile;
  commenting?: DiffCommentApi;
  findings?: DiffFindingApi;
  target?: DiffTarget | null;
}) {
  const t = useTranslations("shell");
  const tPr = useTranslations("prReview");
  const targeted = target?.path === file.path;
  const targetLine = targeted ? target.line : null;
  const [open, setOpen] = React.useState(
    targeted || (file.additions ?? 0) + (file.deletions ?? 0) <= AUTO_EXPAND_MAX_LINES
  );
  const lines = React.useMemo(() => parsePatch(file.patch), [file.patch]);
  // The row of the target line (RIGHT side, first line of a range), if rendered.
  const targetIndex = React.useMemo(
    () =>
      targetLine === null
        ? -1
        : lines.findIndex((ln) => ln.kind !== "hunk" && ln.kind !== "del" && ln.newNo === targetLine),
    [lines, targetLine]
  );
  const lineNotFound = targeted && targetLine !== null && targetIndex === -1;
  const headerRef = React.useRef<HTMLDivElement>(null);
  const targetRowRef = React.useRef<HTMLDivElement>(null);

  // Synchronise the DOM scroll position with the target: the line row when it
  // is rendered, otherwise the file header.
  React.useEffect(() => {
    if (!targeted) return;
    (targetRowRef.current ?? headerRef.current)?.scrollIntoView({ block: "start" });
  }, [targeted, targetLine]);

  // Group this file's comments into threads and findings into per-line
  // buckets, against the same rendered-line keys, then split each into
  // "matched" (anchors a rendered line) vs. the leftover bucket (outdated
  // comments / off-patch findings) — one memo, no extra state.
  const comments = commenting?.comments;
  const { matched, outdated, matchedFindings, offPatch, hasOpenFinding } = React.useMemo(() => {
    const renderedKeys = new Set<string>();
    for (const ln of lines) for (const k of keysForLine(ln)) renderedKeys.add(k);

    const threadResult = comments
      ? partitionThreads(buildThreads(comments.filter((c) => c.path === file.path)), renderedKeys)
      : { matched: new Map<string, CommentThread[]>(), outdated: [] };

    const fileFindings = findings ? findings.findings.filter((f) => f.file === file.path) : [];
    const findingResult = partitionFindings(fileFindings, renderedKeys);

    return {
      matched: threadResult.matched,
      outdated: threadResult.outdated,
      matchedFindings: findingResult.matched,
      offPatch: findingResult.offPatch,
      hasOpenFinding: fileFindings.some(isOpenFinding),
    };
  }, [comments, findings, file.path, lines]);

  const commentCount = commenting
    ? commenting.comments.filter((c) => c.path === file.path).length
    : 0;

  return (
    <div style={s.fileCard}>
      <div ref={headerRef} onClick={() => setOpen((o) => !o)} style={s.fileHeader}>
        <Icon.ChevronRight size={13} style={chevronFor(open)} />
        <Icon.FileText size={14} style={s.fileIcon} />
        <span className="mono" style={s.filePath}>
          {file.path}
        </span>
        {hasOpenFinding && (
          <span role="img" aria-label={tPr("smartDiff.fileHasFindings")} style={s.findingDot} />
        )}
        <span className="mono tnum" style={s.fileStat}>
          <span style={s.addText}>+{file.additions}</span>{" "}
          <span style={s.delText}>−{file.deletions}</span>
        </span>
        {commentCount > 0 && (
          <span
            style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, color: "var(--text-muted)" }}
          >
            <Icon.MessageSquare size={12} />
            {commentCount}
          </span>
        )}
      </div>
      {lineNotFound && (
        <div role="status" style={s.targetNotice}>
          {tPr("diffTarget.lineNotFound", { line: targetLine })}
        </div>
      )}
      {open && (
        <div style={s.fileBody}>
          {lines.length === 0 ? (
            <div style={s.noDiff}>{t("diffViewer.noDiffText")}</div>
          ) : (
            lines.map((ln, i) => (
              <CodeLine
                key={i}
                ln={ln}
                path={file.path}
                threads={threadsForLine(ln, matched)}
                commenting={commenting}
                findings={findingsForLine(ln, matchedFindings)}
                findingApi={findings}
                highlighted={i === targetIndex}
                targetRef={i === targetIndex ? targetRowRef : undefined}
              />
            ))
          )}
          {commenting && commenting.showComments && <OutdatedComments threads={outdated} />}
          {commenting && commenting.showComments && findings && (
            <OffPatchFindings findings={offPatch} api={findings} />
          )}
        </div>
      )}
    </div>
  );
}
