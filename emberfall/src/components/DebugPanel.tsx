import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { formatDuration } from '../math/format';
import { colors, radius, spacing, typography } from './theme';

interface DebugPanelProps {
  readonly tickDeltaMs: number;
  readonly lastSavedAt: number | null;
  readonly now: number;
  readonly totalTicks: number;
  readonly saveIntervalMs: number;
}

/**
 * Proof-of-life instrumentation: shows that the loop is ticking and that the
 * throttled save is actually committing.
 */
export function DebugPanel({
  tickDeltaMs,
  lastSavedAt,
  now,
  totalTicks,
  saveIntervalMs,
}: DebugPanelProps): ReactNode {
  const sinceSave = lastSavedAt === null ? null : Math.max(now - lastSavedAt, 0);

  return (
    <View style={styles.panel}>
      <Text style={styles.heading}>Debug</Text>
      <Row label="Tick delta" value={`${tickDeltaMs} ms`} />
      <Row label="Ticks" value={String(totalTicks)} />
      <Row
        label="Last save"
        value={sinceSave === null ? 'not yet' : `${formatDuration(sinceSave)} ago`}
      />
      <Row label="Save interval" value={formatDuration(saveIntervalMs)} />
    </View>
  );
}

function Row({ label, value }: { readonly label: string; readonly value: string }): ReactNode {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.xs,
  },
  heading: {
    ...typography.label,
    color: colors.textFaint,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  label: {
    ...typography.label,
    color: colors.textFaint,
  },
  value: {
    ...typography.mono,
    fontSize: 12,
    color: colors.textMuted,
  },
});
