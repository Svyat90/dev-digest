// Scenes for the Smart Diff demo (demo/smart-diff/scenario.md).
// Browser-only video on the author's test PR #11 in Svyat90/dev-digest.
//
// Every scene's pre-roll (the code before `record`) puts the data into the exact state
// that scene starts from, through the API — so any scene can be re-shot on its own.
// The review itself is started on camera in s3; the ~50 s wait for it sits in s4's
// pre-roll, off camera.

// FILMING order — not playback order. The video is concatenated in `config.order`.
export const order = ['s1', 's2', 's3', 's4', 's5', 's6', 's7'];
export const browser = order;

const API = 'http://localhost:3001';
const REPO_ID = '562ddc32-33fe-4292-8ec5-83cc6bb2e528';
const PR_ID = 'fda8b562-f399-4ac3-9ceb-d613f6a716fa';     // PR #11
const PR_NUMBER = 11;
const AGENT_ID = '6f6e2eb2-b04c-4e37-8ed7-52f34bf52ccf';  // General Reviewer
const FINDING_TITLE = /formatSizeDelta always prepends/;

async function api(method, path, body) {
  const r = await fetch(API + path, {
    method,
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok && r.status !== 404) throw new Error(`${method} ${path}: HTTP ${r.status} ${await r.text()}`);
  return r.status === 204 ? null : r.json().catch(() => null);
}

async function deleteRuns() {
  for (const r of (await api('GET', `/pulls/${PR_ID}/runs`)) ?? []) await api('DELETE', `/runs/${r.run_id}`);
}
async function waitRunDone(timeoutMs = 300000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const runs = (await api('GET', `/pulls/${PR_ID}/runs`)) ?? [];
    const run = runs.find(r => r.agent_id === AGENT_ID);
    if (run && run.status === 'done') return run;
    if (run && ['failed', 'cancelled', 'error'].includes(run.status)) throw new Error(`run ${run.run_id} ${run.status}`);
    await new Promise(res => setTimeout(res, 2000));
  }
  throw new Error(`run on PR #${PR_NUMBER} did not finish in time`);
}
// s4 and s5 narrate one specific finding. The model is not deterministic, so check it
// is there before filming rather than narrating over a screen that says otherwise.
async function assertExpectedFinding() {
  const reviews = (await api('GET', `/pulls/${PR_ID}/reviews`)) ?? [];
  const list = Array.isArray(reviews) ? reviews : reviews.items ?? [];
  const hit = list.flatMap(r => r.findings ?? [])
    .find(f => f.file === 'client/src/lib/format-size.ts' && FINDING_TITLE.test(f.title ?? '') && !f.dismissed_at);
  if (!hit) {
    const got = list.flatMap(r => r.findings ?? []).map(f => `${f.severity} ${f.file}:${f.start_line} ${f.title}`);
    throw new Error(`expected formatSizeDelta finding not produced; got:\n  ${got.join('\n  ')}\nre-shoot s3–s5`);
  }
  return hit;
}

