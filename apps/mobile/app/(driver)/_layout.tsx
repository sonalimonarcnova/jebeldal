import { Redirect } from 'expo-router';
import { Tabs } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Button, HelperText, Text } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '../../src/auth/AuthProvider';
import { resolveDriverRoute } from '../../src/auth/driverRoute';

export default function DriverTabsLayout() {
  const [actionError, setActionError] = useState<string | null>(null);
  const {
    session,
    profile,
    authLoading,
    profileLoading,
    profileError,
    refreshProfile,
    signOut,
  } = useAuth();

  const handleSignOut = async () => {
    setActionError(null);
    try {
      await signOut();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Could not sign out.');
    }
  };

  const routeState = resolveDriverRoute({
    authLoading,
    hasSession: session !== null,
    profileLoading,
    authError: null,
    profileError,
    profile,
  });

  if (routeState === 'loading') {
    return (
      <SafeAreaView
        style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F7F8FB' }}
      >
        <ActivityIndicator accessibilityLabel="Loading driver access" />
      </SafeAreaView>
    );
  }
  if (routeState === 'sign-in' || routeState === 'auth-error') {
    return <Redirect href="/(auth)/sign-in" />;
  }
  if (routeState === 'profile-error' || routeState === 'missing-profile') {
    return (
      <SafeAreaView
        style={{ flex: 1, justifyContent: 'center', padding: 24, backgroundColor: '#F7F8FB' }}
      >
        <Text variant="titleLarge">Driver profile unavailable</Text>
        {profileError ? <HelperText type="error">{profileError}</HelperText> : null}
        {actionError ? <HelperText type="error">{actionError}</HelperText> : null}
        <Button mode="contained" onPress={() => void refreshProfile()}>
          Retry
        </Button>
        <Button onPress={() => void handleSignOut()}>Sign out</Button>
      </SafeAreaView>
    );
  }
  if (routeState === 'not-driver') {
    return <Redirect href="/" />;
  }
  if (routeState === 'confirm-profile') {
    return <Redirect href="/(auth)/profile" />;
  }

  return (
    <Tabs screenOptions={{ headerShown: false, tabBarActiveTintColor: '#4F46E5' }}>
      <Tabs.Screen name="home" options={{ title: 'Home', tabBarLabel: 'Home' }} />
      <Tabs.Screen name="incidents" options={{ title: 'Incidents', tabBarLabel: 'Incidents' }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile', tabBarLabel: 'Profile' }} />
    </Tabs>
  );
}
