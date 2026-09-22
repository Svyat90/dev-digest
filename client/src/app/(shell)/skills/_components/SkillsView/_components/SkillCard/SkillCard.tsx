"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, Badge, Toggle } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { NO_DATA } from "@/lib/format";
import { TYPE_COLOR, TYPE_ICON, SOURCE_ICON, UNTRUSTED_SOURCES } from "@/lib/skill-display";
import { formatPercent } from "../../helpers";
import { s } from "./styles";

export function SkillCard({
  skill,
  active,
  onClick,
  onToggle,
}: {
  skill: Skill;
  active?: boolean;
  onClick?: () => void;
  onToggle?: (enabled: boolean) => void;
}) {
  const t = useTranslations("skills");
  const TypeIcon = Icon[TYPE_ICON[skill.type]];
  const SourceIcon = Icon[SOURCE_ICON[skill.source]];
  const color = TYPE_COLOR[skill.type];
  const needsVetting = UNTRUSTED_SOURCES.includes(skill.source) && !skill.enabled;

  return (
    <div onClick={onClick} style={s.card(!!active, skill.enabled)}>
      <div style={s.headerRow}>
        <div style={s.iconBox(color)}>
          <TypeIcon size={15} />
        </div>
        <span className="mono" style={s.name}>
          {skill.name}
        </span>
        {onToggle && (
          <div onClick={(e) => e.stopPropagation()}>
            <Toggle on={skill.enabled} onChange={onToggle} size={14} />
          </div>
        )}
      </div>
      <div style={s.description}>{skill.description}</div>
      <div style={s.metaRow}>
        <Badge color={color} bg={color + "1a"}>
          {t(`listItem.type.${skill.type}`)}
        </Badge>
        <span style={s.sourceLabel}>
          <SourceIcon size={12} />
          {t(`listItem.source.${skill.source}`)}
        </span>
        {needsVetting && (
          <span title={t("listItem.vettingTitle")}>
            <Badge color="var(--warn)" bg="var(--warn-bg)" icon="AlertTriangle">
              {t("listItem.needsVetting")}
            </Badge>
          </span>
        )}
      </div>
      <div style={s.footer}>
        {t("page.footer.agents", { value: skill.agent_count ?? NO_DATA })}
        {" · "}
        {t("page.footer.pull", { value: formatPercent(skill.pull_rate) })}
        {" · "}
        {t("page.footer.accept", { value: formatPercent(skill.accept_rate) })}
      </div>
    </div>
  );
}
