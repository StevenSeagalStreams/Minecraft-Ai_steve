import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { formatDecimal, formatRate } from '../math/format';
import { gameConfig } from '../store/gameStore';
import type { ResourceRow } from '../store/selectors';
import { colors, radius, resourceColor, spacing, typography } from './theme';

interface ResourceBarProps {
  readonly rows: readonly ResourceRow[];
}

/** The persistent header: every unlocked resource, its balance and its rate. */
export function ResourceBar({ rows }: ResourceBarProps): ReactNode {
  return (
    <View style={styles.container}>
      {rows.map((row) => (
        <View key={row.def.id} style={styles.item}>
          <Text style={styles.icon}>{row.def.icon}</Text>
          <View style={styles.values}>
            <Text style={[styles.amount, { color: resourceColor(row.def.id) }]}>
              {formatDecimal(row.amount, gameConfig.formatting)}
            </Text>
            <Text style={styles.rate}>
              {row.perSecond.gt(0) ? formatRate(row.perSecond, gameConfig.formatting) : row.def.shortName}
            </Text>
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    flexGrow: 1,
    flexBasis: 120,
  },
  icon: {
    fontSize: 18,
  },
  values: {
    flexShrink: 1,
  },
  amount: {
    ...typography.mono,
  },
  rate: {
    ...typography.label,
    color: colors.textMuted,
  },
});
