// Scenes for the Eval Pipeline demo (demo/eval-pipeline/scenario.md).
// Browser-only video on the author's repo Svyat90/dev-digest, agent General Reviewer.
//
// Every scene's pre-roll (the code before `record`) restores the data the scene starts
// from through the API, so any scene can be re-shot on its own. Prepared data (9 agent
// cases, the v3/v4/v5 runs, 2 skill cases) is never touched; only cases created on
// camera are deleted. No scene starts an agent or skill eval run.

// FILMING order — not playback order. The video is concatenated in `config.order`.
export const order = ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8', 's9', 's10'];
export const browser = order;

const API = 'http://localhost:3001';
const REPO_ID = '562ddc32-33fe-4292-8ec5-83cc6bb2e528';
const AGENT_ID = '6f6e2eb2-b04c-4e37-8ed7-52f34bf52ccf'; // General Reviewer
const SKILL_ID = 'ebbe82a9-0b62-4104-8198-c71b7dc6006f'; // corner-case-checklist

const AGENT_CASES = [
  'notfounderror-returns-http-400-instead-of-404',
  'run-count-endpoint-returns-0-for-non-existent-agents-instead',
  'sql-injection-user-search', 'off-by-one-pagination', 'missing-await-save',
  'division-by-zero-average', 'hardcoded-api-token', 'clean-rename-helper', 'guarded-average',
];
const SKILL_CASES = ['empty-array-math-max-2', 'empty-array-guarded'];
const S2_FINDING = 'Breaking change to NotFoundError constructor without updating callers';

// The hand-written case typed in scene 4.
const S4_NAME = 'reduce-without-seed';
const S4_FILE = 'server/src/domain/stats/total.ts';
const S4_DIFF = [
  `diff --git a/${S4_FILE} b/${S4_FILE}`,
  `--- a/${S4_FILE}`,
  `+++ b/${S4_FILE}`,
  '@@ -1,2 +1,6 @@',
  ' export interface Sample { path: string; ms: number }',
  '+',
  '+export function totalMs(samples: Sample[]): number {',
  '+  return samples.map((s) => s.ms).reduce((a, b) => a + b);',
  '+}',
  ' export const MAX_SAMPLES = 1000;',
].join('\n') + '\n';
const S4_TITLE = 'reduce without a seed throws on an empty samples array';

