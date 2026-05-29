import React, { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { COLORS } from '../constants/config';
import { ROUND_MS } from '../constants/game';

type Props = {
  timeLeftMs: number;
  score: number;
  combo: number;
};

export function Hud({ timeLeftMs, score, combo }: Props) {
  const secs = Math.max(0, Math.ceil(timeLeftMs / 1000));
  const low = secs <= 5;
  const pct = Math.max(0, Math.min(1, timeLeftMs / ROUND_MS));
  const displayScore = useCountUp(score);

  // Pop the combo number whenever it climbs.
  const comboScale = useRef(new Animated.Value(1)).current;
  const prevCombo = useRef(combo);
  useEffect(() => {
    if (combo > prevCombo.current && combo > 0) {
      comboScale.setValue(1);
      Animated.sequence([
        Animated.timing(comboScale, { toValue: 1.35, duration: 90, useNativeDriver: true }),
        Animated.spring(comboScale, { toValue: 1, friction: 4, tension: 180, useNativeDriver: true }),
      ]).start();
    }
    prevCombo.current = combo;
  }, [combo, comboScale]);

  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <Stat label="TIME" value={`${secs}s`} accent={low ? COLORS.danger : COLORS.text} />
        <Stat label="SCORE" value={String(displayScore)} accent={COLORS.accent} />
        <View style={styles.stat}>
          <Text style={styles.label}>COMBO</Text>
          <Animated.Text
            style={[styles.value, { color: combo >= 5 ? COLORS.gold : COLORS.textDim, transform: [{ scale: comboScale }] }]}
          >
            {combo}x
          </Animated.Text>
        </View>
      </View>
      <View style={styles.barTrack}>
        <View style={[styles.barFill, { width: `${pct * 100}%`, backgroundColor: low ? COLORS.danger : COLORS.accent }]} />
      </View>
    </View>
  );
}

// Tween the displayed score so it counts up instead of snapping.
function useCountUp(value: number) {
  const anim = useRef(new Animated.Value(value)).current;
  const [display, setDisplay] = useState(value);
  useEffect(() => {
    const id = anim.addListener(({ value: v }) => setDisplay(Math.round(v)));
    Animated.timing(anim, { toValue: value, duration: 140, useNativeDriver: false }).start();
    return () => anim.removeListener(id);
  }, [value, anim]);
  return display;
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
  card: {
    backgroundColor: COLORS.bgElev,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingTop: 14,
    paddingBottom: 12,
    paddingHorizontal: 20,
  },
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  stat: { alignItems: 'center', flex: 1 },
  label: { color: COLORS.textDim, fontSize: 11, fontWeight: '700', letterSpacing: 1.5 },
  value: { fontSize: 22, fontWeight: '800', marginTop: 2 },
  barTrack: {
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.07)',
    marginTop: 12,
    overflow: 'hidden',
  },
  barFill: { height: '100%', borderRadius: 2 },
});
