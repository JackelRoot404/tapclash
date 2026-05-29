import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { COLORS } from '../constants/config';

const N = 6;
const PALETTE = [COLORS.accent, COLORS.accent, '#7CFFC4', COLORS.accent2];

// A short-lived particle burst fired at a hit location. Self-removes via onDone.
export function Burst({ x, y, onDone }: { x: number; y: number; onDone: () => void }) {
  const t = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(t, {
      toValue: 1,
      duration: 380,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start(() => onDone());
  }, [t, onDone]);

  return (
    <View pointerEvents="none" style={[styles.root, { left: x, top: y }]}>
      {Array.from({ length: N }).map((_, i) => {
        const angle = (i / N) * Math.PI * 2;
        const dist = 38 + (i % 3) * 12;
        const tx = t.interpolate({ inputRange: [0, 1], outputRange: [0, Math.cos(angle) * dist] });
        const ty = t.interpolate({ inputRange: [0, 1], outputRange: [0, Math.sin(angle) * dist] });
        const opacity = t.interpolate({ inputRange: [0, 0.65, 1], outputRange: [1, 0.85, 0] });
        const scale = t.interpolate({ inputRange: [0, 1], outputRange: [1, 0.25] });
        return (
          <Animated.View
            key={i}
            style={[
              styles.dot,
              {
                backgroundColor: PALETTE[i % PALETTE.length],
                opacity,
                transform: [{ translateX: tx }, { translateY: ty }, { scale }],
              },
            ]}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { position: 'absolute', width: 0, height: 0 },
  dot: { position: 'absolute', width: 11, height: 11, borderRadius: 6, marginLeft: -5.5, marginTop: -5.5 },
});
