import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { UpgradeCard } from '../components/UpgradeCard';
import { colors, spacing, typography } from '../components/theme';
import type { UpgradeCategory } from '../types/defs';
import { useGameStore } from '../store/gameStore';
import { selectUpgradeRows } from '../store/selectors';

const SECTIONS: readonly { readonly category: UpgradeCategory; readonly title: string }[] = [
  { category: 'production', title: 'Production' },
  { category: 'automation', title: 'Automation' },
  { category: 'story', title: 'Covenants' },
  { category: 'prestige', title: 'Beyond the Ash' },
];

export function UpgradesScreen(): ReactNode {
  const game = useGameStore((store) => store.game);
  const buyUpgrade = useGameStore((store) => store.buyUpgrade);
  const rows = selectUpgradeRows(game);

  return (
    <ScrollView contentContainerStyle={styles.content}>
      {SECTIONS.map((section) => {
        const sectionRows = rows.filter((row) => row.def.category === section.category);
        if (sectionRows.length === 0) return null;
        return (
          <View key={section.category} style={styles.section}>
            <Text style={styles.sectionTitle}>{section.title}</Text>
            {sectionRows.map((row) => (
              <UpgradeCard
                key={row.def.id}
                row={row}
                onBuy={() => {
                  buyUpgrade(row.def.id);
                }}
              />
            ))}
          </View>
        );
      })}

      {rows.length === 0 ? (
        <Text style={styles.empty}>Nothing to improve yet. Keep the fire going.</Text>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: spacing.lg,
    gap: spacing.xl,
  },
  section: {
    gap: spacing.md,
  },
  sectionTitle: {
    ...typography.label,
    color: colors.emberDim,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  empty: {
    ...typography.body,
    color: colors.textFaint,
    textAlign: 'center',
    paddingVertical: spacing.xl,
  },
});
