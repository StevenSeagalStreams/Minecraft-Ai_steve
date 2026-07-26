import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(__dirname, '..', '..');

function sourceFiles(dir: string): string[] {
  const entries = readdirSync(dir);
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      files.push(...sourceFiles(full));
    } else if (/\.tsx?$/.test(entry)) {
      files.push(full);
    }
  }
  return files;
}

/**
 * Guards the engine/UI separation rule. It is the kind of boundary that decays
 * silently — one convenient `useState` import and the engine stops being pure
 * TypeScript — so it is checked rather than trusted.
 */
describe('engine/UI separation', () => {
  const pureLayers = ['engine', 'features', 'math', 'data', 'types'];

  it.each(pureLayers)('src/%s imports no React or react-native', (layer) => {
    const offenders: string[] = [];
    for (const file of sourceFiles(join(SRC, layer))) {
      const source = readFileSync(file, 'utf8');
      if (/from '(react|react-native|react-native-mmkv|zustand)/.test(source)) {
        offenders.push(file.slice(SRC.length + 1));
      }
    }
    expect(offenders).toEqual([]);
  });

  it('has no .tsx files in the pure layers', () => {
    for (const layer of pureLayers) {
      const tsx = sourceFiles(join(SRC, layer)).filter((file) => file.endsWith('.tsx'));
      expect(tsx).toEqual([]);
    }
  });

  it('keeps every source file under the 300-line limit', () => {
    const oversized: string[] = [];
    for (const file of sourceFiles(SRC)) {
      const lines = readFileSync(file, 'utf8').split('\n').length;
      if (lines > 300) oversized.push(`${file.slice(SRC.length + 1)} (${lines})`);
    }
    expect(oversized).toEqual([]);
  });

  it('reads the clock nowhere inside the engine or features', () => {
    const offenders: string[] = [];
    for (const layer of ['engine', 'features']) {
      for (const file of sourceFiles(join(SRC, layer))) {
        if (file.includes('__tests__')) continue;
        // Comments are stripped first: the rule is about executed code, and
        // these files talk about `Date.now()` precisely to explain its absence.
        const code = readFileSync(file, 'utf8')
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/\/\/.*$/gm, '');
        if (/Date\.now\(\)|performance\.now\(\)/.test(code)) {
          offenders.push(file.slice(SRC.length + 1));
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
