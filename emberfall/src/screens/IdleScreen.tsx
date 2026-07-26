import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button } from '../components/Button';
import { DebugPanel } from '../components/DebugPanel';
import { GeneratorCard } from '../components/GeneratorCard';
import { colors, spacing, typography } from '../components/theme';
import { formatDecimal } from '../math/format';
import { gameConfig, useGameStore } from '../store/gameStore';
import { selectGatherYield, selectGeneratorRows } from '../store/selectors';

function bulkLabel(option: number): string {
  return option === gameConfig.bulkBuy.maxOption ? 'Max' : `x${option}`;
}

export function IdleScreen(): ReactNode {
  const game = useGameStore((store) => store.game);
  const bulkBuy = useGameStore((store) => store.bulkBuy);
  const buyGenerator = useGameStore((store) => store.buyGenerator);
  const setBulkBuy = useGameStore((store) => store.setBulkBuy);
  const toggleAutomation = useGameStore((store) => store.toggleAutomation);
  const gather = useGameStore((store) => store.gather);
  const lastTickDeltaMs = useGameStore((store) => store.lastTickDeltaMs);
  const lastSavedAt = useGameStore((store) => store.lastSavedAt);

  const rows = selectGeneratorRows(game, bulkBuy);
  const gatherYield = selectGatherYield(game);

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.gatherBlock}>
        <Button
          label="Gather"
          sublabel={`+${formatDecimal(gatherYield, gameConfig.formatting)}`}
          onPress={gather}
          accessibilityHint="Adds embers by hand"
        />
      </View>

      <View style={styles.bulkRow}>
        <Text style={styles.bulkLabel}>Buy</Text>
        {gameConfig.bulkBuy.options.map((option) => (
          <Button
            key={option}
            label={bulkLabel(option)}
            tone={option === bulkBuy ? 'primary' : 'neutral'}
            onPress={() => {
              setBulkBuy(option);
            }}
          />
        ))}
      </View>

      {rows.map((row) => (
        <GeneratorCard
          key={row.def.id}
          row={row}
          bulkLabel={bulkLabel(bulkBuy)}
          onBuy={() => {
            buyGenerator(row.def.id);
          }}
          onToggleAutomation={(enabled) => {
            toggleAutomation(row.def.id, enabled);
          }}
        />
      ))}

      {rows.length === 0 ? (
        <Text style={styles.empty}>Nothing here yet. The fire is very small.</Text>
      ) : null}

      <DebugPanel
        tickDeltaMs={lastTickDeltaMs}
        lastSavedAt={lastSavedAt}
        now={Date.now()}
        totalTicks={game.stats.totalTicks}
        saveIntervalMs={gameConfig.persistence.saveIntervalMs}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  gatherBlock: {
    marginBottom: spacing.xs,
  },
  bulkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  bulkLabel: {
    ...typography.label,
    color: colors.textMuted,
    marginRight: spacing.xs,
  },
  empty: {
    ...typography.body,
    color: colors.textFaint,
    textAlign: 'center',
    paddingVertical: spacing.xl,
  },
});
