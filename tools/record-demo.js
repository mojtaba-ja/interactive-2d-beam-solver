/* =====================================================================
   Regenerates docs/demo.gif and docs/demo.mp4 in one command.

   Not part of the build, and nothing in the app depends on it - run it
   only when the UI changes enough that the demo looks wrong.

     npm install -g playwright      # needs Chrome and ffmpeg on PATH too
     node tools/record-demo.js

   Install playwright GLOBALLY, not into this folder: the project lives on
   Google Drive, and sync races npm badly enough to leave truncated files
   in node_modules.  For the same reason the frames are written to the OS
   temp directory rather than next to the source, then deleted.

   How it works: the page is driven one video frame at a time - nudge the
   mouse, screenshot, repeat - so capture speed is decoupled from playback
   speed and the motion comes out perfectly smooth however slow the machine
   is. Screenshots hold the viewport only, so there is no browser chrome in
   the result. Chrome does not draw the pointer into a screenshot, so the
   cursor and its click ripple are an SVG injected into the page and moved
   by hand each frame.

   Drag targets are found by querying the live DOM for [data-kind] elements
   rather than hardcoding pixels, so the choreography survives small layout
   changes. The GIF is quantised in two passes - build one optimal palette
   from the whole clip, then apply it - which is what keeps 27 seconds
   under about 2 MB.
   ===================================================================== */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');   // used for ffmpeg

/* deliberately not a local dependency - see the note above.  The global
   install is found by path: shelling out to npm is not portable here,
   because Node refuses to spawn npm.cmd without a shell on Windows. */
let chromium;
const globalRoots = [
  process.env.npm_config_prefix && path.join(process.env.npm_config_prefix, 'node_modules'),
  process.env.APPDATA && path.join(process.env.APPDATA, 'npm', 'node_modules'),
  '/usr/local/lib/node_modules',
  '/usr/lib/node_modules'
].filter(Boolean);

for (const root of [null].concat(globalRoots)) {
  try {
    ({ chromium } = require(root ? path.join(root, 'playwright') : 'playwright'));
    break;
  } catch (e) { /* try the next one */ }
}
if (!chromium) {
  console.error('playwright not found.  Install it with:  npm install -g playwright');
  process.exit(1);
}

const W = 1180, H = 970, DSF = 2, FPS = 30;
const OUT = path.join(os.tmpdir(), 'beam-demo-frames');
const DOCS = path.join(__dirname, '..', 'docs');
const URL = 'file://' + path.join(__dirname, '..', 'index.html').replace(/\\/g, '/');

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

let n = 0;
const ease = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

