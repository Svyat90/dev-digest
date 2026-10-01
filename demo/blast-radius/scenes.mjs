// Scenes for the Blast Radius demo (demo/blast-radius/scenario.md).
// Browser-only video. Main PR: #12 in Svyat90/dev-digest; empty state: #7 of the same
// repo; degraded state: seed PR #482 of acme/payments-api.
//
// Everything here is READ-ONLY: expanding Prior PRs is one GET, and "Resync index" is
// only hovered, never clicked. So no scene needs a data-restoring pre-roll; each pre-roll
// just loads the page into the state the scene starts from, so any scene can be re-shot alone.

// FILMING order — same as playback order here.
export const order = ['s1', 's2', 's3', 's4', 's5', 's6', 's7'];
export const browser = order;

const REPO_ID = '562ddc32-33fe-4292-8ec5-83cc6bb2e528'; // Svyat90/dev-digest
const ACME_REPO_ID = '1bc6b1c6-ad8a-4e58-8c2f-db1802582da7'; // acme/payments-api (seed)

export default function scenes(stage) {
  const { sleep, record, stop, cue, shot, web, config, dry } = stage;
  const p = () => web.page;
  const base = config.web.baseUrl;
  const url = (repoId, n) => `${base}/repos/${repoId}/pulls/${n}`;

  const cardLabel = () => p().getByText('Blast radius', { exact: true }).first();
  const group = name => p().getByRole('button', { name: new RegExp(`^(Collapse|Expand) ${name}$`) });
  const toggle = name => p().getByRole('button', { name, exact: true });
  const priorFooter = () => p().getByRole('button', { name: /prior PRs touching these files/i });

  // Fresh load of a PR's Overview tab, scrolled to the top, card loaded.
  async function openOverview(repoId, n) {
    await web.open(url(repoId, n));
    await cardLabel().waitFor();
    await web.prep();
    await p().evaluate(() => window.scrollTo(0, 0));
    await sleep(600);
  }
  // Wait until the main PR's card is fully loaded (stats row present).
  async function openMain() {
    await openOverview(REPO_ID, 12);
    await p().getByText('cron/jobs', { exact: true }).waitFor();
    await p().getByRole('button', { name: /^(Collapse|Expand) useRunReview$/ }).waitFor();
  }
  async function ensureCollapsed(name) {
    const g = group(name);
    if ((await g.getAttribute('aria-expanded')) === 'true') await g.click();
  }
  async function ensureExpanded(name) {
    const g = group(name);
    if ((await g.getAttribute('aria-expanded')) !== 'true') await g.click();
  }
  // Rest the pointer just beside a small target instead of on it, so it stays readable.
  async function glideBeside(loc, ms, dx = 28, dy = 26) {
    const [x, y] = await web.center(loc);
    await web.glide(x + dx, y + dy, ms);
  }

  return {
    // The card next to the Intent card.
    async s1() {
      await openMain();
      await web.glide(1500, 260, 10);
      await record('s1');
      await cue('s1-01', async ms => {
        await sleep(ms * 0.2);
        await web.glideTo(cardLabel(), 900);
        if (dry) shot('dry-s1-card');
      });
      await cue('s1-02', async ms => {
        await web.glideTo(p().getByText('cron/jobs', { exact: true }), 900);
        await sleep(ms * 0.3);
        await web.glideTo(group('useRunReview'), 900);
      });
      await stop();
    },

    // Summary row, the tree, and the GitHub link of a caller.
    async s2() {
      await openMain();
      await web.glide(1500, 260, 10);
      await record('s2');
      await cue('s2-01', async ms => {
        await web.glideTo(p().getByText('symbols', { exact: true }).first(), 700);
        await sleep(ms * 0.3);
        await web.glideTo(p().getByText('cron/jobs', { exact: true }), Math.min(2200, ms * 0.5));
        if (dry) shot('dry-s2-stats');
      });
      await cue('s2-02', async ms => {
        await web.glideTo(group('useRunReview'), 900);
        await sleep(ms * 0.2);
        await web.glideTo(group('useFindingAction'), 900);
        await sleep(ms * 0.1);
        await web.glideTo(group('useRunEvents'), 800);
      });
      await cue('s2-03', async ms => {
        await web.glideTo(group('useRunReview'), 700);
        const link = p().getByRole('link', { name: /RunReviewDropdown\.tsx:37 on GitHub$/ });
        await web.glideTo(link, 900); // hover only: the click would open a new tab
        if (dry) shot('dry-s2-link');
        await sleep(ms * 0.3);
      });
      await stop();
    },

    // deriveReviewStatus: two callers and endpoint chips.
    async s3() {
      await openMain();
      await ensureCollapsed('useRunReview'); // so the row we open does not jump away
      await web.scrollIntoCenter(group('deriveReviewStatus'));
      await sleep(500);
      await web.glideTo(group('deriveReviewStatus'), 10);
      await record('s3');
      await cue('s3-01', async ms => {
        await sleep(ms * 0.15);
        await web.clickOn(group('deriveReviewStatus'), 700);
        await p().getByRole('group', { name: 'Endpoints' }).first().waitFor();
        await sleep(ms * 0.2);
        await web.glideTo(p().getByRole('group', { name: 'Endpoints' }).first(), 900);
        if (dry) shot('dry-s3-endpoints');
      });
      await cue('s3-02', async ms => {
        await glideBeside(p().getByRole('group', { name: 'Endpoints' }).first(), 900, 120, 20);
        await sleep(ms * 0.3);
      });
      await stop();
    },

    // Tree -> Graph -> Tree.
    async s4() {
      await openMain();
      await ensureExpanded('useRunReview');
      await web.glideTo(toggle('graph'), 10);
      await record('s4');
      await cue('s4-01', async ms => {
        await sleep(ms * 0.1);
        await web.clickOn(toggle('graph'), 700);
        await p().getByRole('img', { name: 'Blast radius graph' }).waitFor();
        if (dry) shot('dry-s4-graph');
        await sleep(ms * 0.2);
        await web.glideTo(p().getByRole('img', { name: 'Blast radius graph' }), 1200);
        await sleep(ms * 0.15);
        await web.clickOn(toggle('tree'), 700);
      });
      await stop();
    },

    // Prior PRs footer: collapsed, then opened (one read).
    async s5() {
      await openMain();
      await ensureCollapsed('useRunReview');
      await web.scrollIntoCenter(priorFooter());
      await sleep(500);
      await web.glideTo(priorFooter(), 10);
      await record('s5');
      await cue('s5-01', async ms => {
        await sleep(ms * 0.2);
        await web.glideTo(priorFooter(), 800);
      });
      await cue('s5-02', async ms => {
        await web.clickOn(priorFooter(), 600);
        await p().getByText('No merged PRs touched these files.').waitFor();
        if (dry) shot('dry-s5-prior');
        await sleep(ms * 0.2);
        await web.glideTo(p().getByText('No merged PRs touched these files.'), 800);
      });
      await stop();
    },

    // Empty state (PR #7), then the degraded state (seed PR #482); Resync is hovered only.
    async s6() {
      await openOverview(REPO_ID, 7);
      await p().getByText(/no downstream callers found/).waitFor();
      await web.glide(1500, 260, 10);
      await record('s6');
      await cue('s6-01', async ms => {
        await sleep(ms * 0.2);
        await web.glideTo(p().getByText(/no downstream callers found/), 900);
        if (dry) shot('dry-s6-empty');
        await sleep(ms * 0.3);
      });
      await web.open(url(ACME_REPO_ID, 482));
      await p().getByRole('button', { name: 'Resync index' }).waitFor();
      await web.prep();
      await cue('s6-02', async ms => {
        await sleep(ms * 0.15);
        await web.glideTo(p().getByText('Partial data', { exact: true }), 900);
        if (dry) shot('dry-s6-degraded');
        await sleep(ms * 0.25);
        await web.glideTo(p().getByRole('button', { name: 'Resync index' }), 900); // hover, never click
      });
      await stop();
    },

    // Still frame of the main card while the architecture and MCP are named.
    async s7() {
      await openMain();
      await web.glide(1500, 260, 10);
      await record('s7');
      await cue('s7-01', async ms => {
        await sleep(ms * 0.2);
        await web.glideTo(cardLabel(), 1000);
        await sleep(ms * 0.3);
        await web.glideTo(group('useRunReview'), 1000);
      });
      await cue('s7-02', async ms => {
        await sleep(ms * 0.5);
      });
      await stop();
    },
  };
}
