#!/usr/bin/env node
// Deterministic lint for a spec written by the spec-creator agent.
//   node scripts/lint-spec.mjs <path-to-spec.md>
// Exit 1 when there is an ERROR; WARN lines never fail the run.
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

const file = process.argv[2];
if (!file) {
  console.error('usage: node scripts/lint-spec.mjs <spec.md>');
  process.exit(2);
}

const text = readFileSync(file, 'utf8');
const errors = [];
const warns = [];
const err = (m) => errors.push(m);
const warn = (m) => warns.push(m);

const HEADINGS = [
  'Problem and user',
  'Goals / Non-goals',
  'User stories',
  'Acceptance criteria (EARS)',
  'Edge cases',
  'Non-functional requirements',
  'Inputs and provenance',
  'Untrusted inputs',
  'Open questions',
];
const STATUSES = ['draft', 'approved', 'implemented', 'superseded'];
const WEASEL =
  /\b(fast|quick(ly)?|easy|easily|simple|appropriate(ly)?|properly|nicely|user-friendly|efficient(ly)?|robust|seamless(ly)?|intuitive|reasonable|as needed|etc\.?|and\/or|if possible|should)\b/i;
// "How", not "what": file paths, code identifiers, SQL, framework hooks, step order.
const HOW =
  /(\b[\w./-]+\.(tsx?|jsx?|mjs|sql|json)\b|\/src\/|\buse[A-Z]\w+\(|\bSELECT\b|\bINSERT\b|\bstep \d\b|\bfirst,|\bafterwards\b|\bin the following order\b|\bfunction\b|\bclass\b)/;

// ---- header ------------------------------------------------------------
if (!/^# Spec: \S/m.test(text)) err('missing "# Spec: <name>" title');
const id = /^Spec ID: (SPEC-(\d{2})-([a-z0-9-]+))$/m.exec(text);
if (!id) err('missing or malformed "Spec ID: SPEC-NN-slug"');
else {
  const expected = `${id[2]}-${id[3]}-`;
  if (!basename(file).startsWith(expected)) {
    err(`file name must start with "${expected}" (got ${basename(file)})`);
  }
  if (!/-\d{4}-\d{2}-\d{2}\.md$/.test(basename(file))) {
    err('file name must end with -YYYY-MM-DD.md');
  }
}
const status = /^Status: (\S+)\s*$/m.exec(text)?.[1];
if (!STATUSES.includes(status)) err(`Status must be one of ${STATUSES.join(' | ')}`);
for (const key of ['Supersedes', 'Packages', 'Depends on']) {
  if (!new RegExp(`^${key}: \\S`, 'm').test(text)) err(`missing "${key}:" header line`);
}

// ---- sections ----------------------------------------------------------
const found = [...text.matchAll(/^## (.+?)\s*$/gm)].map((m) => m[1]);
if (found.join('|') !== HEADINGS.join('|')) {
  err(`section headings must be exactly, in order: ${HEADINGS.join(' · ')}`);
}
const section = (title) => {
  const m = new RegExp(`^## ${title.replace(/[()/]/g, '\\$&')}\\s*$`, 'm').exec(text);
  if (!m) return '';
  const rest = text.slice(m.index + m[0].length);
  const next = rest.search(/^## /m);
  return next === -1 ? rest : rest.slice(0, next);
};
const items = (body, tag) =>
  body.split('\n').filter((l) => new RegExp(`^- ${tag}\\d+\\b`).test(l));
const nums = (list, tag) => list.map((l) => Number(new RegExp(`${tag}(\\d+)`).exec(l)[1]));
const sequential = (n, tag) => {
  if (new Set(n).size !== n.length) err(`${tag} ids are not unique`);
  n.forEach((v, i) => v !== i + 1 && !n.includes(i + 1) && err(`${tag}${i + 1} is missing (ids must be 1..n)`));
};

// ---- user stories ------------------------------------------------------
const us = items(section('User stories'), 'US');
if (us.length === 0) err('User stories: no "- US1: As a …" items');
const usIds = nums(us, 'US');
sequential(usIds, 'US');
us.forEach((l) => {
  if (!/As an? .+, I want .+, so that .+/.test(l)) err(`${l.slice(0, 40)}…: not "As a …, I want …, so that …"`);
});

// ---- acceptance criteria -----------------------------------------------
const ac = items(section('Acceptance criteria (EARS)'), 'AC');
if (ac.length === 0) err('Acceptance criteria: no "- AC1 [US1]: …" items');
const acIds = nums(ac, 'AC');
sequential(acIds, 'AC');
if (ac.length > 25) warn(`${ac.length} acceptance criteria — consider splitting this spec in two`);
ac.forEach((l) => {
  const id_ = /^- (AC\d+)/.exec(l)[1];
  const m = /^- AC\d+ \[(US\d+(?:, ?US\d+)*)\]: (.+)$/.exec(l);
  if (!m) return err(`${id_}: format is "- ACn [USm]: <EARS sentence>"`);
  m[1].split(/, ?/).forEach((u) => {
    if (!usIds.includes(Number(u.slice(2)))) err(`${id_}: refers to ${u}, which does not exist`);
  });
  const body = m[2];
  if (!/^(The system shall|WHEN |WHILE |IF .+, THEN |WHERE )/.test(body)) {
    err(`${id_}: must start with an EARS pattern (The system shall | WHEN | WHILE | IF…, THEN | WHERE)`);
  }
  const shalls = (body.match(/\bshall\b/g) ?? []).length;
  if (shalls !== 1) err(`${id_}: exactly one "shall" per criterion (found ${shalls})`);
  if (WEASEL.test(body)) err(`${id_}: vague wording "${WEASEL.exec(body)[0]}" — use a number, condition or observable result`);
  if (HOW.test(body)) warn(`${id_}: reads like "how" (${HOW.exec(body)[0]}) — state what and why, not the implementation`);
});

// ---- edge cases --------------------------------------------------------
const ec = items(section('Edge cases'), 'EC');
sequential(nums(ec, 'EC'), 'EC');
ec.forEach((l) => {
  const refs = [...l.matchAll(/\bAC(\d+)\b/g)].map((m) => Number(m[1]));
  if (refs.length === 0) err(`${/^- (EC\d+)/.exec(l)[1]}: must name the AC that covers it`);
  refs.forEach((r) => !acIds.includes(r) && err(`${/^- (EC\d+)/.exec(l)[1]}: refers to AC${r}, which does not exist`));
});

// ---- tables ------------------------------------------------------------
const rows = (body) =>
  body
    .split('\n')
    .filter((l) => l.trim().startsWith('|') && !/^\|\s*-/.test(l.trim()))
    .slice(1) // header row
    .map((l) => l.split('|').slice(1, -1).map((c) => c.trim()));

const untrusted = section('Untrusted inputs');
if (!/^\s*none\b/im.test(untrusted)) {
  const r = rows(untrusted);
  if (r.length === 0) err('Untrusted inputs: add a table "| input | handling | AC |" or write "none, because …"');
  r.forEach((c) => {
    if (c.length < 3 || c.some((x) => !x)) err(`Untrusted inputs: incomplete row "${c.join(' | ')}"`);
    else if (!acIds.includes(Number(/AC(\d+)/.exec(c[2])?.[1]))) {
      err(`Untrusted inputs: "${c[0]}" must point at the AC that handles it`);
    }
  });
}
const prov = rows(section('Inputs and provenance'));
if (prov.length === 0) err('Inputs and provenance: add a table "| fact | source | date |"');
prov.forEach((c) => {
  if (c.length < 3 || c.some((x) => !x)) err(`Inputs and provenance: incomplete row "${c.join(' | ')}"`);
});

// ---- open questions ----------------------------------------------------
const oq = items(section('Open questions'), 'OQ');
oq.forEach((l) => {
  if (!/\(owner: \S.*?\)/.test(l)) err(`${/^- (OQ\d+)/.exec(l)[1]}: needs "(owner: <who>)"`);
});
if (oq.length === 0 && !/^\s*none\b/im.test(section('Open questions'))) {
  err('Open questions: list "- OQ1 (owner: …): …" items or write "none"');
}
if (oq.length > 0 && status && status !== 'draft') err(`Status is ${status} but ${oq.length} open question(s) remain`);

// ---- report ------------------------------------------------------------
warns.forEach((w) => console.log(`WARN  ${w}`));
errors.forEach((e) => console.log(`ERROR ${e}`));
console.log(`${basename(file)}: ${ac.length} AC · ${ec.length} EC · ${oq.length} OQ — ${errors.length} error(s), ${warns.length} warning(s)`);
process.exit(errors.length ? 1 : 0);
