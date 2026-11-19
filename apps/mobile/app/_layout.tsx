import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { MD3LightTheme, PaperProvider } from 'react-native-paper';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AuthProvider } from '../src/auth/AuthProvider';

const appTheme = {
  ...MD3LightTheme,
  roundness: 14,
  colors: {
    ...MD3LightTheme.colors,
    primary: '#4F46E5',
    primaryContainer: '#E9E8FF',
    secondary: '#0F766E',
    secondaryContainer: '#D5F3EC',
    background: '#F6F7FB',
    surface: '#FFFFFF',
    surfaceVariant: '#F0F2F7',
    outline: '#CBD2DF',
  },
};

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
