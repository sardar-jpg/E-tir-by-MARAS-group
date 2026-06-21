import { MaterialIcons } from '@expo/vector-icons';
import { Tabs, Slot } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Platform, Dimensions, View, StyleSheet, Text } from 'react-native';
import { useState, useEffect } from 'react';
import { Colors, FontSize, BorderRadius, Spacing } from '@/constants/theme';
import { AdminSidebar } from '@/components/layout/AdminSidebar';
import { useChat } from '@/hooks/useChat';

function useIsDesktop() {
  const [isDesktop, setIsDesktop] = useState(() => Dimensions.get('window').width >= 1024);
  useEffect(() => {
    const sub = Dimensions.addEventListener('change', ({ window }) => {
      setIsDesktop(window.width >= 1024);
    });
    return () => sub?.remove();
  }, []);
  return isDesktop;
}

export default function TabLayout() {
  const insets = useSafeAreaInsets();
  const isDesktop = useIsDesktop();
  const { totalUnread } = useChat();

  if (isDesktop) {
    return (
      <View style={styles.desktopRoot}>
        <AdminSidebar />
        <View style={styles.desktopContent}>
          <Slot />
        </View>
      </View>
    );
  }

  const tabBarHeight = Platform.select({ ios: insets.bottom + 62, android: insets.bottom + 62, default: 72 });

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          height: tabBarHeight,
          paddingTop: 8,
          paddingBottom: Platform.select({ ios: insets.bottom + 8, android: insets.bottom + 8, default: 10 }),
          paddingHorizontal: 4,
          backgroundColor: Colors.surface,
          borderTopWidth: 1,
          borderTopColor: Colors.border,
        },
        tabBarActiveTintColor: Colors.primary,
        tabBarInactiveTintColor: Colors.textMuted,
        tabBarLabelStyle: { fontSize: 10, fontWeight: '700', marginTop: 2 },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Dashboard',
          tabBarIcon: ({ color, focused }) => (
            <View style={[tabStyles.iconWrap, focused && tabStyles.iconWrapActive]}>
              <MaterialIcons name="dashboard" size={20} color={color} />
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="shipments"
        options={{
          title: 'Shipments',
          tabBarIcon: ({ color, focused }) => (
            <View style={[tabStyles.iconWrap, focused && tabStyles.iconWrapActive]}>
              <MaterialIcons name="local-shipping" size={20} color={color} />
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="drivers"
        options={{
          title: 'Drivers',
          tabBarIcon: ({ color, focused }) => (
            <View style={[tabStyles.iconWrap, focused && tabStyles.iconWrapActive]}>
              <MaterialIcons name="people" size={20} color={color} />
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="clients"
        options={{
          title: 'Clients',
          tabBarIcon: ({ color, focused }) => (
            <View style={[tabStyles.iconWrap, focused && tabStyles.iconWrapActive]}>
              <MaterialIcons name="business" size={20} color={color} />
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="chat"
        options={{
          title: 'Chat',
          tabBarBadge: totalUnread > 0 ? totalUnread : undefined,
          tabBarBadgeStyle: { backgroundColor: Colors.danger, fontSize: 9, minWidth: 16, height: 16 },
          tabBarIcon: ({ color, focused }) => (
            <View style={[tabStyles.iconWrap, focused && tabStyles.iconWrapActive]}>
              <MaterialIcons name="chat" size={20} color={color} />
            </View>
          ),
        }}
      />
    </Tabs>
  );
}

const tabStyles = StyleSheet.create({
  iconWrap: {
    width: 36, height: 28, borderRadius: BorderRadius.sm,
    alignItems: 'center', justifyContent: 'center',
  },
  iconWrapActive: {
    backgroundColor: Colors.primaryGlow,
  },
});

const styles = StyleSheet.create({
  desktopRoot: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: Colors.bg,
  },
  desktopContent: {
    flex: 1,
    overflow: 'hidden',
  },
});
