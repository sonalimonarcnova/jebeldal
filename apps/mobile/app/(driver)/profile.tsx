import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { Button, Card, HelperText, Text } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '../../src/auth/AuthProvider';

export default function DriverAccountRoute() {
  const { profile, signOut } = useAuth();
  const [errorText, setErrorText] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  const handleSignOut = async () => {
    setSigningOut(true);
    setErrorText(null);
    try {
      await signOut();
      router.replace('/(auth)/sign-in');
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Could not sign out.');
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text variant="headlineMedium">Profile</Text>
        {profile ? (
          <Card>
            <Card.Content style={styles.cardContent}>
              <Text variant="titleLarge">{profile.displayName}</Text>
              <Text variant="bodyMedium">{profile.organizationName}</Text>
              <Text variant="bodyMedium">Employee ID: {profile.employeeId || 'Not provided'}</Text>
              <Text variant="bodyMedium">Mobile: {profile.phone || 'Not provided'}</Text>
              <Text variant="bodyMedium">
                Assigned unit: {profile.vehicle?.unitNumber ?? 'Not assigned'}
              </Text>
              <Text variant="bodyMedium">
                Report language: {profile.preferredLanguage.toUpperCase()}
              </Text>
              <Button onPress={() => router.push('/(auth)/profile')}>
                Review profile details
              </Button>
            </Card.Content>
          </Card>
        ) : (
          <HelperText type="error">Driver profile is unavailable.</HelperText>
        )}
        {errorText ? <HelperText type="error">{errorText}</HelperText> : null}
        <Button mode="outlined" onPress={() => void handleSignOut()} loading={signingOut}>
          Sign out
        </Button>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#F7F8FB',
  },
  content: {
    gap: 16,
    padding: 20,
  },
  cardContent: {
    gap: 10,
  },
});
