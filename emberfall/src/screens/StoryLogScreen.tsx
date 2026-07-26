import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing, typography } from '../components/theme';
import { getRegistry } from '../features/registry';
import { gameConfig, useGameStore } from '../store/gameStore';

/**
 * A record of what has already happened, including which way each choice went.
 * Read-only: choices are made in the story modal, never re-made here.
 */
export function StoryLogScreen(): ReactNode {
  const game = useGameStore((store) => store.game);
  const registry = getRegistry(gameConfig);

  const seen = game.story.seenNodes
    .map((id) => registry.story.get(id))
    .filter((node): node is NonNullable<typeof node> => node !== undefined);

  const chosenAt = new Map(game.story.history.map((record) => [record.node, record.choice]));

  return (
    <ScrollView contentContainerStyle={styles.content}>
      {seen.map((node) => {
        const choiceId = chosenAt.get(node.id);
        const choice = node.choices.find((option) => option.id === choiceId);
        return (
          <View key={node.id} style={styles.entry}>
            <Text style={styles.chapter}>Chapter {node.chapter}</Text>
            <Text style={styles.title}>{node.title}</Text>
            {node.speaker !== null ? <Text style={styles.speaker}>{node.speaker}</Text> : null}
            <Text style={styles.body}>{node.body}</Text>
            {choice !== undefined ? (
              <Text style={styles.choice}>You chose: {choice.text}</Text>
            ) : null}
          </View>
        );
      })}

      {seen.length === 0 ? (
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
