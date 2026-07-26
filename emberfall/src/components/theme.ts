import type { TextStyle } from 'react-native';

/**
 * Visual constants. Kept out of `src/data/` because that folder is reserved for
 * balance and content; nothing here affects the simulation.
 */
export const colors = {
  background: '#0d0a0b',
  surface: '#181315',
  surfaceRaised: '#221a1c',
  border: '#332628',
  ember: '#ff7a3d',
  emberDim: '#8c4423',
  lumen: '#8fd3ff',
  shard: '#d9b3ff',
  text: '#f2e9e4',
  textMuted: '#a39490',
  textFaint: '#6d5f5c',
  success: '#7bd88f',
  disabled: '#2a2224',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
} as const;

export const radius = {
  sm: 6,
  md: 10,
  lg: 16,
} as const;

/**
 * Typed as `TextStyle` rather than `as const` so that array-valued properties
 * such as `fontVariant` stay mutable, which is what `StyleSheet.create` expects.
 */
export const typography: Record<
  'title' | 'heading' | 'body' | 'label' | 'mono',
  TextStyle
> = {
  title: { fontSize: 22, fontWeight: '700' },
  heading: { fontSize: 17, fontWeight: '600' },
  body: { fontSize: 14, fontWeight: '400' },
  label: { fontSize: 12, fontWeight: '500' },
  /** Tabular figures keep counters from jittering as they tick. */
  mono: { fontSize: 14, fontWeight: '600', fontVariant: ['tabular-nums'] },
};

/** Resource id to accent colour, with a sane default for anything new. */
export function resourceColor(id: string): string {
  switch (id) {
    case 'ember':
      return colors.ember;
    case 'lumen':
      return colors.lumen;
    case 'emberShard':
      return colors.shard;
    default:
      return colors.text;
  }
}
