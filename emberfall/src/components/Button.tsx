import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing, typography } from './theme';

interface ButtonProps {
  readonly label: string;
  readonly sublabel?: string;
  readonly onPress: () => void;
  readonly disabled?: boolean;
  readonly tone?: 'primary' | 'neutral';
  readonly accessibilityHint?: string;
  readonly children?: ReactNode;
}

export function Button({
  label,
  sublabel,
  onPress,
  disabled = false,
  tone = 'primary',
  accessibilityHint,
  children,
}: ButtonProps): ReactNode {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      accessibilityHint={accessibilityHint}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        tone === 'primary' ? styles.primary : styles.neutral,
        disabled && styles.disabled,
        pressed && !disabled && styles.pressed,
      ]}
    >
      <View>
        <Text style={[styles.label, disabled && styles.labelDisabled]}>{label}</Text>
        {sublabel !== undefined ? (
          <Text style={[styles.sublabel, disabled && styles.labelDisabled]}>{sublabel}</Text>
        ) : null}
      </View>
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primary: {
    backgroundColor: colors.emberDim,
    borderColor: colors.ember,
  },
  neutral: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
  },
  disabled: {
    backgroundColor: colors.disabled,
    borderColor: colors.border,
  },
  pressed: {
    opacity: 0.7,
  },
  label: {
    ...typography.label,
    color: colors.text,
    textAlign: 'center',
  },
  labelDisabled: {
    color: colors.textFaint,
  },
  sublabel: {
    ...typography.label,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: 2,
  },
});
