import { Redirect, router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Button, HelperText, Text } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '../src/auth/AuthProvider';
import { resolveDriverRoute } from '../src/auth/driverRoute';

export default function IndexRoute() {
  const {
    session,
    profile,
    authLoading,
    profileLoading,
    authError,
    profileError,
    refreshProfile,
    signOut,
  } = useAuth();
  const [actionError, setActionError] = useState<string | null>(null);

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
    authError,
    profileError,
    profile,
  });

  if (routeState === 'loading') {
    return (
      <SafeAreaView
        style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F7F8FB' }}
      >
        <ActivityIndicator accessibilityLabel="Loading sign-in" />
      </SafeAreaView>
    );
  }

  if (routeState === 'auth-error') {
    return (
      <SafeAreaView
        style={{ flex: 1, justifyContent: 'center', padding: 24, backgroundColor: '#F7F8FB' }}
      >
        <Text variant="titleLarge">Unable to restore your sign-in</Text>
        <HelperText type="error">{authError}</HelperText>
        <HelperText type="error">{actionError}</HelperText>
        <Button onPress={() => router.replace('/(auth)/sign-in')}>Go to sign in</Button>
      </SafeAreaView>
    );
  }

  if (routeState === 'sign-in') {
    return <Redirect href="/(auth)/sign-in" />;
  }

  if (routeState === 'profile-error') {
    return (
      <SafeAreaView
        style={{ flex: 1, justifyContent: 'center', padding: 24, backgroundColor: '#F7F8FB' }}
      >
        <Text variant="titleLarge">Driver profile unavailable</Text>
        <HelperText type="error">{profileError}</HelperText>
        <Button mode="contained" onPress={() => void refreshProfile()}>
          Retry
        </Button>
        <HelperText type="error">{actionError}</HelperText>
        <Button onPress={() => void handleSignOut()}>Sign out</Button>
      </SafeAreaView>
    );
  }

  if (routeState === 'missing-profile') {
    return (
      <SafeAreaView
        style={{ flex: 1, justifyContent: 'center', padding: 24, backgroundColor: '#F7F8FB' }}
      >
        <Text variant="titleLarge">No driver profile is linked to this account.</Text>
        <HelperText type="info">Contact your fleet administrator for access.</HelperText>
        <HelperText type="error">{actionError}</HelperText>
        <Button onPress={() => void handleSignOut()}>Sign out</Button>
      </SafeAreaView>
    );
  }

  if (routeState === 'not-driver') {
    return (
      <SafeAreaView
        style={{ flex: 1, justifyContent: 'center', padding: 24, backgroundColor: '#F7F8FB' }}
      >
        <Text variant="titleLarge">This app is for driver accounts.</Text>
        <HelperText type="error">{actionError}</HelperText>
        <Button onPress={() => void handleSignOut()}>Sign out</Button>
      </SafeAreaView>
    );
  }

  if (routeState === 'confirm-profile') {
    return <Redirect href="/(auth)/profile" />;
  }

  return <Redirect href="/(driver)/home" />;
}
