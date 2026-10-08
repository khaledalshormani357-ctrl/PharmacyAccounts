import React, { useEffect, useRef } from 'react';
import { Animated, Image, StatusBar, Text, View } from 'react-native';
import * as SplashScreen from 'expo-splash-screen';

interface AnimatedBrandSplashProps {
  onFinish: () => void;
}

export function AnimatedBrandSplash({ onFinish }: AnimatedBrandSplashProps) {
  const opacity = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.84)).current;
  const glow = useRef(new Animated.Value(0.18)).current;
  const finished = useRef(false);

  useEffect(() => {
    let mounted = true;
    let fadeTimer: ReturnType<typeof setTimeout> | undefined;
    const play = async () => {
      await SplashScreen.hideAsync().catch(() => undefined);
      if (!mounted) return;

      Animated.parallel([
        Animated.timing(opacity, { toValue: 1, duration: 420, useNativeDriver: true }),
        Animated.spring(scale, { toValue: 1, tension: 75, friction: 8, useNativeDriver: true }),
        Animated.sequence([
          Animated.timing(glow, { toValue: 0.6, duration: 620, useNativeDriver: true }),
          Animated.timing(glow, { toValue: 0.24, duration: 620, useNativeDriver: true }),
        ]),
      ]).start();

      fadeTimer = setTimeout(() => {
        Animated.timing(opacity, { toValue: 0, duration: 280, useNativeDriver: true }).start(({ finished: animationFinished }) => {
          if (animationFinished && mounted && !finished.current) {
            finished.current = true;
            onFinish();
          }
        });
      }, 1120);
    };
    void play();
    return () => {
      mounted = false;
      if (fadeTimer) clearTimeout(fadeTimer);
    };
  }, [glow, onFinish, opacity, scale]);

  return (
    <Animated.View
      pointerEvents="auto"
      style={{
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        zIndex: 1000,
        backgroundColor: '#0A1530',
        alignItems: 'center',
        justifyContent: 'center',
        opacity,
      }}
    >
      <StatusBar barStyle="light-content" backgroundColor="#0A1530" />
      <View style={{ alignItems: 'center', justifyContent: 'center' }}>
        <Animated.View style={{ position: 'absolute', width: 208, height: 208, borderRadius: 104, backgroundColor: 'rgba(36,118,232,0.12)', opacity: glow, transform: [{ scale }] }} />
        <Animated.View style={{ width: 154, height: 154, alignItems: 'center', justifyContent: 'center', transform: [{ scale }] }}>
          <Image
            source={require('../assets/images/pharmacy-ai-mark.png')}
            resizeMode="contain"
            style={{ width: 144, height: 144 }}
            accessibilityLabel="شعار صيدلية الذكاء"
          />
        </Animated.View>
      </View>
      <Animated.View style={{ opacity, alignItems: 'center', marginTop: 28 }}>
        <Text style={{ color: '#F7FAFF', fontSize: 27, fontWeight: '800', letterSpacing: 0.2 }}>صيدلية الذكاء</Text>
        <Text style={{ color: '#AABBD7', fontSize: 14, marginTop: 8 }}>إدارة صيدليتك بذكاء</Text>
      </Animated.View>
      <View style={{ position: 'absolute', bottom: 42, alignItems: 'center' }}>
        <View style={{ width: 28, height: 3, borderRadius: 2, backgroundColor: '#287BEA', marginBottom: 10 }} />
        <Text style={{ color: '#7186A8', fontSize: 11 }}>نظام إدارة الصيدلية</Text>
      </View>
    </Animated.View>
  );
}
