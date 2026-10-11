// Scenes for the L05 demo (demo/project-context/scenario.md): Project Context + PR Brief.
// Browser-only video. Test PR: Svyat90/dev-digest#20 (studio id below); process PR: #19 on github.com.
//
// Mutations, each restored by its own pre-roll so any scene can be re-shot alone:
//   s2 ticks/unticks one attachment on General Reviewer — pre-roll PUTs the known state;
//   s4 clicks Generate brief (one paid model call) — pre-roll deletes the stored brief.
// Everything else is read-only. config.neverClick is never clicked.

import { execFileSync } from 'node:child_process';

// FILMING order — same as playback order here.
export const order = ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8', 's9'];
export const browser = order;

const REPO_ID = '562ddc32-33fe-4292-8ec5-83cc6bb2e528'; // Svyat90/dev-digest
const PR_ID = 'c4f0b936-c09c-4691-8105-7fa45cbc5654'; // studio id of PR #20
const PR_NUMBER = 20;
const GENERAL_REVIEWER = '6f6e2eb2-b04c-4e37-8ed7-52f34bf52ccf';
const API = 'http://localhost:3001';
const GH = 'https://github.com/Svyat90/dev-digest';

export default function scenes(stage) {
  const { sleep, record, stop, cue, shot, web, config, dry } = stage;
  const p = () => web.page;
  const base = config.web.baseUrl;
  const prUrl = tab => `${base}/repos/${REPO_ID}/pulls/${PR_NUMBER}?tab=${tab}`;

  // ---- helpers ------------------------------------------------------------
  async function setActiveRepo() {
    await web.open(base);
    await p().evaluate(id => localStorage.setItem('dd-repo', id), REPO_ID);
  }
  async function openOverview() {
    await web.open(prUrl('overview'));
    await p().getByText('PR Brief', { exact: true }).first().waitFor();
    await p().evaluate(() => window.scrollTo(0, 0));
    await sleep(500);
  }
  async function putAgentDocs(paths) {
    const r = await fetch(`${API}/agents/${GENERAL_REVIEWER}/context-docs`, {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ paths }),
    });
    if (!r.ok) throw new Error(`PUT context-docs → ${r.status}`);
  }
  function deleteBrief() {
    execFileSync('docker', ['exec', 'devdigest-postgres', 'psql', '-U', 'devdigest', '-d', 'devdigest',
      '-c', `delete from pr_brief where pr_id='${PR_ID}'`]);
  }
  async function briefExists() {
    const r = await fetch(`${API}/pulls/${PR_ID}/brief`);
    const j = await r.json();
    return j !== null && !j.error;
  }
  const riskHeading = () => p().getByRole('heading', { name: 'Risk areas' });
  const focusLabel = () => p().getByText(/^Review focus — read these first/).first();
  // Prefer the agents/routes.ts focus item (its finding is the layering blocker); else the first one.
  async function focusItem() {
    const routes = p().getByRole('button', { name: /^server\/src\/modules\/agents\/routes\.ts:\d+ — / });
    if (await routes.count()) return routes.first();
    return p().getByRole('button', { name: /^\S+:\d+ — / }).first();
  }
  async function glideBeside(loc, ms, dx = 28, dy = 26) {
    const [x, y] = await web.center(loc);
    await web.glide(x + dx, y + dy, ms);
  }

  return {
    // Project Context page: list, truncated, filter, preview, Used by.
    async s1() {
      await setActiveRepo();
      await web.open(`${base}/repos/${REPO_ID}/context`);
      const search = p().getByRole('searchbox', { name: 'Filter by path…' });
      await search.waitFor();
      await search.fill('');
      await web.glide(1400, 300, 10);
      await record('s1');
      await cue('s1-01', async ms => {
        await sleep(ms * 0.2);
        await web.glideTo(p().getByRole('link', { name: 'Project Context' }), 900);
        await sleep(ms * 0.25);
        await web.glideTo(p().getByRole('heading', { name: /^Project context in / }), 900);
        if (dry) shot('dry-s1-page');
      });
      await cue('s1-02', async ms => {
        await web.glideTo(p().getByRole('button', { name: /^INSIGHTS\.md insights/ }), 800);
        await sleep(ms * 0.25);
        await web.glideTo(p().getByRole('button', { name: /^client\/INSIGHTS\.md .*truncated$/ }), 900);
        if (dry) shot('dry-s1-truncated');
      });
      await cue('s1-03', async ms => {
        await web.clickOn(search, 600);
        await search.pressSequentially('layering', { delay: 90 });
        const doc = p().getByRole('button', { name: /^server\/specs\/layering\.md / });
        await doc.waitFor();
        await web.clickOn(doc, 500);
        const l1 = p().getByRole('heading', { name: /Invariant L1/ });
        await l1.waitFor();
        await web.glideTo(l1, 800);
        await sleep(ms * 0.15);
        await web.glideTo(p().getByText(/^Used by \d+ agents/).first(), 800);
        if (dry) shot('dry-s1-preview');
      });
      await stop();
    },

    // Agent Context tab: counter, tick/untick architecture.md.
    async s2() {
      await putAgentDocs(['server/specs/layering.md']);
      await setActiveRepo();
      await web.open(`${base}/agents/${GENERAL_REVIEWER}?tab=context`);
      const counter = p().getByText(/\d+ of \d+ attached/).first();
      await counter.waitFor();
      const arch = p().getByRole('checkbox', { name: 'Attach server/docs/architecture.md' });
      await web.glide(1400, 300, 10);
      await record('s2');
      await cue('s2-01', async ms => {
        await sleep(ms * 0.15);
        await web.glideTo(counter, 900);
        await sleep(ms * 0.2);
        await web.glideTo(p().getByText('server/specs/layering.md').first(), 900);
        if (dry) shot('dry-s2-counter');
      });
      await cue('s2-02', async ms => {
        await web.scrollIntoCenter(arch);
        await sleep(700);
        await web.clickOn(arch, 700);
        await p().getByText(/2 of \d+ attached/).first().waitFor();
        // A ticked row moves up to the attached group; go back to the counter to show it.
        await web.scrollIntoCenter(counter);
        await sleep(700);
        await web.glideTo(counter, 600);
        if (dry) shot('dry-s2-ticked');
        await sleep(ms * 0.1);
        await web.clickOn(arch, 600);
        await p().getByText(/1 of \d+ attached/).first().waitFor();
      });
      await cue('s2-03', async ms => {
        await web.scrollIntoCenter(counter);
        await sleep(600);
        await web.glideTo(p().getByText('server/specs/layering.md').first(), 900);
        await sleep(ms * 0.3);
      });
      await stop();
      await putAgentDocs(['server/specs/layering.md']);
    },

    // PR #20 Agent runs → General Reviewer trace: Specs read, the layering finding,
    // the project context block, Tool calls.
    async s3() {
      await setActiveRepo();
      await web.open(prUrl('findings'));
      const traceBtn = p().getByRole('button', { name: 'Open run trace & logs' }).first();
      await traceBtn.waitFor();
      await web.glide(1400, 300, 10);
      await record('s3');
      const d = () => p().getByRole('dialog');
      await cue('s3-01', async ms => {
        await sleep(ms * 0.2);
        await web.glideTo(p().getByRole('button', { name: 'General Reviewer' }).first(), 800);
        await sleep(ms * 0.15);
        await web.clickOn(traceBtn, 700);
        await d().getByText('Specs read', { exact: true }).waitFor();
        if (dry) shot('dry-s3-drawer');
      });
      await cue('s3-02', async ms => {
        await web.glideTo(d().getByText('Specs read', { exact: true }), 700);
        await sleep(ms * 0.3);
        const f = d().getByText('Route directly queries the database, violating layering rules').first();
        await web.scrollIntoCenter(f);
        await sleep(900);
        await web.glideTo(f, 800);
        if (dry) shot('dry-s3-finding');
      });
      // Between cues: open Prompt assembly and the project context block.
      const pa = d().getByText('Prompt assembly', { exact: true });
      await web.scrollIntoCenter(pa);
      await sleep(700);
      await web.clickOn(pa, 600);
      const pc = d().getByText('Project context — attached specs (untrusted)', { exact: true });
      await pc.waitFor();
      await web.clickOn(pc, 600);
      const untrusted = d().getByText(/<untrusted source="server\/specs\/layering\.md">/).first();
      await untrusted.waitFor();
      await web.scrollIntoCenter(untrusted);
      await sleep(900);
      await web.glideTo(untrusted, 600);
      if (dry) shot('dry-s3-untrusted');
      await cue('s3-03', async ms => {
        await sleep(ms * 0.25);
        const tc = d().getByText(/^Tool calls/).first();
        await web.scrollIntoCenter(tc);
        await sleep(800);
        await web.glideTo(tc, 700);
        if (dry) shot('dry-s3-toolcalls');
      });
      await stop();
    },

    // Generate brief — one paid call. The wait is outside the recording, so it is cut.
    async s4() {
      deleteBrief();
      await setActiveRepo();
      await openOverview();
      const gen = p().getByRole('button', { name: 'Generate brief' });
      await gen.waitFor();
      await web.glide(1400, 260, 10);
      await record('s4');
      await cue('s4-01', async ms => {
        await sleep(ms * 0.2);
        await web.glideTo(p().getByText('PR Brief', { exact: true }).first(), 800);
        await sleep(ms * 0.2);
        await web.glideTo(p().getByText('No brief for this PR yet'), 700);
        if (dry) shot('dry-s4-empty');
        await sleep(ms * 0.1);
        await web.clickOn(gen, 700);
      });
      await cue('s4-02', async ms => {
        await sleep(ms * 0.3);
        await web.glideTo(p().getByText('PR Brief', { exact: true }).first(), 900);
        if (dry) shot('dry-s4-generating');
      });
      await stop();
      await riskHeading().waitFor({ timeout: 300_000 });
    },

    // The brief, top to bottom (cue order follows the recorded audio: risks, then intent + blast).
    async s5() {
      if (!(await briefExists())) throw new Error('no brief stored — film s4 first');
      await setActiveRepo();
      await openOverview();
      await riskHeading().waitFor();
      await web.glide(1400, 260, 10);
      await record('s5');
      await cue('s5-01', async ms => {
        await sleep(ms * 0.1);
        await web.glideTo(p().getByText('Request changes', { exact: true }).first(), 800);
        await sleep(ms * 0.25);
        await web.glideTo(p().getByText(/^Generated /).first(), 900);
        if (dry) shot('dry-s5-top');
      });
      await cue('s5-02', async ms => {
        await web.scrollIntoStart(riskHeading());
        await sleep(900);
        await web.glideTo(riskHeading(), 600);
        const ref = p().getByRole('button', { name: /^server\/\S+:\d+-\d+$/ }).first();
        await web.glideTo(ref, 700);
        const expl = p().getByRole('button', { name: /^Show explanation: / }).first();
        await web.clickOn(expl, 600);
        if (dry) shot('dry-s5-risk-open');
        await sleep(ms * 0.2);
        await web.clickOn(expl, 400);
      });
      await cue('s5-03', async ms => {
        const intent = p().locator('blockquote').first();
        await web.scrollIntoCenter(intent);
        await sleep(900);
        await web.glideTo(intent, 700);
        if (dry) shot('dry-s5-intent');
        await sleep(ms * 0.3);
        const symbols = p().getByText('symbols', { exact: true }).first();
        // Centre, not start: at the top the stats row slides under the sticky PR header.
        await web.scrollIntoCenter(symbols);
        await sleep(900);
        await web.glideTo(symbols, 600);
        await web.glideTo(p().getByText('cron/jobs', { exact: true }).first(), 900);
        if (dry) shot('dry-s5-blast');
      });
      await cue('s5-04', async ms => {
        await web.scrollIntoStart(focusLabel());
        await sleep(1000);
        await web.glideTo(focusLabel(), 600);
        await sleep(ms * 0.15);
        await glideBeside(await focusItem(), 900, 0, 0);
        if (dry) shot('dry-s5-focus');
      });
      await stop();
    },

    // A Review focus item → Files changed on that file and line.
    async s6() {
      if (!(await briefExists())) throw new Error('no brief stored — film s4 first');
      await setActiveRepo();
      await openOverview();
      await riskHeading().waitFor();
      await web.scrollIntoStart(focusLabel());
      await sleep(900);
      const item = await focusItem();
      await web.glideTo(focusLabel(), 10);
      await record('s6');
      await cue('s6-01', async ms => {
        await sleep(ms * 0.1);
        await web.clickOn(item, 800);
        const target = p().locator('[aria-current=location]').first();
        await target.waitFor();
        await web.prep();
        await sleep(900);
        await web.glideTo(target, 800);
        if (dry) shot('dry-s6-target');
      });
      await cue('s6-02', async ms => {
        const blocker = p().getByText('Route directly queries the database, violating layering rules').first();
        const loc = (await blocker.count()) ? blocker : p().getByText('BLOCKER', { exact: true }).first();
        await web.glideTo(loc, 900);
        if (dry) shot('dry-s6-blocker');
        await sleep(ms * 0.3);
      });
      await stop();
    },

    // Reload: the brief is back without a generation.
    async s7() {
      if (!(await briefExists())) throw new Error('no brief stored — film s4 first');
      await setActiveRepo();
      await openOverview();
      await riskHeading().waitFor();
      await web.glide(1400, 260, 10);
      await record('s7');
      await cue('s7-01', async ms => {
        await sleep(ms * 0.1);
        await p().reload({ waitUntil: 'networkidle' });
        await web.prep();
        await riskHeading().waitFor();
        await sleep(400);
        await web.glideTo(p().getByText(/^Generated /).first(), 900);
        if (dry) shot('dry-s7-reloaded');
        await sleep(ms * 0.2);
      });
      await stop();
    },

    // PR #19 on github.com: process artifacts, cross-model note, spec ACs, plan Checks.
    async s8() {
      const gh = { wait: 'domcontentloaded', settle: 2500 };
      await web.open(`${GH}/pull/19`, gh);
      const artifacts = p().getByRole('heading', { name: 'Process artifacts' });
      await artifacts.waitFor();
      await web.glide(1400, 300, 10);
      await record('s8');
      await cue('s8-01', async ms => {
        await web.scrollIntoCenter(artifacts);
        await sleep(1000);
        await web.glideTo(artifacts, 700);
        await sleep(ms * 0.15);
        await web.glideTo(p().getByText('specs/03-pr-brief-2026-10-04.md').first(), 700);
        await web.glideTo(p().getByText('docs/plans/2026-10-04-pr-brief.md').last(), 700);
        if (dry) shot('dry-s8-artifacts');
      });
      await cue('s8-02', async ms => {
        const cm = p().getByText('Cross-model review.', { exact: true }).first();
        await web.glideTo(cm, 700);
        await sleep(ms * 0.2);
        await glideBeside(cm, 1600, 420, 0);
        if (dry) shot('dry-s8-crossmodel');
      });
      await web.open(`${GH}/blob/main/specs/03-pr-brief-2026-10-04.md#acceptance-criteria-ears`, gh);
      const ears = p().getByRole('heading', { name: 'Acceptance criteria (EARS)' });
      await web.scrollIntoCenter(ears);
      await sleep(900);
      await cue('s8-03', async ms => {
        await web.glideTo(ears, 600);
        if (dry) shot('dry-s8-spec');
        await sleep(ms * 0.2);
        await web.wheel(300, 6, 30);
      });
      // Rendered preview, not ?plain=1: GitHub's virtualised code view renders blank under CSS zoom.
      await web.open(`${GH}/blob/main/docs/plans/2026-10-04-pr-brief.md#checks`, gh);
      const checks = p().getByRole('heading', { name: 'Checks', exact: true });
      await web.scrollIntoCenter(checks);
      await sleep(900);
      await cue('s8-04', async ms => {
        await web.glideTo(checks, 700);
        await sleep(ms * 0.15);
        const pass = p().getByRole('cell', { name: /^PASS \(0 findings/ }).first();
        if (await pass.count()) await web.glideTo(pass, 900);
        await sleep(ms * 0.15);
        const verifier = p().getByRole('cell', { name: /^GAPS \(MET 40/ }).first();
        if (await verifier.count()) await web.glideTo(verifier, 900);
        if (dry) shot('dry-s8-checks');
        await sleep(ms * 0.2);
      });
      await stop();
    },

    // Closing line over the brief.
    async s9() {
      if (!(await briefExists())) throw new Error('no brief stored — film s4 first');
      await setActiveRepo();
      await openOverview();
      await riskHeading().waitFor();
      await web.glide(1400, 260, 10);
      await record('s9');
      await cue('s9-01', async ms => {
        await sleep(ms * 0.15);
        await web.glideTo(p().getByText('PR Brief', { exact: true }).first(), 900);
        await sleep(ms * 0.25);
        await web.glideTo(p().getByText(/^Generated /).first(), 1200);
        if (dry) shot('dry-s9');
        await sleep(ms * 0.2);
      });
      await stop();
    },
  };
}
