import { useEffect, useRef } from 'react';
import { View, Text, Image, Animated, StyleSheet, Dimensions } from 'react-native';
import { Colors } from '../lib/theme';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('screen');

export function SplashScreen({ onDone }: { onDone: () => void }) {
  const opacity = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.8)).current;
  const textOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.sequence([
      Animated.parallel([
        Animated.timing(opacity, { toValue: 1, duration: 350, useNativeDriver: true }),
        Animated.spring(scale, { toValue: 1, useNativeDriver: true, tension: 120, friction: 8 }),
      ]),
      Animated.timing(textOpacity, { toValue: 1, duration: 300, delay: 100, useNativeDriver: true }),
      Animated.delay(850),
      Animated.timing(opacity, { toValue: 0, duration: 400, useNativeDriver: true }),
    ]).start(() => onDone());
  }, []);

  return (
    <Animated.View style={[s.root, { opacity }]}>
      <Animated.View style={[s.logoWrap, { transform: [{ scale }] }]}>
        <Image
          source={require('../assets/icon.png')}
          style={s.logo}
          resizeMode="contain"
        />
      </Animated.View>
      <Animated.View style={[s.textWrap, { opacity: textOpacity }]}>
        <Text style={s.appName}>Team Metrics</Text>
        <Text style={s.tagline}>Kanban Flow Dashboard</Text>
      </Animated.View>
      <Animated.View style={[s.dots, { opacity: textOpacity }]}>
        <View style={[s.dot, s.dotActive]} />
        <View style={s.dot} />
        <View style={s.dot} />
      </Animated.View>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  root: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: SCREEN_W,
    height: SCREEN_H,
    backgroundColor: Colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 999,
    gap: 20,
  },
  logoWrap: { alignItems: 'center' },
  logo: { width: 110, height: 110, borderRadius: 26 },
  textWrap: { alignItems: 'center', gap: 6 },
  appName: { fontSize: 28, fontWeight: '700', color: Colors.text, letterSpacing: -0.5 },
  tagline: { fontSize: 13, color: Colors.textSubtle, letterSpacing: 0.5 },
  dots: { flexDirection: 'row', gap: 6, marginTop: 8 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: Colors.border },
  dotActive: { backgroundColor: Colors.primary },
});
