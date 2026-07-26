import type { ReactNode } from 'react';
import { Modal, StyleSheet, Text, View } from 'react-native';
import { formatDecimal, formatDuration, formatPercent } from '../math/format';
import { gameConfig } from '../store/gameStore';
import type { OfflineSummary } from '../store/gameStore';
import { Button } from './Button';
import { colors, radius, resourceColor, spacing, typography } from './theme';

interface OfflineModalProps {
  readonly summary: OfflineSummary | null;
  readonly onAcknowledge: () => void;
}

/**
 * Shown once when a player returns. Reports what was credited *and* what the
 * cap discarded, rather than quietly rounding the difference away.
 */
export function OfflineModal({ summary, onAcknowledge }: OfflineModalProps): ReactNode {
  if (summary === null) return null;
  const gains = [...summary.gains.entries()];
  const nameOf = (id: string): string =>
    gameConfig.resources.find((def) => def.id === id)?.name ?? id;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onAcknowledge}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <Text style={styles.title}>While you were away</Text>
          <Text style={styles.subtitle}>
            {formatDuration(summary.creditedMs)} at {formatPercent(summary.efficiency)} efficiency
          </Text>

          <View style={styles.gains}>
            {gains.length > 0 ? (
              gains.map(([id, amount]) => (
                <View key={id} style={styles.gainRow}>
                  <Text style={styles.gainLabel}>{nameOf(id)}</Text>
                  <Text style={[styles.gainValue, { color: resourceColor(id) }]}>
                    +{formatDecimal(amount, gameConfig.formatting)}
                  </Text>
                </View>
              ))
            ) : (
              <Text style={styles.empty}>The valley stayed cold. Build something first.</Text>
            )}
          </View>

          {summary.discardedMs > 0 ? (
            <Text style={styles.capped}>
              {formatDuration(summary.discardedMs)} beyond the{' '}
              {formatDuration(gameConfig.offline.maxElapsedMs)} cap was not counted.
            </Text>
          ) : null}

          <Button label="Continue" onPress={onAcknowledge} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.82)',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  sheet: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.xl,
    gap: spacing.md,
  },
  title: {
    ...typography.title,
    color: colors.text,
  },
  subtitle: {
    ...typography.label,
    color: colors.textMuted,
  },
  gains: {
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  gainRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  gainLabel: {
    ...typography.body,
    color: colors.textMuted,
  },
  gainValue: {
    ...typography.mono,
  },
  empty: {
    ...typography.body,
    color: colors.textFaint,
  },
  capped: {
    ...typography.label,
    color: colors.textFaint,
  },
});
