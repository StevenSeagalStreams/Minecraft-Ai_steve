#!/usr/bin/env node
/**
 * Live scene probe.
 *
 * When a frame comes out wrong, the question "is the light actually reaching
 * the surface?" is answerable in about a second by asking the running scene,
 * and effectively unanswerable by staring at a dark PNG. This boots the game
 * once and dumps the state that matters: every light, the biggest meshes and
 * their materials, and the renderer's own view of the frame.
 *
 *   node tools/probe.mjs --zone forest
 */
import { chromium } from 'playwright';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import process from 'node:process';

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const k = argv[i].slice(2);
    const n = argv[i + 1];
    if (!n || n.startsWith('--')) out[k] = true; else { out[k] = n; i++; }
  }
  return out;
}

function resolveChromium() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
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

const args = parseArgs(process.argv.slice(2));
const PORT = Number(args.port ?? 5260);
const ZONE = args.zone ?? 'forest';
const SEED = args.seed ?? '20250731';

const server = spawn('npx',
  ['vite', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort', '--clearScreen', 'false'],
  { cwd: new URL('..', import.meta.url).pathname, stdio: ['ignore', 'pipe', 'pipe'] });

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

  await page.goto(`http://127.0.0.1:${PORT}/?seed=${SEED}&zone=${ZONE}&quality=medium`,
    { waitUntil: 'domcontentloaded', timeout: 180000 });
  await page.waitForFunction(() => window.__ready === true, { timeout: 240000 });
  await page.waitForTimeout(2500);

  const report = await page.evaluate(() => {
    const g = window.__game;
    const THREE = g.THREE || null;
    const out = { zone: g.zoneName, lights: [], meshes: [], scene: {}, camera: {}, fog: null };

    // Read straight out of matrixWorld -- getWorldPosition needs a real
    // Vector3, and we deliberately have no THREE import inside the page.
    const wp = (o) => {
      o.updateWorldMatrix?.(true, false);
      const e = o.matrixWorld?.elements;
      return e ? [+e[12].toFixed(1), +e[13].toFixed(1), +e[14].toFixed(1)] : null;
    };

    g.scene.traverse((o) => {
      if (o.isLight) {
        out.lights.push({
          type: o.type,
          name: o.name || '(unnamed)',
          visible: o.visible,
          intensity: +(o.intensity ?? 0).toFixed(3),
          color: '#' + o.color.getHexString(),
          pos: wp(o),
          castShadow: !!o.castShadow,
          target: o.target ? wp(o.target) : null,
          distance: o.distance ?? null,
        });
      }
    });

    // Biggest renderables by bounding-sphere radius -- the things filling frame.
    const meshes = [];
    g.scene.traverse((o) => {
      if (!o.isMesh && !o.isInstancedMesh) return;
      const geo = o.geometry;
      if (!geo) return;
      if (!geo.boundingSphere) geo.computeBoundingSphere?.();
      const r = geo.boundingSphere ? geo.boundingSphere.radius : 0;
      const m = Array.isArray(o.material) ? o.material[0] : o.material;
      meshes.push({
        name: o.name || o.type,
        instances: o.isInstancedMesh ? o.count : 1,
        radius: +r.toFixed(1),
        visible: o.visible,
        material: m ? m.type : 'none',
        color: m && m.color ? '#' + m.color.getHexString() : null,
        rough: m && m.roughness !== undefined ? +m.roughness.toFixed(2) : null,
        metal: m && m.metalness !== undefined ? +m.metalness.toFixed(2) : null,
        hasMap: !!(m && m.map),
        hasNormal: !!(m && m.normalMap),
        vertexColors: !!(m && m.vertexColors),
        flatShading: !!(m && m.flatShading),
        side: m ? m.side : null,
        emissive: m && m.emissive ? '#' + m.emissive.getHexString() : null,
      });
    });
    meshes.sort((a, b) => b.radius - a.radius);
    out.meshes = meshes.slice(0, 14);

    out.scene.children = g.scene.children.length;
    out.scene.envLight = !!g.scene.userData.envLight;
    out.fog = g.scene.fog
      ? { type: g.scene.fog.type || (g.scene.fog.density !== undefined ? 'FogExp2' : 'Fog'),
          color: '#' + g.scene.fog.color.getHexString(),
          density: g.scene.fog.density ?? null }
      : null;

    out.camera = { pos: wp(g.camera), fov: g.camera.fov, far: g.camera.far };
    out.player = g.player ? { pos: wp(g.player.object), alive: g.player.alive } : null;
    out.monsters = (g.monsters || []).length;
    out.aliveMonsters = (g.monsters || []).filter((m) => m.alive).length;
    out.toneMapping = g.renderer.toneMapping;
    out.exposureUniform = g.postfx?.grade?.uniforms?.exposure?.value ?? null;
    out.draws = g.renderer.info.render.calls;
    out.tris = g.renderer.info.render.triangles;
    return out;
  });

  console.log(JSON.stringify(report, null, 2));
  if (errs.length) console.log('\n--- page errors ---\n' + errs.slice(0, 10).join('\n'));
} finally {
  await browser.close();
  server.kill('SIGTERM');
}
