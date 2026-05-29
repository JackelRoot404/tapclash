import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, ViewStyle } from 'react-native';
import { COLORS } from '../constants/config';

type Props = {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'ghost';
  loading?: boolean;
  disabled?: boolean;
  style?: ViewStyle;
};

export function Button({ label, onPress, variant = 'primary', loading, disabled, style }: Props) {
  const palette = variant === 'primary'
    ? { bg: COLORS.accent, fg: '#001b10', border: COLORS.accent }
    : variant === 'secondary'
    ? { bg: COLORS.bgElev2, fg: COLORS.text, border: COLORS.border }
    : { bg: 'transparent', fg: COLORS.textDim, border: 'transparent' };

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.base,
        { backgroundColor: palette.bg, borderColor: palette.border, opacity: disabled ? 0.5 : pressed ? 0.85 : 1 },
        style,
      ]}
    >
      {loading
        ? <ActivityIndicator color={palette.fg} />
        : <Text style={[styles.label, { color: palette.fg }]}>{label}</Text>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 52,
    paddingHorizontal: 24,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: { fontSize: 16, fontWeight: '700', letterSpacing: 0.3 },
});
