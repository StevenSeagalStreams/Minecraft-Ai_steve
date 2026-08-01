import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';

function resolveChromium() {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  const dirs = readdirSync(root).filter((d) => d.startsWith('chromium-')).sort().reverse();
  for (const d of [...dirs, 'chromium']) {
    const p = join(root, d, 'chrome-linux/chrome');
    if (existsSync(p)) return p;
  }
}
const PORT = 5273;
const server = spawn('npx', ['vite', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort', '--clearScreen', 'false'], { stdio: ['ignore','pipe','pipe'] });
await new Promise((res) => { const on=(b)=>{ if(/ready in|Local:/.test(b.toString())) { setTimeout(res,400);} }; server.stdout.on('data',on); server.stderr.on('data',on); });
const browser = await chromium.launch({ executablePath: resolveChromium(), args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(`http://127.0.0.1:${PORT}/?seed=20250731&zone=forest&quality=medium&silhouette=1`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__ready === true, { timeout: 240000 });
await page.evaluate(() => document.getElementById('boot')?.remove());

// frame on densest cluster, same as before
await page.evaluate(() => {
  const g = window.__game;
  const pts = [];
  g.scene.traverse((o) => {
    if (!o.isInstancedMesh || o.count < 8) return;
    const arr = o.instanceMatrix?.array;
    if (!arr) return;
    const step = Math.max(1, Math.floor(o.count / 120));
    for (let i = 0; i < o.count; i += step) pts.push([arr[i*16+12], arr[i*16+14]]);
  });
  let target = null;
  if (pts.length >= 12) {
    const CELL = 12; const bins = new Map();
    for (const [x,z] of pts) { const k=`${Math.floor(x/CELL)},${Math.floor(z/CELL)}`; let b=bins.get(k); if(!b) bins.set(k,(b={n:0,x:0,z:0})); b.n++; b.x+=x; b.z+=z; }
    let best=null; for (const b of bins.values()) if(!best||b.n>best.n) best=b;
    if (best) target = { x: best.x/best.n, z: best.z/best.n };
  }
  if (target) {
    const col = g.world.colliders; let found=null;
    if (col) for (let r=0;r<=24 && !found; r+=2) for (let a=0;a<12 && !found; a++) { const ang=(a/12)*Math.PI*2; const tx=target.x+Math.cos(ang)*r, tz=target.z+Math.sin(ang)*r; if(!col.isBlocked(tx,tz,0.8)) found={x:tx,z:tz}; }
    const p = found || target;
    const y = g.zone?.terrain?.heightAt ? g.zone.terrain.heightAt(p.x,p.z) : 0;
    g.player.position.set(p.x,y,p.z);
    g.player.clearPath();
  }
  g.rig.distance = 58; g.rig.elevation = 0.52; g.rig.updateOffset(); g.rig.snapTo(g.player.position);
});
await page.waitForTimeout(1800);

const matInfo = await page.evaluate(() => {
  const g = window.__game;
  let m = null;
  g.scene.traverse((o) => { if (!m && o.isInstancedMesh && /Tree_tallGaunt_Canopy/.test(o.name)) m = o.material; });
  return m ? { type: m.type, color: m.color.getHexString(), isBasic: m.isMeshBasicMaterial === true } : null;
});
console.log('LIVE MATERIAL AT CAPTURE TIME', JSON.stringify(matInfo));

mkdirSync('shots/tree', { recursive: true });
const buf = await page.screenshot({ type: 'png' });
await writeFile('shots/tree/silhouette_verify.png', buf);
console.log('WROTE shots/tree/silhouette_verify.png');
await browser.close();
server.kill();
