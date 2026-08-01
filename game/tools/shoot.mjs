#!/usr/bin/env node
/**
 * Headless capture harness.
 *
 * Boots the game in Chromium with a fixed seed, waits for the deterministic
 * ready flag, drives a named scenario, and writes a PNG. This is the only
 * ground truth the critic agents grade against -- if it is not in the shot, it
 * did not happen.
 *
 *   node tools/shoot.mjs --shot wide --out shots/wide.png
 *   node tools/shoot.mjs --all --dir shots/
 */
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import process from 'node:process';

/**
 * The image this container ships is not necessarily the revision the installed
 * playwright package expects, so resolve the real binary rather than trusting
 * the version-pinned default path.
 */
function resolveChromium() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  if (!existsSync(root)) return undefined;
  const dirs = readdirSync(root)
    .filter((d) => d.startsWith('chromium-'))
    .sort()
    .reverse();
  for (const d of [...dirs, 'chromium']) {
    for (const rel of ['chrome-linux/chrome', 'chrome-linux64/chrome']) {
      const p = join(root, d, rel);
      if (existsSync(p)) return p;
    }
  }
  return undefined;
}

const args = parseArgs(process.argv.slice(2));
const PORT = Number(args.port ?? 5199);
const SEED = args.seed ?? '20250731';
const QUALITY = args.quality ?? 'ultra';
const ZONE = args.zone ?? 'forest';
const WIDTH = Number(args.width ?? 1920);
const HEIGHT = Number(args.height ?? 1080);

/**
 * Scenarios. Each gets the page and the in-page game object and is responsible
 * for putting the world into a specific, repeatable state before the capture.
 */
const SHOTS = {
  /** Establishing shot: the player standing in a lit room. */
  wide: async (page) => {
    await page.evaluate(() => {
      const g = window.__game;
      g.rig.distance = 38;
      g.rig.updateOffset();
      g.rig.snapTo(g.player.position);
    });
    await settle(page, 1.6);
  },

  /** Close on the character, to judge model and material quality. */
  hero: async (page) => {
    await page.evaluate(() => {
      const g = window.__game;
      g.rig.distance = 13;
      g.rig.elevation = 0.42;
      g.rig.updateOffset();
      g.rig.snapTo(g.player.position);
    });
    await settle(page, 1.2);
  },

  /** Combat: teleport the nearest pack onto the player and let it swing. */
  combat: async (page) => {
    await page.evaluate(() => {
      const g = window.__game;
      const p = g.player;
      const near = g.monsters
        .filter((m) => m.alive)
        .sort((a, b) => a.distanceTo(p) - b.distanceTo(p))
        .slice(0, 5);
      near.forEach((m, i) => {
        const a = (i / near.length) * Math.PI * 2;
        m.position.set(p.position.x + Math.sin(a) * 2.4, 0, p.position.z + Math.cos(a) * 2.4);
        m.setState('attack');
      });
      p.target = near[0] || null;
      g.rig.distance = 24;
      g.rig.updateOffset();
      g.rig.snapTo(p.position);
    });
    await settle(page, 2.4);
  },

  /** A dark corridor, to judge falloff, fog and shadow quality. */
  corridor: async (page) => {
    await page.evaluate(() => {
      const g = window.__game;
      // Outdoor zones have no corridors -- fall back to a mid-range framing.
      if (!g.dungeon) {
        g.rig.distance = 26;
        g.rig.updateOffset();
        g.rig.snapTo(g.player.position);
        return;
      }
      // Find a floor cell far from any room centre -- that is corridor.
      const d = g.dungeon;
      const T = 2.0;
      let best = null, bestScore = -1;
      for (let y = 2; y < d.height - 2; y += 2) {
        for (let x = 2; x < d.width - 2; x += 2) {
          if (!d.isFloor(x, y)) continue;
          let minRoom = Infinity;
          for (const r of d.rooms) minRoom = Math.min(minRoom, Math.hypot(r.cx - x, r.cy - y));
          if (minRoom > bestScore) { bestScore = minRoom; best = { x, y }; }
        }
      }
      if (best) {
        g.player.position.set(best.x * T, 0, best.y * T);
        g.player.clearPath();
        g.rig.snapTo(g.player.position);
      }
      g.rig.distance = 26;
      g.rig.updateOffset();
    });
    await settle(page, 1.6);
  },

  /** Top-down survey of a whole wing, for layout and silhouette reading. */
  survey: async (page) => {
    await page.evaluate(() => {
      const g = window.__game;
      g.rig.distance = 70;
      g.rig.elevation = 0.95;
      g.rig.updateOffset();
      g.rig.snapTo(g.player.position);
      g.lighting.setFogDensity(0.006);
    });
    await settle(page, 1.4);
  },
};

