#!/usr/bin/env node
import { chromium } from 'playwright';
import { existsSync, readdirSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import process from 'node:process';

function resolveChromium() {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  if (!existsSync(root)) return undefined;
  const dirs = readdirSync(root).filter((d) => d.startsWith('chromium-')).sort().reverse();
  for (const d of [...dirs, 'chromium']) {
    for (const rel of ['chrome-linux/chrome', 'chrome-linux64/chrome']) {
      const p = join(root, d, rel);
      if (existsSync(p)) return p;
    }
  }
  return undefined;
}

const PORT = Number(process.argv[2] || 5266);
const OUT = process.argv[3] || 'shots/tree/silhouette.png';
const server = spawn('npx', ['vite', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort', '--clearScreen', 'false'],
  { cwd: new URL('.', import.meta.url).pathname, stdio: ['ignore', 'pipe', 'pipe'] });

await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('vite did not start')), 60000);
  const on = (b) => { if (/ready in|Local:/.test(b.toString())) { clearTimeout(t); setTimeout(resolve, 400); } };
  server.stdout.on('data', on); server.stderr.on('data', on); server.on('error', reject);
});

const browser = await chromium.launch({
  executablePath: resolveChromium(),
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
         '--ignore-gpu-blocklist', '--enable-webgl', '--disable-dev-shm-usage', '--no-sandbox'],
});

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await page.goto(`http://127.0.0.1:${PORT}/?seed=20250731&zone=forest&quality=medium&silhouette=1`, { waitUntil: 'domcontentloaded', timeout: 180000 });
  await page.waitForFunction(() => window.__ready === true, { timeout: 240000 });
  await page.evaluate(() => document.getElementById('boot')?.remove());

  // Same densest-instanced-cluster framing as tools/shoot.mjs's `vista`
  // scenario (reimplemented here since this diagnostic lives outside
  // tools/), so the silhouette test looks at the same composition the
  // graded vista capture does, not an arbitrary close-up.
  await page.evaluate(() => {
    const g = window.__game;
    const pts = [];
    g.scene.traverse((o) => {
      if (!o.isInstancedMesh || o.count < 8) return;
      const arr = o.instanceMatrix?.array;
      if (!arr) return;
      const step = Math.max(1, Math.floor(o.count / 120));
      for (let i = 0; i < o.count; i += step) {
        pts.push([arr[i * 16 + 12], arr[i * 16 + 14]]);
      }
    });
    let target = null;
    if (pts.length >= 12) {
      const CELL = 12;
      const bins = new Map();
      for (const [x, z] of pts) {
        const k = `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`;
        let b = bins.get(k);
        if (!b) bins.set(k, (b = { n: 0, x: 0, z: 0 }));
        b.n++; b.x += x; b.z += z;
      }
      let best = null;
      for (const b of bins.values()) if (!best || b.n > best.n) best = b;
      if (best) target = { x: best.x / best.n, z: best.z / best.n };
    }
    if (target) {
      const col = g.world.colliders;
      let found = null;
      if (col) {
        for (let r = 0; r <= 24 && !found; r += 2) {
          for (let a = 0; a < 12 && !found; a++) {
            const ang = (a / 12) * Math.PI * 2;
            const tx = target.x + Math.cos(ang) * r;
            const tz = target.z + Math.sin(ang) * r;
            if (!col.isBlocked(tx, tz, 0.8)) found = { x: tx, z: tz };
          }
        }
      }
      const p = found || target;
      const y = g.zone?.terrain?.heightAt ? g.zone.terrain.heightAt(p.x, p.z) : 0;
      g.player.position.set(p.x, y, p.z);
      g.player.clearPath();
    }
    g.rig.distance = 58;
    g.rig.elevation = 0.52;
    g.rig.updateOffset();
    g.rig.snapTo(g.player.position);
  });
  await page.waitForTimeout(1800);

  const dir = dirname(OUT);
  mkdirSync(dir, { recursive: true });
  const buf = await page.screenshot({ type: 'png' });
  await writeFile(OUT, buf);
  console.log('WROTE', OUT);
  if (errs.length) console.log('\n--- page errors ---\n' + errs.slice(0, 10).join('\n'));
} finally {
  await browser.close();
  server.kill();
}
