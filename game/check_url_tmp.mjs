import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

function resolveChromium() {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  const dirs = readdirSync(root).filter((d) => d.startsWith('chromium-')).sort().reverse();
  for (const d of [...dirs, 'chromium']) {
    const p = join(root, d, 'chrome-linux/chrome');
    if (existsSync(p)) return p;
  }
}
const PORT = 5270;
const server = spawn('npx', ['vite', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort', '--clearScreen', 'false'], { stdio: ['ignore','pipe','pipe'] });
await new Promise((res) => { const on=(b)=>{ if(/ready in|Local:/.test(b.toString())) { setTimeout(res,400);} }; server.stdout.on('data',on); server.stderr.on('data',on); });
const browser = await chromium.launch({ executablePath: resolveChromium(), args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'] });
const page = await browser.newPage();
await page.goto(`http://127.0.0.1:${PORT}/?seed=20250731&zone=forest&quality=medium&silhouette=1`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__ready === true, { timeout: 240000 });
const info = await page.evaluate(() => ({
  search: location.search,
  href: location.href,
}));
console.log(JSON.stringify(info));
await browser.close();
server.kill();
