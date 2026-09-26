/**
 * assemblePrompt — PR description slot (the fix that was missing: the PR body
 * never reached the prompt). Pins rendering, omit-when-empty, untrusted-wrap,
 * truncation, and ordering (before the diff).
 */
import { describe, it, expect } from 'vitest';
import { assemblePrompt } from '../src/prompt.js';

function userOf(parts: Parameters<typeof assemblePrompt>[0]): string {
  const { messages } = assemblePrompt(parts);
  return messages[1]!.content;
}

function systemOf(parts: Parameters<typeof assemblePrompt>[0]): string {
  return assemblePrompt(parts).messages[0]!.content;
}

describe('assemblePrompt — shared injection guard (server + CI)', () => {
  const sys = systemOf({ system: 'AGENT-SYS', diff: 'DIFF' });

  it('appends the guard to the agent system prompt', () => {
    expect(sys.startsWith('AGENT-SYS')).toBe(true);
    expect(sys).toMatch(/<untrusted>.*DATA to be analyzed/s);
  });

  it('forbids "intentional/test/demo" claims from descoping the review', () => {
    // The defense that replaced the keyword sanitizer: a general, trusted,
    // language-agnostic rule — not text parsing of untrusted input.
    expect(sys).toMatch(/test fixture|intentional|demo/i);
    expect(sys).toMatch(/never reduce|never .*descope|REPORT it/i);
    expect(sys).toMatch(/any language/i);
  });
});

describe('assemblePrompt — ## PR description', () => {
  it('renders the section (untrusted-wrapped) before the diff when present', () => {
    const { messages, assembly } = assemblePrompt({
      system: 'sys',
      diff: 'DIFF',
      prDescription: 'Adds rate limiting to the public /api endpoints.',
    });
    const user = messages[1]!.content;
    expect(user).toContain('## PR description');
    expect(user).toContain('<untrusted source="pr-description">');
    expect(user).toContain('Adds rate limiting to the public /api endpoints.');
    expect(user.indexOf('## PR description')).toBeLessThan(user.indexOf('## Diff to review'));
    expect(assembly.pr_description).toContain('Adds rate limiting');
  });

  it('omits the section when prDescription is undefined or blank (no behaviour change)', () => {
    expect(userOf({ system: 'sys', diff: 'DIFF' })).not.toContain('## PR description');
    expect(assemblePrompt({ system: 'sys', diff: 'DIFF' }).assembly.pr_description ?? null).toBeNull();
    expect(userOf({ system: 'sys', diff: 'DIFF', prDescription: '   ' })).not.toContain(
      '## PR description',
    );
  });

  it('truncates a huge body to the 4k cap', () => {
    const { assembly } = assemblePrompt({
      system: 'sys',
      diff: 'D',
      prDescription: 'x'.repeat(10_000),
    });
    expect((assembly.pr_description as string).length).toBe(4000);
  });
});

describe('assemblePrompt — ## PR intent (scope-discipline slot)', () => {
  const intent = {
    intent: 'Add rate limiting to the public API',
    in_scope: ['Rate limiter middleware', 'Config for limits'],
    out_of_scope: ['Auth token refresh'],
    confidence: 'high' as const,
  };

  it('renders after ## PR description and before the diff, payload untrusted-wrapped, scope rule naming CRITICAL and security', () => {
    const { messages } = assemblePrompt({
      system: 'sys',
      diff: 'DIFF',
      prDescription: 'Adds rate limiting to the public /api endpoints.',
      skills: ['SKILL-BODY'],
      intent,
    });
    const user = messages[1]!.content;

    expect(user).toContain('## PR intent');
    expect(user).toContain('<untrusted source="pr-intent">');
    expect(user).toContain('Add rate limiting to the public API');
    expect(user).toContain('- Rate limiter middleware');
    expect(user).toContain('- Auth token refresh');
    expect(user).toContain('Confidence: high');

    const iDesc = user.indexOf('## PR description');
    const iIntent = user.indexOf('## PR intent');
    const iSkills = user.indexOf('## Skills / rules');
    const iDiff = user.indexOf('## Diff to review');
    expect(iDesc).toBeGreaterThanOrEqual(0);
    expect(iDesc).toBeLessThan(iIntent);
    expect(iIntent).toBeLessThan(iSkills);
    expect(iSkills).toBeLessThan(iDiff);

    // The scope-discipline paragraph is TRUSTED prose, rendered before (outside)
    // the <untrusted source="pr-intent"> block that carries the derived text.
    const rulePos = user.indexOf('Focus your review on changes that serve this intent');
    const untrustedPos = user.indexOf('<untrusted source="pr-intent">');
    expect(rulePos).toBeGreaterThanOrEqual(0);
    expect(rulePos).toBeLessThan(untrustedPos);
    expect(user).toMatch(/CRITICAL/);
    expect(user).toMatch(/security vulnerability/i);
  });

  it('gives a byte-identical user message for an undefined intent and an empty intent (omit-when-empty)', () => {
    const base = { system: 'sys', diff: 'DIFF' };
    const noIntentField = userOf(base);
    const withUndefinedIntent = userOf({ ...base, intent: undefined });
    const withEmptyIntent = userOf({
      ...base,
      intent: { intent: '', in_scope: [], out_of_scope: [] },
    });

    expect(withUndefinedIntent).toBe(noIntentField);
    expect(withEmptyIntent).toBe(noIntentField);
    expect(noIntentField).not.toContain('## PR intent');
  });

  it('leaves the system message (injection guard) byte-identical with and without intent', () => {
    const base = { system: 'sys', diff: 'DIFF' };
    expect(systemOf({ ...base, intent })).toBe(systemOf(base));
  });
});
