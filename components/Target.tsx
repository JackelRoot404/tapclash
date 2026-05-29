import React, { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet } from 'react-native';
import { COLORS } from '../constants/config';
import { TARGET_RADIUS } from '../constants/game';

type Props = {
  x: number;
  y: number;
  onHit: () => void;
};

// A circular tap target. Pops in with a scale animation; touching it fires onHit.
export function TargetView({ x, y, onHit }: Props) {
  const scale = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    Animated.spring(scale, {
      toValue: 1,
      friction: 5,
      tension: 140,
      useNativeDriver: true,
    }).start();
  }, [scale]);

  return (
    <Animated.View
      style={[
        styles.wrap,
        {
          left: x - TARGET_RADIUS,
          top: y - TARGET_RADIUS,
          transform: [{ scale }],
        },
      ]}
      pointerEvents="box-none"
    >
      <Pressable onPress={onHit} hitSlop={8} style={styles.touch}>
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
  },
  touch: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  outer: {
    width: TARGET_RADIUS * 2,
    height: TARGET_RADIUS * 2,
    borderRadius: TARGET_RADIUS,
    backgroundColor: COLORS.accent,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: COLORS.accent,
    shadowOpacity: 0.6,
    shadowRadius: 14,
    elevation: 8,
  },
  inner: {
    width: TARGET_RADIUS,
    height: TARGET_RADIUS,
    borderRadius: TARGET_RADIUS / 2,
    backgroundColor: COLORS.bg,
  },
});
