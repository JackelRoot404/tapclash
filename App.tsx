import React, { useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import * as SplashScreen from 'expo-splash-screen';

import { WalletProvider } from './context/WalletContext';
import { SeasonProvider } from './context/SeasonContext';
import PlayScreen from './screens/PlayScreen';
import LeaderboardScreen from './screens/LeaderboardScreen';
import SeasonScreen from './screens/SeasonScreen';
import ProfileScreen from './screens/ProfileScreen';
import { COLORS } from './constants/config';
import { Text, View } from 'react-native';

SplashScreen.preventAutoHideAsync();

const Tab = createBottomTabNavigator();

// Icon-free tab labels keep us off @expo/vector-icons until you wire in the font.
function TabGlyph({ label, focused }: { label: string; focused: boolean }) {
  return (
    <View style={{ alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: focused ? COLORS.accent : COLORS.textDim, fontSize: 16 }}>{label}</Text>
    </View>
  );
}

function AppNavigator() {
  const insets = useSafeAreaInsets();
  const TAB_CONTENT_HEIGHT = 56;
  const tabBarHeight = TAB_CONTENT_HEIGHT + insets.bottom;

  return (
    <NavigationContainer>
      <StatusBar style="light" />
      <Tab.Navigator
        screenOptions={({ route }) => ({
          headerShown: false,
          tabBarStyle: {
            backgroundColor: COLORS.bg,
            borderTopColor: COLORS.border,
            borderTopWidth: 1,
            height: tabBarHeight,
            paddingBottom: insets.bottom + 6,
            paddingTop: 4,
          },
          tabBarActiveTintColor: COLORS.accent,
          tabBarInactiveTintColor: COLORS.textDim,
          tabBarLabelStyle: { fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
          tabBarIcon: ({ focused }) => {
            const glyph =
              route.name === 'Play' ? '●' :
              route.name === 'Ranks' ? '▲' :
              route.name === 'Season' ? '◆' : '◉';
            return <TabGlyph label={glyph} focused={focused} />;
          },
        })}
      >
        <Tab.Screen name="Play" component={PlayScreen} />
        <Tab.Screen name="Ranks" component={LeaderboardScreen} />
        <Tab.Screen name="Season" component={SeasonScreen} />
        <Tab.Screen name="Profile" component={ProfileScreen} />
      </Tab.Navigator>
    </NavigationContainer>
  );
}

export default function App() {
  useEffect(() => {
    SplashScreen.hideAsync();
  }, []);

  return (
    <SafeAreaProvider>
      <WalletProvider>
        <SeasonProvider>
          <AppNavigator />
        </SeasonProvider>
      </WalletProvider>
    </SafeAreaProvider>
  );
}
