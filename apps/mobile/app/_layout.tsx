import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { PaperProvider } from 'react-native-paper';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AuthProvider } from '../src/auth/AuthProvider';
import { appTheme } from '../src/ui/theme';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <PaperProvider
        theme={appTheme}
        settings={{
          icon: ({ name, color, size, testID }) => (
            <MaterialCommunityIcons name={name} color={color} size={size} testID={testID} />
          ),
        }}
      >
        <AuthProvider>
          <StatusBar style="dark" />
          <Stack screenOptions={{ headerShown: false }} />
        </AuthProvider>
      </PaperProvider>
    </SafeAreaProvider>
  );
}
