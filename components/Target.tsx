import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text } from 'react-native';
import { COLORS } from '../constants/config';
import type { TargetKind } from '../constants/game';

type Props = {
  x: number;
  y: number;
  kind: TargetKind;
  radius: number;
  onHit: () => void;
};

// Per-kind look. Gameplay numbers live in constants/game.ts; this is the view.
const KIND_VISUAL: Record<TargetKind, { color: string; glyph?: string; danger?: boolean }> = {
  normal: { color: COLORS.accent },
  bonus: { color: COLORS.gold, glyph: '★' },
  mini: { color: COLORS.accent2 },
  bomb: { color: COLORS.danger, glyph: '✕', danger: true },
};

// A circular tap target. Pops in with a spring, breathes a colored glow halo,
// and fires onHit when touched. Size + color vary by kind:
//   normal=green donut, bonus=gold donut w/ star, mini=small purple donut,
//   bomb=solid red disc w/ ✕ (DON'T tap — it penalizes / ends Sudden Death).
export function TargetView({ x, y, kind, radius, onHit }: Props) {
  const scale = useRef(new Animated.Value(0.3)).current;
  const pulse = useRef(new Animated.Value(0)).current;
  const v = KIND_VISUAL[kind];
  const halo = radius * 2.7;

  useEffect(() => {
    Animated.spring(scale, {
      toValue: 1,
      friction: 5,
      tension: 160,
      useNativeDriver: true,
    }).start();
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 600, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 600, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [scale, pulse]);

  const haloScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1.3] });
  const haloOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.12, 0.34] });

  return (
    <Animated.View
      style={[
        styles.wrap,
        { width: radius * 2, height: radius * 2, left: x - radius, top: y - radius, transform: [{ scale }] },
      ]}
      pointerEvents="box-none"
    >
      <Animated.View
        pointerEvents="none"
        style={[
          {
            position: 'absolute',
            width: halo,
            height: halo,
            left: (radius * 2 - halo) / 2,
            top: (radius * 2 - halo) / 2,
            borderRadius: halo / 2,
            backgroundColor: v.color,
          },
          { opacity: haloOpacity, transform: [{ scale: haloScale }] },
        ]}
      />
      <Pressable onPress={onHit} hitSlop={10} style={{ width: radius * 2, height: radius * 2, alignItems: 'center', justifyContent: 'center' }}>
        <Animated.View
          style={{
            width: radius * 2,
            height: radius * 2,
            borderRadius: radius,
            backgroundColor: v.color,
            alignItems: 'center',
            justifyContent: 'center',
            shadowColor: v.color,
            shadowOpacity: 0.8,
            shadowRadius: 16,
            elevation: 10,
          }}
        >
          {v.danger ? (
            // Solid disc + bold glyph so it reads as "different / dangerous".
            <Text style={{ color: COLORS.text, fontSize: radius, fontWeight: '900', lineHeight: radius * 1.18 }}>{v.glyph}</Text>
          ) : (
            <Animated.View
              style={{
                width: radius,
                height: radius,
                borderRadius: radius / 2,
                backgroundColor: COLORS.bg,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {v.glyph ? <Text style={{ color: v.color, fontSize: radius * 0.62, fontWeight: '900' }}>{v.glyph}</Text> : null}
            </Animated.View>
          )}
        </Animated.View>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
