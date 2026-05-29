import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, StyleSheet } from 'react-native';
import { COLORS } from '../constants/config';
import { TARGET_RADIUS } from '../constants/game';

type Props = {
  x: number;
  y: number;
  onHit: () => void;
};

const HALO = TARGET_RADIUS * 2.7;

// A circular tap target: pops in with a spring, breathes a green glow halo to
// draw the eye, and fires onHit when touched.
export function TargetView({ x, y, onHit }: Props) {
  const scale = useRef(new Animated.Value(0.3)).current;
  const pulse = useRef(new Animated.Value(0)).current;

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
      style={[styles.wrap, { left: x - TARGET_RADIUS, top: y - TARGET_RADIUS, transform: [{ scale }] }]}
      pointerEvents="box-none"
    >
      <Animated.View
        pointerEvents="none"
        style={[styles.halo, { opacity: haloOpacity, transform: [{ scale: haloScale }] }]}
      />
      <Pressable onPress={onHit} hitSlop={10} style={styles.touch}>
        <Animated.View style={styles.outer}>
          <Animated.View style={styles.inner} />
        </Animated.View>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    width: TARGET_RADIUS * 2,
    height: TARGET_RADIUS * 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  halo: {
    position: 'absolute',
    width: HALO,
    height: HALO,
    left: (TARGET_RADIUS * 2 - HALO) / 2,
    top: (TARGET_RADIUS * 2 - HALO) / 2,
    borderRadius: HALO / 2,
    backgroundColor: COLORS.accent,
  },
  touch: { width: TARGET_RADIUS * 2, height: TARGET_RADIUS * 2, alignItems: 'center', justifyContent: 'center' },
  outer: {
    width: TARGET_RADIUS * 2,
    height: TARGET_RADIUS * 2,
    borderRadius: TARGET_RADIUS,
    backgroundColor: COLORS.accent,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: COLORS.accent,
    shadowOpacity: 0.8,
    shadowRadius: 16,
    elevation: 10,
  },
  inner: {
    width: TARGET_RADIUS,
    height: TARGET_RADIUS,
    borderRadius: TARGET_RADIUS / 2,
    backgroundColor: COLORS.bg,
  },
});