(async () => {
  const browser = await chromium.launch({ channel: 'chrome' });
  const ctx = await browser.newContext({
    viewport: { width: W, height: H }, deviceScaleFactor: DSF,
    reducedMotion: 'reduce', colorScheme: 'light'
  });
  /* start from an explicit light theme, so one click of Theme reaches dark */
  await ctx.addInitScript(() => {
    try { localStorage.setItem('beamsolver.theme', 'light'); } catch (e) {}
  });
  const page = await ctx.newPage();
  await page.goto(URL);
  await page.waitForTimeout(1500);

  /* ---- the cursor, drawn into the page ------------------------------- */
  await page.addStyleTag({ content: `
    #__cur{position:fixed;left:0;top:0;width:26px;height:26px;z-index:2147483647;
      pointer-events:none;margin:-2px 0 0 -2px;filter:drop-shadow(0 2px 3px rgba(0,0,0,.45))}
    #__ring{position:fixed;left:0;top:0;z-index:2147483646;pointer-events:none;
      border-radius:50%;border:2.5px solid #2a78d6;background:rgba(42,120,214,.16)}
  `});
  await page.evaluate(() => {
    const c = document.createElement('div'); c.id = '__cur';
    c.innerHTML = `<svg viewBox="0 0 24 24" width="26" height="26">
      <path d="M4 2 L4 20 L9 15.5 L12.2 22 L15.6 20.3 L12.4 14 L19 14 Z"
            fill="#fff" stroke="#111" stroke-width="1.4" stroke-linejoin="round"/></svg>`;
    const r = document.createElement('div'); r.id = '__ring'; r.style.opacity = 0;
    document.body.append(c, r);
    window.__cur = (x, y, rad, op) => {
      c.style.transform = `translate(${x}px,${y}px)`;
      r.style.opacity = op;
      r.style.width = r.style.height = rad * 2 + 'px';
      r.style.transform = `translate(${x - rad}px,${y - rad}px)`;
    };
  });

  let mx = W + 40, my = H / 2, ringR = 0, ringOp = 0;

  async function shot() {
    await page.evaluate(([x, y, r, o]) => window.__cur(x, y, r, o), [mx, my, ringR, ringOp]);
    await page.screenshot({ path: path.join(OUT, String(n++).padStart(5, '0') + '.png') });
  }
  const hold = async f => { for (let i = 0; i < f; i++) await shot(); };

  async function moveTo(x, y, frames) {
    const x0 = mx, y0 = my;
    for (let i = 1; i <= frames; i++) {
      const t = ease(i / frames);
      mx = x0 + (x - x0) * t; my = y0 + (y - y0) * t;
      await page.mouse.move(mx, my);
      await shot();
    }
  }
  async function pressPulse() {                       // click ripple, ~8 frames
    for (let i = 0; i < 8; i++) {
      ringR = 4 + 22 * (i / 7); ringOp = 1 - i / 7;
      await shot();
    }
    ringR = 0; ringOp = 0;
  }
  async function clickAt(x, y, settle = 6) {
    await page.mouse.move(x, y); mx = x; my = y;
    await page.mouse.down(); await page.mouse.up();
    await pressPulse(); await hold(settle);
  }
  async function dragTo(x, y, frames) {
    await page.mouse.down();
    /* the readout tooltip is frozen from before the grab - hide it */
    await page.evaluate(() => { const t = document.getElementById('tip'); if (t) t.style.display = 'none'; });
    ringR = 13; ringOp = 0.9;
    await moveTo(x, y, frames);
    await page.mouse.up();
    ringR = 0; ringOp = 0;
  }

  const box = sel => page.evaluate(s => {
    const e = document.querySelector(s); if (!e) return null;
    const r = e.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2,
             left: r.x, right: r.x + r.width, w: r.width,
             top: r.y, bottom: r.y + r.height };
  }, sel);

  const loadExample = async i => {
    await page.evaluate(k => {
      const s = document.getElementById('exampleSel');
      s.value = String(k); s.dispatchEvent(new Event('change', { bubbles: true }));
    }, i);
    await page.waitForTimeout(250);
  };

  /* ======================= choreography ============================== */

  /* A - simply supported under a uniform load */
  await loadExample(0);
  const sel = await box('#exampleSel');
  await hold(10);
  await moveTo(sel.x, sel.y, 22);
  await pressPulse();
  await hold(14);

  const stage = await box('#stage');
  const span = stage.w;                    // scale every gesture off this

  /* B - drag the right-hand roller inward; the diagrams follow live */
  const sups = await page.$$eval('#stage [data-kind="support"]', els =>
    els.map(e => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }));
  const right = sups[sups.length - 1];
  await moveTo(right.x, right.y, 26);
  await hold(6);
  await dragTo(right.x - 0.21 * span, right.y, 46);
  await hold(20);

  /* C - double-click empty space over the new overhang to drop a point load */
  const beam = await box('#stage [data-kind="beam"]');
  const dcX = right.x - 0.085 * span, dcY = beam.bottom + 30;
  await moveTo(dcX, dcY, 22);
  await hold(5);
  await page.mouse.dblclick(dcX, dcY);
  const added = await page.$$eval('#stage [data-kind="load"][data-handle="body"]', e => e.length);
  if (added < 3) console.warn('WARN: the double-click did not add a point load');
  await pressPulse();
  await hold(26);

  /* D - drag that point load along the span */
  const pl = (await page.$$eval('#stage [data-kind="load"]', els =>
    els.map(e => { const r = e.getBoundingClientRect(); return { h: e.getAttribute('data-handle'), x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width }; })
      .filter(o => o.h === 'body' && o.w < 90)))
    .sort((a, b) => Math.abs(a.x - dcX) - Math.abs(b.x - dcX))[0];
  if (pl) {
    await moveTo(pl.x, pl.y, 20);
    await hold(5);
    await dragTo(pl.x - 0.27 * span, pl.y, 46);
    await hold(20);
  }

  /* E - sweep the section marker across every diagram at once */
  const sweepY = stage.y + 40;
  const at = f => stage.left + f * span;   // fraction of the drawing width
  await moveTo(at(0.14), sweepY, 24);
  await moveTo(at(0.88), sweepY, 78);
  await moveTo(at(0.30), sweepY, 60);
  await hold(14);

  /* F - something indeterminate: three-span continuous */
  await moveTo(sel.x, sel.y, 26);
  await pressPulse();
  await loadExample(9);
  await hold(24);

  /* G - sweep it again */
  await moveTo(at(0.10), sweepY, 26);
  await moveTo(at(0.82), sweepY, 74);
  await hold(12);

  /* H - dark mode.  Click the real button: it calls drawStage(), and the
     SVG colours are resolved with getComputedStyle at draw time, so simply
     setting data-theme would leave the diagram labels painted for light. */
  const theme = await box('#btnTheme');
  await moveTo(theme.x, theme.y, 26);
  await clickAt(theme.x, theme.y, 14);
  await moveTo(at(0.20), sweepY, 24);
  await moveTo(at(0.78), sweepY, 60);
  await hold(30);

  console.log('captured', n, 'frames ->', (n / FPS).toFixed(1) + 's at ' + FPS + ' fps');
  await browser.close();

  /* ---- encode -------------------------------------------------------- */
  const mp4 = path.join(DOCS, 'demo.mp4'), gif = path.join(DOCS, 'demo.gif');
  const ff = (args) => execFileSync('ffmpeg', ['-v', 'error', '-y'].concat(args), { stdio: 'inherit' });

  ff(['-framerate', String(FPS), '-i', path.join(OUT, '%05d.png'),
      '-vf', 'scale=' + W + ':' + H + ':flags=lanczos',
      '-c:v', 'libx264', '-preset', 'slow', '-crf', '20',
      '-pix_fmt', 'yuv420p', '-movflags', '+faststart', mp4]);

  ff(['-i', mp4, '-vf',
      'fps=14,scale=900:-2:flags=lanczos,split[a][b];' +
      '[a]palettegen=stats_mode=diff:max_colors=200[p];' +
      '[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle', gif]);

  fs.rmSync(OUT, { recursive: true, force: true });
  for (const f of [mp4, gif]) {
    console.log(path.basename(f), (fs.statSync(f).size / 1048576).toFixed(2), 'MB');
  }
})();
