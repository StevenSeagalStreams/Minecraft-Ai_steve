import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing, typography } from '../components/theme';
import { useGameStore } from '../store/gameStore';
import { selectStoryLog } from '../store/selectors';

/**
 * A record of what has already happened, including which way each choice went.
 * Read-only: choices are made in the story modal, never re-made here.
 */
export function StoryLogScreen(): ReactNode {
  const game = useGameStore((store) => store.game);
  const entries = selectStoryLog(game);

  return (
    <ScrollView contentContainerStyle={styles.content}>
      {entries.map((entry) => (
        <View key={entry.node.id} style={styles.entry}>
          <Text style={styles.chapter}>Chapter {entry.node.chapter}</Text>
          <Text style={styles.title}>{entry.title}</Text>
          {entry.node.speaker !== null ? (
            <Text style={styles.speaker}>{entry.node.speaker}</Text>
          ) : null}
          <Text style={styles.body}>{entry.body}</Text>
          {entry.chosenText !== null ? (
            <Text style={styles.choice}>You chose: {entry.chosenText}</Text>
          ) : null}
        </View>
      ))}

      {entries.length === 0 ? (
        <Text style={styles.empty}>Nothing has happened yet.</Text>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  entry: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.xs,
  },
  chapter: {
    ...typography.label,
    color: colors.emberDim,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  title: {
    ...typography.heading,
    color: colors.text,
  },
  speaker: {
    ...typography.label,
    color: colors.ember,
    fontStyle: 'italic',
  },
  body: {
    ...typography.body,
    color: colors.textMuted,
    lineHeight: 20,
  },
  choice: {
    ...typography.label,
    color: colors.success,
    marginTop: spacing.sm,
  },
  empty: {
    ...typography.body,
    color: colors.textFaint,
    textAlign: 'center',
    paddingVertical: spacing.xl,
  },
});
