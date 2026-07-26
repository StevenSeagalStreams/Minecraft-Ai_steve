import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { colors, radius } from './theme';

interface ProgressBarProps {
  /** 0..1; clamped, so a caller cannot overflow the track. */
  readonly progress: number;
  readonly color?: string;
  readonly height?: number;
}

export function ProgressBar({
  progress,
  color = colors.ember,
  height = 6,
}: ProgressBarProps): ReactNode {
  const clamped = Number.isFinite(progress) ? Math.min(Math.max(progress, 0), 1) : 0;
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(clamped * 100) }}
      style={[styles.track, { height }]}
    >
      <View style={[styles.fill, { width: `${clamped * 100}%`, backgroundColor: color }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    width: '100%',
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.sm,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: radius.sm,
  },
});