export default function scenes(stage) {
  const { sleep, record, stop, cue, shot, web, config, dry } = stage;
  const p = () => web.page;
  const prUrl = `${config.web.baseUrl}/repos/${REPO_ID}/pulls/${PR_NUMBER}`;

  const header = () => p().getByText('Reviewer-ordered diff', { exact: true });
  const group = role => p().getByRole('button', { name: new RegExp(`^(Collapse|Expand) ${role} group`) });
  const fileTitle = path => p().getByText(path, { exact: true }).first();
  // Rest the pointer just beside a small target instead of on it, so it stays readable.
  async function glideBeside(loc, ms, dx = 28, dy = 26) {
    const [x, y] = await web.center(loc);
    await web.glide(x + dx, y + dy, ms);
  }

  // Fresh load of the Files changed tab in Smart order, scrolled to the top.
  async function openDiff() {
    await web.open(prUrl);
    await p().getByRole('button', { name: /^Files changed/ }).click();
    await header().waitFor();
    await web.prep();
    await p().evaluate(() => window.scrollTo(0, 0));
    await sleep(400);
  }
  // Keep the page if it is already on the tab (s4 must not reload); otherwise load it.
  // A started review switches the page to the live run log; coming back is a tab click.
  async function ensureDiff() {
    if (p().url().startsWith(prUrl)) {
      if (await header().isVisible().catch(() => false)) return;
      const tab = p().getByRole('button', { name: /^Files changed/ });
      if (await tab.isVisible().catch(() => false)) {
        await tab.click();
        await header().waitFor();
        await web.prep();
        return;
      }
    }
    await openDiff();
  }
  async function smartOrder() {
    const smart = p().getByRole('button', { name: 'Smart order' });
    if ((await smart.getAttribute('aria-pressed')) !== 'true') await smart.click();
    await group('Core').waitFor();
  }
  async function collapsed(role) {
    const g = group(role);
    if ((await g.getAttribute('aria-expanded')) === 'true') await g.click();
  }
  async function ensureReviewed() {
    const runs = (await api('GET', `/pulls/${PR_ID}/runs`)) ?? [];
    if (!runs.some(r => r.agent_id === AGENT_ID)) {
      // Re-shooting s4/s5 alone: start the run off camera, then load the page fresh.
      await api('POST', `/pulls/${PR_ID}/review`, { agentId: AGENT_ID });
      await waitRunDone();
      await openDiff();
    } else {
      await waitRunDone();
      await ensureDiff();
    }
    await assertExpectedFinding();
    // The client refreshes the counters itself when the run ends; give it time.
    await p().getByRole('img', { name: /files? with findings/ }).first().waitFor({ timeout: 20000 });
  }

  return {
    async s1() {
      await deleteRuns();
      await openDiff();
      await web.glide(1400, 300, 10);
      await record('s1');
      await cue('s1-01', async ms => {
        await web.glideTo(header(), 900);
        await sleep(ms * 0.25);
        await web.glideTo(group('Core'), 900);
        await sleep(ms * 0.1);
        await web.wheel(600, 10, 30);
      });
      await cue('s1-02', async ms => {
        await web.scrollIntoCenter(group('Docs'));
        await web.glideTo(group('Docs'), 800);
        await sleep(ms * 0.25);
        await web.glideTo(group('Boilerplate'), 700);
        if (dry) shot('dry-s1-groups');
      });
      await sleep(500);
      await stop();
    },

    async s2() {
      await ensureDiff();
      await smartOrder();
      await collapsed('Boilerplate');
      await web.scrollIntoCenter(group('Boilerplate'));
      await web.glideTo(group('Docs'), 10);
      await record('s2');
      await cue('s2-01', async ms => {
        await web.clickOn(group('Boilerplate'), 800);
        const lock = fileTitle('client/pnpm-lock.yaml');
        await lock.waitFor();
        await web.scrollIntoStart(group('Boilerplate'));
        await sleep(ms * 0.2);
        await web.glideTo(p().getByText('pretty-bytes@7.2.0:', { exact: false }).first(), 1000);
        if (dry) shot('dry-s2-lock');
      });
      await cue('s2-02', async ms => {
        const pkg = fileTitle('client/package.json');
        await web.scrollIntoCenter(pkg);
        await web.glideTo(pkg, 800);
        await sleep(ms * 0.3);
        await web.glideTo(p().getByText('"pretty-bytes": "^7.2.0",', { exact: false }).first(), 700);
        if (dry) shot('dry-s2-package');
      });
      await sleep(500);
      await stop();
    },

    async s3() {
      await deleteRuns();
      await openDiff();
      await p().getByText('Review not run yet').first().waitFor();
      await web.glide(1400, 300, 10);
      await record('s3');
      await cue('s3-01', async ms => {
        await web.clickOn(p().getByRole('button', { name: /Run Review/ }), 700);
        const item = p().getByText('General Reviewer', { exact: true }).last();
        await item.waitFor();
        if (dry) shot('dry-s3-menu');
        await web.clickOn(item, 600);
        const running = p().getByText(/Running · 1 agent/).first();
        await running.waitFor();
        await glideBeside(running, 800, 0, 30);
        if (dry) shot('dry-s3-running');
      });
      await sleep(800);
      await stop();
    },

    async s4() {
      await ensureReviewed();
      await smartOrder();
      await p().evaluate(() => window.scrollTo(0, 0));
      await sleep(400);
      await web.glide(1400, 300, 10);
      await record('s4');
      await cue('s4-01', async ms => {
        const counter = group('Core').getByRole('img', { name: /files? with findings/ });
        await web.glideTo(counter, 900);
        await sleep(ms * 0.35);
        const card = fileTitle('client/src/lib/format-size.ts');
        await web.scrollIntoCenter(card);
        await glideBeside(p().getByRole('img', { name: 'This file has review findings' }).first(), 900);
        if (dry) shot('dry-s4-dot');
      });
      await cue('s4-02', async () => {
        await web.scrollIntoCenter(group('Tests'));
        await sleep(300);
        await glideBeside(group('Tests').getByRole('img', { name: /files? with findings/ }), 900);
        if (dry) shot('dry-s4-tests');
      });
      await sleep(500);
      await stop();
    },

    async s5() {
      await ensureReviewed();
      await smartOrder();
      const title = p().getByText(FINDING_TITLE).first();
      await title.waitFor({ timeout: 15000 });
      await web.scrollIntoCenter(title);
      await web.glide(1400, 250, 10);
      await record('s5');
      await cue('s5-01', async ms => {
        await web.glideTo(title, 900);
        await sleep(ms * 0.45);
        // Severity varies run to run (CRITICAL → "blocker", WARNING → "warning").
        const sev = p().getByText(/^(blocker|warning|suggestion)$/i).first();
        await sev.waitFor({ timeout: 10000 });
        await glideBeside(sev, 900, -10, 30);
        if (dry) shot('dry-s5-finding');
      });
      await cue('s5-02', async ms => {
        await web.glideTo(p().getByRole('button', { name: 'Accept', exact: true }).first(), 800);
        await sleep(ms * 0.3);
        await web.glideTo(p().getByRole('button', { name: 'Dismiss', exact: true }).first(), 700);
      });
      await cue('s5-03', async () => {
        const toggle = p().getByRole('button', { name: /Hide comments & findings/ }).first();
        await web.scrollIntoCenter(toggle);
        await web.glideTo(toggle, 900);
        if (dry) shot('dry-s5-toggle');
      });
      await sleep(500);
      await stop();
    },

    async s6() {
      await ensureDiff();
      await smartOrder();
      await p().evaluate(() => window.scrollTo(0, 0));
      await sleep(400);
      await web.glide(1400, 300, 10);
      await record('s6');
      await cue('s6-01', async ms => {
        await web.clickOn(p().getByRole('button', { name: 'Original order' }), 800);
        await fileTitle('client/.env.example').waitFor();
        await web.glideTo(fileTitle('client/.env.example'), 800);
        if (dry) shot('dry-s6-original');
        await sleep(ms * 0.35);
        await web.clickOn(p().getByRole('button', { name: 'Smart order' }), 800);
        await group('Core').waitFor();
      });
      await sleep(600);
      await stop();
    },

    async s7() {
      await ensureDiff();
      await smartOrder();
      await p().evaluate(() => window.scrollTo(0, 0));
      await sleep(400);
      await web.glide(1400, 300, 10);
      await record('s7');
      await cue('s7-01', async ms => {
        await web.glideTo(group('Core'), 900);
        await sleep(ms * 0.2);
        await web.scrollIntoCenter(group('Boilerplate'));
        await sleep(300);
        await web.glideTo(group('Boilerplate'), 900);
        if (dry) shot('dry-s7-end');
      });
      await sleep(900);
      await stop();
    },
  };
}
