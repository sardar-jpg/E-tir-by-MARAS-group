import { Stack } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AlertProvider } from '@/template';
import { AuthProvider } from '@/contexts/AuthContext';
import { ShipmentsProvider } from '@/contexts/ShipmentsContext';
import { DriversProvider } from '@/contexts/DriversContext';
import { ChatProvider } from '@/contexts/ChatContext';
import { ClientsProvider } from '@/contexts/ClientsContext';
import { LanguageProvider } from '@/contexts/LanguageContext';
import { ForceUpdateGate } from '@/components/ui/ForceUpdateGate';

export default function RootLayout() {
  return (
    <AlertProvider>
      <ForceUpdateGate>
      <LanguageProvider>
        <SafeAreaProvider>
          <AuthProvider>
          <ShipmentsProvider>
            <DriversProvider>
              <ClientsProvider>
              <ChatProvider>
                  <Stack screenOptions={{ headerShown: false }}>
                    <Stack.Screen name="index" />
                    <Stack.Screen name="(tabs)" />
                    <Stack.Screen name="driver" />
                    <Stack.Screen name="tracking" />
                    <Stack.Screen name="shipment-detail" options={{ presentation: 'modal' }} />
                    <Stack.Screen name="customer" />
                    <Stack.Screen name="reset-password" />
                  </Stack>
              </ChatProvider>
              </ClientsProvider>
            </DriversProvider>
          </ShipmentsProvider>
        </AuthProvider>
        </SafeAreaProvider>
      </LanguageProvider>
      </ForceUpdateGate>
    </AlertProvider>
  );
}
