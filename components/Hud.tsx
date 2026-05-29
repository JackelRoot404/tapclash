import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { COLORS } from '../constants/config';

type Props = {
  timeLeftMs: number;
  score: number;
  combo: number;
};

export function Hud({ timeLeftMs, score, combo }: Props) {
  const secs = Math.max(0, Math.ceil(timeLeftMs / 1000));
  return (
    <View style={styles.row}>
      <Stat label="TIME" value={`${secs}s`} accent={secs <= 5 ? COLORS.danger : COLORS.text} />
      <Stat label="SCORE" value={String(score)} accent={COLORS.accent} />
      <Stat label="COMBO" value={`${combo}x`} accent={combo >= 5 ? COLORS.gold : COLORS.textDim} />
    </View>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.label}>{label}</Text>
      <Text style={[styles.value, { color: accent }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
    backgroundColor: COLORS.bgElev,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  stat: { alignItems: 'center', flex: 1 },
  label: { color: COLORS.textDim, fontSize: 11, fontWeight: '700', letterSpacing: 1.5 },
  value: { fontSize: 22, fontWeight: '800', marginTop: 2 },
});
