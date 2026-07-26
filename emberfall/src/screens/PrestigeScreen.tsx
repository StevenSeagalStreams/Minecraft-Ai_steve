import type { ReactNode } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button } from '../components/Button';
import { ProgressBar } from '../components/ProgressBar';
import { colors, radius, spacing, typography } from '../components/theme';
import { formatDecimal, formatDuration, formatMultiplier, formatPercent } from '../math/format';
import { gameConfig, useGameStore } from '../store/gameStore';
import { selectPrestige } from '../store/selectors';

export function PrestigeScreen(): ReactNode {
  const game = useGameStore((store) => store.game);
  const ascendNow = useGameStore((store) => store.ascendNow);
  const view = selectPrestige(game);
  const { formatting } = gameConfig;

  const confirmAscend = (): void => {
    Alert.alert(
      'Let it go out?',
      `Everything in this run resets. You keep ${formatDecimal(view.pendingGain, formatting)} ` +
        'Ember Shards, your shard upgrades, and what you have agreed to.',
      [
        { text: 'Not yet', style: 'cancel' },
        {
          text: 'Ascend',
          style: 'destructive',
          onPress: () => {
            ascendNow();
          },
        },
      ],
    );
  };

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.panel}>
        <Text style={styles.heading}>Ascension</Text>
        <Text style={styles.body}>
          When the valley goes cold, what is left is small and sharp and makes the next one faster.
        </Text>

        <View style={styles.progressBlock}>
          <ProgressBar progress={view.progress} />
          <Text style={styles.progressLabel}>
            {formatPercent(view.progress, 1)} toward{' '}
            {formatDecimal(gameConfig.prestige.requirement, formatting)} embers this run
          </Text>
        </View>

        <View style={styles.gainRow}>
          <Text style={styles.gainLabel}>Shards on ascension</Text>
          <Text style={styles.gainValue}>{formatDecimal(view.pendingGain, formatting)}</Text>
        </View>

        <Button
          label={view.canAscend ? 'Ascend' : 'Not enough embers'}
          onPress={confirmAscend}
          disabled={!view.canAscend}
        />
      </View>

      <View style={styles.panel}>
        <Text style={styles.heading}>Record</Text>
        <Stat label="Ember Shards held" value={formatDecimal(view.shards, formatting)} />
        <Stat label="Shards earned, all time" value={formatDecimal(view.lifetimeShards, formatting)} />
        <Stat label="Ascensions" value={String(view.count)} />
        <Stat label="Best run" value={formatDecimal(view.bestRunTotal, formatting)} />
        <Stat label="Production multiplier" value={formatMultiplier(view.globalMultiplier, formatting)} />
        <Stat label="This run" value={formatDuration(game.stats.runPlayTimeMs)} />
        <Stat label="Total played" value={formatDuration(game.stats.totalPlayTimeMs)} />
      </View>
    </ScrollView>
  );
}

function Stat({ label, value }: { readonly label: string; readonly value: string }): ReactNode {
  return (
    <View style={styles.statRow}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: spacing.lg,
    gap: spacing.lg,
  },
  panel: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.md,
  },
  heading: {
    ...typography.heading,
    color: colors.text,
  },
  body: {
    ...typography.body,
    color: colors.textMuted,
    lineHeight: 20,
  },
  progressBlock: {
    gap: spacing.xs,
  },
  progressLabel: {
    ...typography.label,
    color: colors.textMuted,
  },
  gainRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  gainLabel: {
    ...typography.body,
    color: colors.textMuted,
  },
  gainValue: {
    ...typography.title,
    color: colors.shard,
  },
  statRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  statLabel: {
    ...typography.body,
    color: colors.textMuted,
  },
  statValue: {
    ...typography.mono,
    color: colors.text,
  },
});
