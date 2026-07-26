import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { formatDecimal } from '../math/format';
import { gameConfig } from '../store/gameStore';
import type { UpgradeRow } from '../store/selectors';
import { Button } from './Button';
import { colors, radius, spacing, typography } from './theme';

interface UpgradeCardProps {
  readonly row: UpgradeRow;
  readonly onBuy: () => void;
}

function levelLabel(level: number, maxLevel: number): string {
  if (!Number.isFinite(maxLevel)) return `Lv ${level}`;
  if (maxLevel === 1) return level > 0 ? 'Owned' : '';
  return `Lv ${level}/${maxLevel}`;
}

export function UpgradeCard({ row, onBuy }: UpgradeCardProps): ReactNode {
  const label = levelLabel(row.level, row.def.maxLevel);

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.name}>{row.def.name}</Text>
        {label !== '' ? <Text style={styles.level}>{label}</Text> : null}
      </View>
      <Text style={styles.description}>{row.def.description}</Text>

      {row.maxed ? (
        <Text style={styles.maxed}>Fully invested</Text>
      ) : (
        <Button
          label="Purchase"
          sublabel={formatDecimal(row.cost, gameConfig.formatting)}
          onPress={onBuy}
          disabled={!row.affordable}
          tone={row.def.category === 'prestige' ? 'neutral' : 'primary'}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  name: {
    ...typography.heading,
    color: colors.text,
    flexShrink: 1,
  },
  level: {
    ...typography.label,
    color: colors.ember,
  },
  description: {
    ...typography.body,
    color: colors.textMuted,
  },
  maxed: {
    ...typography.label,
    color: colors.success,
    textAlign: 'center',
    paddingVertical: spacing.sm,
  },
});
