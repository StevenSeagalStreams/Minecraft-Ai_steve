import type { ReactNode } from 'react';
import { StyleSheet, Switch, Text, View } from 'react-native';
import { formatDecimal, formatRate, formatWhole } from '../math/format';
import { gameConfig } from '../store/gameStore';
import type { GeneratorRow } from '../store/selectors';
import { Button } from './Button';
import { colors, radius, resourceColor, spacing, typography } from './theme';

interface GeneratorCardProps {
  readonly row: GeneratorRow;
  readonly bulkLabel: string;
  readonly onBuy: () => void;
  readonly onToggleAutomation: (enabled: boolean) => void;
}

export function GeneratorCard({
  row,
  bulkLabel,
  onBuy,
  onToggleAutomation,
}: GeneratorCardProps): ReactNode {
  const { formatting } = gameConfig;
  const count = row.bulkCount.gt(0) ? formatWhole(row.bulkCount, formatting) : '0';
  const price = row.bulkCount.gt(0)
    ? formatDecimal(row.bulkCost, formatting)
    : formatDecimal(row.nextCost, formatting);

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.titleBlock}>
          <Text style={styles.name}>{row.def.name}</Text>
          <Text style={styles.description}>{row.def.description}</Text>
        </View>
        <Text style={[styles.owned, { color: resourceColor(row.def.produces) }]}>
          {formatWhole(row.owned, formatting)}
        </Text>
      </View>

      <View style={styles.footer}>
        <View style={styles.stats}>
          <Text style={styles.rate}>{formatRate(row.perSecond, formatting)}</Text>
          {row.automationUnlocked ? (
            <View style={styles.automation}>
              <Text style={styles.automationLabel}>Auto</Text>
              <Switch
                accessibilityLabel={`Automate ${row.def.name}`}
                value={row.automationEnabled}
                onValueChange={onToggleAutomation}
                trackColor={{ true: colors.emberDim, false: colors.disabled }}
                thumbColor={row.automationEnabled ? colors.ember : colors.textFaint}
              />
            </View>
          ) : null}
        </View>

        <Button
          label={`Buy ${bulkLabel === 'Max' ? `${count}` : bulkLabel}`}
          sublabel={price}
          onPress={onBuy}
          disabled={!row.affordable}
          accessibilityHint={`Costs ${price}`}
        />
      </View>
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
    gap: spacing.md,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  titleBlock: {
    flex: 1,
    gap: 2,
  },
  name: {
    ...typography.heading,
    color: colors.text,
  },
  description: {
    ...typography.label,
    color: colors.textMuted,
  },
  owned: {
    ...typography.title,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  stats: {
    gap: spacing.xs,
    flex: 1,
  },
  rate: {
    ...typography.mono,
    color: colors.textMuted,
  },
  automation: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  automationLabel: {
    ...typography.label,
    color: colors.textFaint,
  },
});
