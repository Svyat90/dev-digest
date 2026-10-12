import type { Notifier } from '@devdigest/shared';

export interface ReviewSummary {
  repo: string;
  number: number;
  title: string;
  blockers: number;
  warnings: number;
}

export async function notifyReviewDone(
  notifier: Notifier,
  channel: string,
  summary: ReviewSummary,
): Promise<string | undefined> {
  const res = await notifier.postMessage({
    channel,
    text: `Review finished for ${summary.repo}#${summary.number}`,
    blocks: [
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `*${summary.title}*\n${summary.blockers} blockers, ${summary.warnings} warnings` },
      },
    ],
  });
  return res.ts;
}
