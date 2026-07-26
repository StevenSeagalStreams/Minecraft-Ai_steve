import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, spacing, typography } from './theme';

export interface TabDef {
  readonly key: string;
  readonly label: string;
  readonly icon: string;
  /** Small count shown on the tab, e.g. affordable upgrades waiting. */
  readonly badge?: number;
}

interface TabBarProps {
  readonly tabs: readonly TabDef[];
  readonly active: string;
  readonly onSelect: (key: string) => void;
}

export function TabBar({ tabs, active, onSelect }: TabBarProps): ReactNode {
  return (
    <View style={styles.container}>
      {tabs.map((tab) => {
        const selected = tab.key === active;
        return (
          <Pressable
            key={tab.key}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={tab.label}
            onPress={() => {
              onSelect(tab.key);
            }}
            style={styles.tab}
          >
            <Text style={[styles.icon, selected && styles.iconActive]}>{tab.icon}</Text>
            <Text style={[styles.label, selected && styles.labelActive]}>{tab.label}</Text>
            {tab.badge !== undefined && tab.badge > 0 ? (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{tab.badge > 99 ? '99+' : tab.badge}</Text>
              </View>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingBottom: spacing.sm,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.sm,
    gap: 2,
  },
  icon: {
    fontSize: 18,
    opacity: 0.5,
  },
  iconActive: {
    opacity: 1,
  },
  label: {
    ...typography.label,
    color: colors.textFaint,
  },
  labelActive: {
    color: colors.ember,
  },
  badge: {
    position: 'absolute',
    top: 2,
    right: '25%',
    minWidth: 16,
    paddingHorizontal: 4,
    borderRadius: 8,
    backgroundColor: colors.ember,
    alignItems: 'center',
  },
  badgeText: {
    ...typography.label,
    fontSize: 10,
    color: colors.background,
  },
});
