import type { ReactNode } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { StoryView } from '../store/selectors';
import { colors, radius, spacing, typography } from './theme';

interface StoryModalProps {
  readonly story: StoryView | null;
  readonly onChoose: (choiceId: string) => void;
  readonly onDismiss: () => void;
}

/**
 * The narrative interrupt. A node with choices must be answered; a node without
 * them is a beat the player acknowledges.
 */
export function StoryModal({ story, onChoose, onDismiss }: StoryModalProps): ReactNode {
  if (story === null) return null;
  const { node, choices } = story;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onDismiss}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <ScrollView contentContainerStyle={styles.content}>
            <Text style={styles.chapter}>Chapter {node.chapter}</Text>
            <Text style={styles.title}>{node.title}</Text>
            {node.speaker !== null ? <Text style={styles.speaker}>{node.speaker}</Text> : null}
            <Text style={styles.body}>{node.body}</Text>

            <View style={styles.choices}>
              {choices.length > 0 ? (
                choices.map((choice) => (
                  <Pressable
                    key={choice.id}
                    accessibilityRole="button"
                    onPress={() => {
                      onChoose(choice.id);
                    }}
                    style={({ pressed }) => [styles.choice, pressed && styles.choicePressed]}
                  >
                    <Text style={styles.choiceText}>{choice.text}</Text>
                    {choice.flavour !== null ? (
                      <Text style={styles.choiceFlavour}>{choice.flavour}</Text>
                    ) : null}
                  </Pressable>
                ))
              ) : (
                <Pressable
                  accessibilityRole="button"
                  onPress={onDismiss}
                  style={({ pressed }) => [styles.choice, pressed && styles.choicePressed]}
                >
                  <Text style={styles.choiceText}>Continue</Text>
                </Pressable>
              )}
            </View>

            {story.queued > 0 ? (
              <Text style={styles.queued}>
                {story.queued} more {story.queued === 1 ? 'moment' : 'moments'} waiting
              </Text>
            ) : null}
          </ScrollView>
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
    maxHeight: '85%',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.emberDim,
  },
  content: {
    padding: spacing.xl,
    gap: spacing.md,
  },
  chapter: {
    ...typography.label,
    color: colors.emberDim,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  title: {
    ...typography.title,
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
    lineHeight: 22,
  },
  choices: {
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  choice: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.xs,
  },
  choicePressed: {
    borderColor: colors.ember,
    opacity: 0.85,
  },
  choiceText: {
    ...typography.body,
    color: colors.text,
  },
  choiceFlavour: {
    ...typography.label,
    color: colors.textFaint,
    fontStyle: 'italic',
  },
  queued: {
    ...typography.label,
    color: colors.textFaint,
    textAlign: 'center',
  },
});
