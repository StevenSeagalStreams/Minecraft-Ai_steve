#!/usr/bin/env node
import { chromium } from 'playwright';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
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

const PORT = Number(process.argv[2] || 5262);
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
  const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await page.goto(`http://127.0.0.1:${PORT}/?seed=20250731&zone=forest&quality=medium`, { waitUntil: 'domcontentloaded', timeout: 180000 });
  await page.waitForFunction(() => window.__ready === true, { timeout: 240000 });
  await page.waitForTimeout(1500);

  const report = await page.evaluate(() => {
    const g = window.__game;
    const out = { totalDraws: g.renderer.info.render.calls, totalTris: g.renderer.info.render.triangles, trees: [] };
    let treeTris = 0, treeDraws = 0, treeInstances = 0;
    g.scene.traverse((obj) => {
      if (!obj.isInstancedMesh) return;
      if (!/^Tree_|^LeafLitter$/.test(obj.name)) return;
      const idx = obj.geometry.index;
      const triCount = idx ? idx.count / 3 : obj.geometry.attributes.position.count / 3;
      const instances = obj.count;
      out.trees.push({ name: obj.name, instances, triPerInstance: triCount, totalTris: triCount * instances });
      treeTris += triCount * instances;
      treeDraws += instances > 0 ? 1 : 0;
      treeInstances += instances;
    });
    out.treeTris = treeTris;
    out.treeDraws = treeDraws;
    out.treeInstances = treeInstances;
    return out;
  });
  console.log(JSON.stringify(report, null, 2));
  if (errs.length) console.log('\n--- page errors ---\n' + errs.slice(0, 10).join('\n'));
} finally {
  await browser.close();
  server.kill();
}
