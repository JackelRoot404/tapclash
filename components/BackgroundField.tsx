import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { COLORS } from '../constants/config';

// Faint twinkling dots that fill the dark arena. Positions are fractions of the
// arena size so they spread out at any dimension. Purely decorative.
const DOTS = [
  { fx: 0.14, fy: 0.10, r: 3, d: 2600 },
  { fx: 0.83, fy: 0.14, r: 2, d: 3300 },
  { fx: 0.50, fy: 0.07, r: 2, d: 2900 },
  { fx: 0.28, fy: 0.30, r: 2, d: 3600 },
  { fx: 0.71, fy: 0.34, r: 3, d: 2400 },
  { fx: 0.10, fy: 0.48, r: 2, d: 3100 },
  { fx: 0.90, fy: 0.52, r: 2, d: 2700 },
  { fx: 0.45, fy: 0.58, r: 3, d: 3400 },
  { fx: 0.22, fy: 0.72, r: 2, d: 2800 },
  { fx: 0.78, fy: 0.76, r: 3, d: 3200 },
  { fx: 0.55, fy: 0.84, r: 2, d: 2500 },
  { fx: 0.34, fy: 0.92, r: 2, d: 3500 },
  { fx: 0.66, fy: 0.95, r: 2, d: 3000 },
  { fx: 0.92, fy: 0.88, r: 2, d: 2600 },
];

export function BackgroundField({ w, h }: { w: number; h: number }) {
  if (w <= 0 || h <= 0) return null;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {DOTS.map((dot, i) => (
        <Twinkle key={i} x={dot.fx * w} y={dot.fy * h} r={dot.r} d={dot.d} />
      ))}
    </View>
  );
}

function Twinkle({ x, y, r, d }: { x: number; y: number; r: number; d: number }) {
  const a = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(a, { toValue: 1, duration: d, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(a, { toValue: 0, duration: d, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [a, d]);
  const opacity = a.interpolate({ inputRange: [0, 1], outputRange: [0.04, 0.20] });
  return (
    <Animated.View
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width: r * 2,
        height: r * 2,
        borderRadius: r,
        backgroundColor: COLORS.accent,
        opacity,
      }}
    />
  );
}