async function api(method, path, body) {
  const r = await fetch(API + path, {
    method,
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok && r.status !== 404) throw new Error(`${method} ${path}: HTTP ${r.status} ${await r.text()}`);
  return r.status === 204 ? null : r.json().catch(() => null);
}

// Delete every case of an owner that is not part of the prepared set.
async function resetCases(kind, id, keep) {
  for (const c of (await api('GET', `/${kind}/${id}/eval-cases`)) ?? []) {
    if (!keep.includes(c.name)) await api('DELETE', `/eval-cases/${c.id}`);
  }
  const left = ((await api('GET', `/${kind}/${id}/eval-cases`)) ?? []).length;
  if (left !== keep.length) throw new Error(`${kind} ${id}: expected ${keep.length} cases, found ${left}`);
}
const resetAll = async () => {
  await resetCases('agents', AGENT_ID, AGENT_CASES);
  await resetCases('skills', SKILL_ID, SKILL_CASES);
};

export default function scenes(stage) {
  const { sleep, record, stop, cue, shot, web, config, dry } = stage;
  const p = () => web.page;
  const base = config.web.baseUrl;

  // The engine pins the app shell (inline `min-height: 100vh`) to 80vh, which only fills the
  // screen at zoom 1.25. Re-pin it to 100vh / zoom after every prep, so any zoom fills the
  // window with no black strip at the bottom. `web.open` calls `web.prep`, so both are covered.
  const shellFix = `html [style*="min-height: 100vh"], html [style*="min-height:100vh"]
    { min-height: calc(100vh / ${config.video.zoom}) !important; height: calc(100vh / ${config.video.zoom}) !important }`;
  const enginePrep = web.prep.bind(web);
  web.prep = async () => {
    await enginePrep();
    await web.page.addStyleTag({ content: shellFix }).catch(() => {});
  };

  // Off-path pages take the sidebar repo from localStorage["dd-repo"]; pin it.
  async function pinRepo() {
    await web.open(base);
    await p().evaluate(id => localStorage.setItem('dd-repo', id), REPO_ID);
  }
  async function settle() {
    await p().waitForLoadState('networkidle');
    await sleep(350);
  }
  const row = name => p().getByRole('listitem').filter({ hasText: name }).first();
  const btn = (name, exact = true) => p().getByRole('button', { name, exact });

  async function openAgentEvals() {
    await web.open(`${base}/agents/${AGENT_ID}`);
    await btn('Evals').click();
    await p().getByRole('heading', { name: 'Eval cases' }).waitFor();
    await web.prep();
    await settle();
  }
  async function openDashboard() {
    await web.open(`${base}/evals`);
    await p().getByRole('heading', { name: 'Eval Dashboard' }).waitFor();
    await settle();
  }
  async function openAgentDashboard() {
    await web.open(`${base}/evals/${AGENT_ID}`);
    await p().getByText(/^recent runs$/i).waitFor();
    await settle();
  }
  async function openSkillEvals() {
    await web.open(`${base}/skills/${SKILL_ID}`);
    await btn('Evals').click();
    await p().getByRole('heading', { name: 'Eval cases' }).waitFor();
    await web.prep();
    await settle();
  }
  // Scroll only the nearest scrollable ancestor (never the window: under the stage's CSS
  // zoom a window scroll cuts the header and leaves a black strip at the bottom).
  async function scrollTo(loc, block = 'center', topGap = 16) {
    await loc.evaluate(async (e, [block, topGap]) => {
      let box = e.parentElement;
      while (box && !(box.scrollHeight > box.clientHeight + 10 && /(auto|scroll)/.test(getComputedStyle(box).overflowY))) box = box.parentElement;
      if (!box) {
        // No scrollable container (zoom 1.0): the window is the scroller.
        e.scrollIntoView({ behavior: 'smooth', block });
        await new Promise(r => setTimeout(r, 700));
        return 'window';
      }
      const zoom = parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
      const er = e.getBoundingClientRect(), br = box.getBoundingClientRect();
      const off = block === 'start' ? (er.top - br.top) / zoom - topGap
        : (er.top + er.height / 2 - br.top - br.height / 2) / zoom;
      box.scrollTo({ top: box.scrollTop + off, behavior: 'smooth' });
      await new Promise(r => setTimeout(r, 700));
    }, [block, topGap]).then(async how => { if (how !== 'window') await page_reset(); });
  }
  async function page_reset() {
    await p().evaluate(() => window.scrollTo(0, 0));
  }
  // Rest the pointer just right of a text, so it never covers what is being pointed out.
  async function glideBeside(loc, ms = 1000, dx = 28) {
    const b = await textBox(loc);
    await web.glide(b.x + b.width + dx, b.y + b.height / 2, ms);
  }
  // The box of an element's rendered text, not of the (often full-width) block around it.
  async function textBox(loc) {
    const r = await loc.evaluate(e => {
      const range = document.createRange(); range.selectNodeContents(e);
      const t = range.getBoundingClientRect(), b = e.getBoundingClientRect();
      const box = t.width > 0 ? t : b;
      return { x: box.left, y: box.top, width: box.width, height: box.height };
    });
    return r ?? loc.boundingBox();
  }
  // Rest the pointer just below an element (a button with neighbours on both sides).
  async function glideBelow(loc, ms = 1000, dy = 26) {
    const b = await loc.boundingBox();
    await web.glide(b.x + b.width / 2, b.y + b.height + dy, ms);
  }
  // An agent row of the Eval Dashboard: the whole card is a link.
  const agentCard = name => p().getByRole('link').filter({ hasText: name }).first();

  // Rest the pointer in the gutter left of an element (outside row links: no Chrome link bubble).
  async function glideLeftOf(loc, ms = 1000, dx = 36) {
    const b = await loc.boundingBox();
    await web.glide(Math.max(8, b.x - dx), b.y + b.height / 2, ms);
  }

  // A run row of the agent dashboard, by version and passed count (unique in the prepared data).
  const runRow = (version, passed) =>
    p().getByRole('row').filter({ hasText: version }).filter({ hasText: passed }).first();

  // Smoothly scroll the scrollable box that holds `text` so that line sits near its top.
  async function scrollBoxTo(text) {
    return p().evaluate(async needle => {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode()) && !node.textContent.includes(needle)) {}
      if (!node) return null;
      let box = node.parentElement;
      while (box && !(box.scrollHeight > box.clientHeight + 10 && getComputedStyle(box).overflowY !== 'visible')) box = box.parentElement;
      const range = document.createRange();
      const i = node.textContent.indexOf(needle);
      range.setStart(node, i); range.setEnd(node, i + needle.length);
      if (box) {
        const zoom = parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
        const top = (range.getBoundingClientRect().top - box.getBoundingClientRect().top) / zoom;
        box.scrollTo({ top: box.scrollTop + top - 120, behavior: 'smooth' });
        await new Promise(r => setTimeout(r, 900));
      }
      return true;
    }, text);
  }

  return {
    async s1() {
      await resetAll();
      await pinRepo();
      await openDashboard();
      await web.glide(900, 300, 10);
      await record('s1');
      await cue('s1-01', async ms => {
        await web.glideTo(p().getByRole('heading', { name: 'Eval Dashboard' }), 1400);
        await sleep(ms * 0.4);
        await glideLeftOf(agentCard('General Reviewer'), 1400);
      });
      await cue('s1-02', async ms => {
        await sleep(ms * 0.4);
        await scrollTo(p().getByText(/recent eval runs/i));
        await glideLeftOf(p().getByText(/recent eval runs/i), 1400, 24);
      });
      await cue('s1-03', async () => {
        await scrollTo(p().getByRole('heading', { name: 'Eval Dashboard' }), 'start');
        await glideBeside(p().getByRole('heading', { name: 'Eval Dashboard' }), 1200, 60);
        if (dry) shot('dry-s1-end');
      });
      await sleep(600);
      await stop();
    },

    async s2() {
      await resetAll();
      await pinRepo();
      await web.open(`${base}/repos/${REPO_ID}/pulls/20`);
      await btn(/Agent runs/, false).click();
      await p().getByText(S2_FINDING).waitFor();
      await web.prep();
      await settle();
      const title = p().getByText(S2_FINDING).first();
      await scrollTo(p().getByText('NotFoundError returns HTTP 400 instead of 404').first());
      await web.glide(900, 300, 10);
      await record('s2');
      await cue('s2-01', async ms => {
        await glideBeside(p().getByText('Eval case exists').first(), 1400);
        await sleep(ms * 0.35);
        await scrollTo(title);
        await glideBeside(title, 1200, 40);
      });
      await cue('s2-02', async ms => {
        await web.clickOn(title, 700);
        const turn = btn('Turn into eval case');
        await turn.waitFor();
        await scrollTo(turn);
        await sleep(ms * 0.25);
        await web.clickOn(turn, 900);
        // Wait for the case to exist (API), then for the card to say so.
        for (let i = 0; i < 30; i++) {
          const n = ((await api('GET', `/agents/${AGENT_ID}/eval-cases`)) ?? []).length;
          if (n > AGENT_CASES.length) break;
          if (i === 29) { if (dry) shot('dry-s2-fail'); throw new Error('s2: Turn into eval case did not create a case'); }
          await sleep(500);
        }
        await p().getByText('Eval case exists').nth(1).waitFor({ timeout: 15000 });
        // The PR header and tabs are sticky: leave room for them above the title.
        await scrollTo(title, 'start', 240);
        await glideBeside(p().getByText('Eval case exists').nth(1), 600);
        if (dry) shot('dry-s2-created');
      });
      await cue('s2-03', async ms => {
        await web.glideTo(btn('Dismiss').first(), 1200);
        await sleep(ms * 0.4);
        await glideBeside(p().getByText('Eval case exists').nth(1), 1200);
      });
      await cue('s2-04', async () => {
        await web.glide(web.pos[0], web.pos[1] - 80, 900);
      });
      await sleep(600);
      await stop();
    },

    async s3() {
      // Scene 2 leaves 10 agent cases on screen; recreate that state when re-shot alone.
      const cases = (await api('GET', `/agents/${AGENT_ID}/eval-cases`)) ?? [];
      if (cases.length !== AGENT_CASES.length + 1) throw new Error('s3 needs the case made in s2: re-shoot s2 first');
      await openAgentEvals();
      await web.glide(900, 300, 10);
      await record('s3');
      await cue('s3-01', async ms => {
        await web.glideTo(p().getByRole('heading', { name: 'Eval cases' }), 1200);
        await sleep(ms * 0.3);
        await web.glideTo(row('sql-injection-user-search'), 1200);
      });
      await cue('s3-02', async ms => {
        await scrollTo(p().getByText('breaking-change-to-notfounderror', { exact: false }).first());
        await glideBeside(p().getByText('clean-rename-helper', { exact: true }), 1200);
        await sleep(ms * 0.35);
        await glideBeside(p().getByText('guarded-average', { exact: true }), 1000);
        if (dry) shot('dry-s3-rows');
      });
      await cue('s3-03', async ms => {
        await web.glideTo(btn('Run guarded-average'), 1000);
        await sleep(ms * 0.25);
        await scrollTo(p().getByRole('group', { name: 'RECALL' }), 'start', 60);
        await web.glideTo(btn('Run all evals'), 1000);
        await sleep(ms * 0.2);
        await web.glideTo(p().getByRole('group', { name: 'RECALL' }), 1000);
      });
      await sleep(600);
      await stop();
    },

    async s4() {
      // Only the case typed in this scene is removed; the one made in s2 stays on screen.
      for (const c of (await api('GET', `/agents/${AGENT_ID}/eval-cases`)) ?? []) {
        if (c.name === S4_NAME) await api('DELETE', `/eval-cases/${c.id}`);
      }
      await openAgentEvals();
      await web.glideTo(btn('New eval case'), 10);
      await record('s4');
      const dlg = () => p().getByRole('dialog');
      await cue('s4-01', async ms => {
        await sleep(ms * 0.45);
        await web.clickOn(btn('New eval case'), 900);
        await dlg().waitFor();
        await sleep(500);
        if (dry) shot('dry-s4-open');
      });
      await cue('s4-02', async ms => {
        await web.clickOn(dlg().getByRole('textbox', { name: 'Name' }), 500);
        await p().keyboard.type(S4_NAME, { delay: 35 });
        await web.clickOn(dlg().getByRole('textbox', { name: 'Diff' }), 600);
        await dlg().getByRole('textbox', { name: 'Diff' }).fill(S4_DIFF);
        await sleep(ms * 0.15);
        // Files first, while the Input tabs are still on screen; scroll only afterwards.
        const files = dlg().getByRole('button', { name: 'Files', exact: true });
        await scrollTo(files, 'start', 40);
        await web.clickOn(files, 700);
        await sleep(1400);
        if (dry) shot('dry-s4-files');
        await web.clickOn(dlg().getByRole('button', { name: 'Diff', exact: true }), 600);
        await scrollTo(dlg().getByRole('textbox', { name: 'Name' }), 'start');
        await glideBeside(dlg().getByText('Preview', { exact: true }), 700);
        if (dry) shot('dry-s4-diff');
      });
      await cue('s4-03', async ms => {
        const exp = dlg().getByRole('group', { name: 'Expectation' });
        await scrollTo(exp);
        await web.glideTo(exp.getByRole('radio', { name: 'must find' }), 700);
        await web.glideTo(exp.getByRole('combobox', { name: 'File' }), 700);
        await exp.getByRole('combobox', { name: 'File' }).selectOption(S4_FILE);
        await web.clickOn(exp.getByRole('spinbutton', { name: 'End line' }), 500);
        await exp.getByRole('spinbutton', { name: 'End line' }).fill('5');
        await web.clickOn(exp.getByRole('spinbutton', { name: 'Start line' }), 500);
        await exp.getByRole('spinbutton', { name: 'Start line' }).fill('3');
        await exp.getByRole('spinbutton', { name: 'Start line' }).blur();
        await sleep(400);
        if (dry) shot('dry-s4-expectation');
      });
      await cue('s4-04', async ms => {
        await web.clickOn(dlg().getByRole('button', { name: '+ Finding skeleton' }), 800);
        await sleep(ms * 0.3);
        const out = dlg().getByRole('textbox', { name: 'Expected output' });
        await web.clickOn(out, 600);
        const skeleton = await out.inputValue();
        await out.fill(skeleton.replace('"title": ""', `"title": "${S4_TITLE}"`));
        await glideBeside(dlg().getByText('valid JSON'), 800);
        if (dry) shot('dry-s4-json');
        // Save now, so Run case can start at the very top of s4-05: the model answer then
        // has both s4-05 and s4-06 to land in, instead of leaving dead air after s4-06.
        await sleep(ms * 0.25);
        await web.clickOn(dlg().getByRole('button', { name: 'Save', exact: true }), 700);
      });
      await cue('s4-05', async () => {
        const run = dlg().getByRole('button', { name: 'Run case' });
        await run.and(p().locator(':enabled')).waitFor({ timeout: 15000 });
        await web.clickOn(run, 600);
        // Bring the in-progress status row fully into view and keep the pointer off the button.
        const status = dlg().getByText(/^Running/).first();
        await status.waitFor({ timeout: 10000 }).catch(() => {});
        if (await status.count()) {
          await scrollTo(status);
          await glideBeside(status, 800, 40);
        }
        if (dry) shot('dry-s4-running');
      });
      await cue('s4-06', async () => {
        await dlg().getByText(/Last run (passed|failed|errored)/).waitFor({ timeout: 120000 });
        await scrollTo(dlg().getByText(/Last run/));
        await glideBeside(dlg().getByText(/Last run/), 900, 40);
        if (dry) shot('dry-s4-lastrun');
      });
      await sleep(800);
      await stop();
      await web.page.keyboard.press('Escape').catch(() => {});
    },

    async s5() {
      await openAgentEvals();
      await web.glide(900, 300, 10);
      await record('s5');
      await cue('s5-01', async ms => {
        await web.glideTo(row('sql-injection-user-search'), 1200);
        await sleep(ms * 0.4);
        await web.glideTo(row('off-by-one-pagination'), 1000);
      });
      await cue('s5-02', async ms => {
        await sleep(ms * 0.3);
        await web.glideTo(row('clean-rename-helper'), 1200);
      });
      await cue('s5-03', async ms => {
        await glideBeside(p().getByRole('group', { name: 'RECALL' }).getByText(/^recall$/i), 1000);
        await sleep(ms * 0.45);
        await glideBeside(p().getByRole('group', { name: 'PRECISION' }).getByText(/^precision$/i), 1000);
      });
      await cue('s5-04', async () => {
        await glideBelow(p().getByRole('group', { name: 'CITATION ACCURACY' }), 1000, 16);
        if (dry) shot('dry-s5-cards');
      });
      await sleep(600);
      await stop();
    },

    async s6() {
      await openDashboard();
      await web.glide(900, 300, 10);
      await record('s6');
      await cue('s6-01', async ms => {
        await web.glideTo(p().getByRole('link', { name: 'Eval Dashboard' }), 1200);
        await sleep(ms * 0.3);
        await glideLeftOf(agentCard('General Reviewer'), 1200);
      });
      await cue('s6-02', async () => {
        await glideLeftOf(agentCard('API Contract Reviewer'), 1200);
        if (dry) shot('dry-s6-nocases');
      });
      await cue('s6-03', async ms => {
        await web.glideTo(btn('Run all agents'), 1200);
        await sleep(ms * 0.5);
        await web.glideTo(p().getByText(/recent eval runs/i), 1200);
      });
      await sleep(600);
      await stop();
    },

    async s7() {
      await openAgentDashboard();
      await web.glide(900, 300, 10);
      const chart = p().getByText(/^metric trend$/i).locator('xpath=ancestor::div[2]');
      await record('s7');
      await cue('s7-01', async ms => {
        await web.glideTo(p().getByText(/^recall$/i).first(), 1100);
        await sleep(ms * 0.3);
        await scrollTo(chart);
        await web.glideTo(chart, 1000);
      });
      await cue('s7-02', async ms => {
        const bb = await p().locator('.recharts-surface').first().boundingBox();
        if (bb) {
          for (const f of [0.35, 0.7, 0.97]) {
            await web.glide(bb.x + bb.width * f, bb.y + bb.height * 0.5, 900);
            await sleep(ms * 0.15);
          }
        }
        await sleep(300);
        if (dry) shot('dry-s7-tooltip');
      });
      await cue('s7-03', async () => {
        await scrollTo(p().getByText(/^recall$/i).first(), 'start');
        await web.glideTo(p().getByText(/^recall$/i).first(), 1000);
        await glideBeside(p().getByText(/^precision$/i).first(), 1000);
      });
      await cue('s7-04', async () => {
        await scrollTo(runRow('v4', '7 / 9'));
        await glideLeftOf(runRow('v3', '8 / 9'), 1200, 20);
        if (dry) shot('dry-s7-runs');
      });
      await sleep(600);
      await stop();
    },

    async s8() {
      await openAgentDashboard();
      await scrollTo(runRow('v3', '8 / 9'));
      await web.glide(900, 300, 10);
      await record('s8');
      const dlg = () => p().getByRole('dialog');
      await cue('s8-01', async ms => {
        await web.glideTo(runRow('v4', '7 / 9'), 1000);
        await sleep(ms * 0.3);
        await web.glideTo(runRow('v5', '8 / 9'), 1000);
      });
      await cue('s8-02', async ms => {
        await web.clickOn(runRow('v3', '8 / 9').getByRole('checkbox'), 800);
        await web.clickOn(runRow('v5', '8 / 9').getByRole('checkbox'), 800);
        await scrollTo(btn('Compare'));
        await web.clickOn(btn('Compare'), 800);
        await dlg().getByText(/Compare runs · v3 → v5/).waitFor();
        await sleep(ms * 0.1);
        await web.glideTo(dlg().getByText(/^recall$/i).first(), 900);
        await web.glideTo(dlg().getByText(/^precision$/i).first(), 900);
        if (dry) shot('dry-s8-deltas');
      });
      await cue('s8-03', async ms => {
        await web.glideTo(dlg().getByRole('heading', { name: 'System prompt diff' }), 900);
        await sleep(ms * 0.2);
        await scrollBoxTo('Also comment on every unused import');
        await glideLeftOf(dlg().getByText(/Also comment on every unused import/).first(), 900, 20);
        if (dry) shot('dry-s8-diff');
      });
      await cue('s8-04', async () => {
        await web.glideTo(dlg().getByText(/^precision$/i).first(), 1000);
      });
      await cue('s8-05', async ms => {
        await glideBelow(dlg().getByRole('button', { name: /Promote/ }), 1000, 14);
        await sleep(ms * 0.55);
        await web.clickOn(dlg().getByRole('button', { name: 'Close' }).last(), 800);
      });
      await cue('s8-06', async ms => {
        await scrollTo(runRow('v4', '7 / 9'));
        await glideLeftOf(runRow('v4', '6 / 9'), 1000, 20);
        await sleep(ms * 0.3);
        await glideLeftOf(runRow('v4', '7 / 9'), 900, 20);
      });
      await sleep(600);
      await stop();
    },

    async s9() {
      await resetCases('skills', SKILL_ID, SKILL_CASES);
      await openSkillEvals();
      await web.glide(900, 300, 10);
      await record('s9');
      await cue('s9-01', async ms => {
        await web.glideTo(p().getByRole('heading', { name: 'corner-case-checklist' }), 1200);
        await sleep(ms * 0.35);
        await web.glideTo(p().getByRole('heading', { name: 'Eval cases' }), 1000);
      });
      await cue('s9-02', async ms => {
        await scrollTo(p().getByRole('heading', { name: 'Eval cases' }), 'start');
        await web.glideTo(btn('Run all evals'), 1000);
        await sleep(ms * 0.3);
        await glideBelow(btn('Change agent').first(), 1000, 18);
        if (dry) shot('dry-s9-agent');
      });
      await cue('s9-03', async ms => {
        await scrollTo(btn('Edit empty-array-guarded'));
        await web.clickOn(btn('Edit empty-array-guarded'), 900);
        await p().getByRole('dialog').waitFor();
        await sleep(ms * 0.2);
        if (dry) shot('dry-s9-editor');
        await web.clickOn(p().getByRole('dialog').getByRole('button', { name: 'Cancel' }), 700);
        const hist = p().getByText(/skill v1/).first();
        await scrollTo(hist);
        await glideBeside(hist, 900);
      });
      await sleep(600);
      await stop();
    },

    async s10() {
      await resetAll();
      await openDashboard();
      await web.glide(900, 300, 10);
      await record('s10');
      await cue('s10-01', async ms => {
        await glideLeftOf(agentCard('General Reviewer'), 1400);
        await sleep(ms * 0.4);
        await glideLeftOf(p().getByText(/recent eval runs/i), 1400, 24);
      });
      await cue('s10-02', async () => {
        await scrollTo(p().getByRole('heading', { name: 'Eval Dashboard' }), 'start');
        await glideBeside(p().getByRole('heading', { name: 'Eval Dashboard' }), 1400, 60);
      });
      await sleep(1000);
      await stop();
    },
  };
}