async function settle(page, seconds) {
  // Let the render loop run so animation, flicker and TAA-ish settling land in
  // a representative frame rather than frame zero.
  await page.waitForTimeout(seconds * 1000);
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) out[key] = true;
    else { out[key] = next; i++; }
  }
  return out;
}

async function startServer() {
  const child = spawn(
    'npx',
    ['vite', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort', '--clearScreen', 'false'],
    { cwd: new URL('..', import.meta.url).pathname, stdio: ['ignore', 'pipe', 'pipe'] }
  );
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('vite did not start in 40s')), 40000);
    const onData = (buf) => {
      const s = buf.toString();
      if (s.includes('ready in') || s.includes('Local:')) {
        clearTimeout(timer);
        setTimeout(resolve, 400);
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('error', reject);
  });
  return child;
}

async function main() {
  const wanted = args.all ? Object.keys(SHOTS) : [args.shot ?? 'wide'];
  for (const name of wanted) {
    if (!SHOTS[name]) throw new Error(`unknown shot "${name}" (have: ${Object.keys(SHOTS).join(', ')})`);
  }

  const server = await startServer();
  const browser = await chromium.launch({
    executablePath: resolveChromium(),
    args: [
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--ignore-gpu-blocklist',
      '--enable-webgl',
      '--disable-dev-shm-usage',
      '--no-sandbox',
    ],
  });

  const results = [];
  try {
    const context = await browser.newContext({
      viewport: { width: WIDTH, height: HEIGHT },
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();

    const logs = [];
    page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
    page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));

    const url = `http://127.0.0.1:${PORT}/?seed=${SEED}&quality=${QUALITY}&zone=${ZONE}`;
    await page.goto(url, { waitUntil: 'domcontentloaded' });

    try {
      await page.waitForFunction(() => window.__ready === true, { timeout: 120000 });
    } catch (e) {
      const bootErr = await page.evaluate(() => window.__bootError || null);
      throw new Error(`game never became ready.\nbootError: ${bootErr}\nconsole:\n${logs.join('\n')}`);
    }

    // The boot overlay fades on a CSS transition. Under SwiftShader that
    // transition can be starved, and a captured frame then shows the splash
    // instead of the game -- which silently poisons every critic grade. Remove
    // the element outright rather than trusting the animation to have finished.
    await page.evaluate(() => document.getElementById('boot')?.remove());

    // Let the first frames render and shaders warm before any capture.
    await settle(page, 1.5);

    for (const name of wanted) {
      await SHOTS[name](page);
      const out = args.out && !args.all
        ? args.out
        : join(args.dir ?? 'shots', `${name}.png`);
      await mkdir(dirname(out), { recursive: true });
      const buf = await page.screenshot({ type: 'png' });
      await writeFile(out, buf);

      const stats = await page.evaluate(() => {
        const g = window.__game;
        return {
          fps: Number(g.fps.toFixed(1)),
          draws: g.renderer.info.render.calls,
          tris: g.renderer.info.render.triangles,
          entities: g.entities.length,
        };
      });
      results.push({ name, out, ...stats });
      console.log(`shot ${name} -> ${out}  fps=${stats.fps} draws=${stats.draws} tris=${stats.tris}`);
    }

    const errors = logs.filter((l) => l.startsWith('[error]') || l.startsWith('[pageerror]'));
    if (errors.length) {
      console.log('\n--- page errors ---\n' + errors.join('\n'));
    }
  } finally {
    await browser.close();
    server.kill('SIGTERM');
  }

  console.log('\n' + JSON.stringify(results, null, 2));
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
