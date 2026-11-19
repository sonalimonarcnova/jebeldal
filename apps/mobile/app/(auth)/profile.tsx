import { Redirect, router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Button, HelperText, SegmentedButtons, Text, TextInput } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '../../src/auth/AuthProvider';

export default function DriverProfileConfirmationRoute() {
  const {
    session,
    profile,
    profileLoading,
    profileError,
    refreshProfile,
    confirmProfile,
    signOut,
  } = useAuth();
  const [displayName, setDisplayName] = useState(profile?.displayName ?? '');
  const [phone, setPhone] = useState(profile?.phone ?? '');
  const [preferredLanguage, setPreferredLanguage] = useState<'en' | 'es'>(
    profile?.preferredLanguage === 'es' ? 'es' : 'en',
  );
  const [submitting, setSubmitting] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);

  useEffect(() => {
    setDisplayName(profile?.displayName ?? '');
    setPhone(profile?.phone ?? '');
    setPreferredLanguage(profile?.preferredLanguage === 'es' ? 'es' : 'en');
  }, [profile]);

  if (!session) {
    return <Redirect href="/(auth)/sign-in" />;
  }
  if (profileLoading) {
    return (
      <SafeAreaView style={styles.centered}>
        <ActivityIndicator accessibilityLabel="Loading driver profile" />
      </SafeAreaView>
    );
  }
  if (!profile) {
    return (
      <SafeAreaView style={styles.centered}>
        <Text variant="titleMedium">Driver profile unavailable</Text>
        {profileError ? <HelperText type="error">{profileError}</HelperText> : null}
        <Button onPress={() => void refreshProfile()}>Retry</Button>
        <Button onPress={() => void signOut()}>Sign out</Button>
      </SafeAreaView>
    );
  }
  if (profile.role !== 'driver') {
    return <Redirect href="/" />;
  }
  const handleConfirm = async () => {
    setSubmitting(true);
    setErrorText(null);
    try {
      await confirmProfile({ displayName, phone, preferredLanguage });
      router.replace('/(driver)/home');
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Could not confirm driver profile.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSignOut = async () => {
    setErrorText(null);
    try {
      await signOut();
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Could not sign out.');
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <Text variant="labelLarge">Profile confirmation</Text>
          <Text variant="headlineMedium">Your profile</Text>
          <Text variant="bodyMedium" style={styles.subtitle}>
            Confirm the roster details used for your incident reports.
          </Text>
        </View>

        <TextInput
          mode="outlined"
          label="Full name"
          accessibilityLabel="Full name"
          value={displayName}
          onChangeText={setDisplayName}
          disabled={submitting}
        />
        <TextInput
          mode="outlined"
          label="Mobile"
          accessibilityLabel="Mobile"
          keyboardType="phone-pad"
          value={phone}
          onChangeText={setPhone}
          disabled={submitting}
        />
        <TextInput
          mode="outlined"
          label="Employee ID"
          accessibilityLabel="Employee ID"
          value={profile.employeeId || 'Not provided'}
          editable={false}
        />
        <TextInput
          mode="outlined"
          label="Assigned vehicle"
          accessibilityLabel="Assigned vehicle"
          value={
            profile.vehicle
              ? `${profile.vehicle.unitNumber} · ${profile.vehicle.makeModel ?? 'Vehicle'}`
              : 'No vehicle assigned'
          }
          editable={false}
        />
        <Text variant="bodyMedium">Organization: {profile.organizationName}</Text>
        <Text variant="labelLarge">Report language</Text>
        <SegmentedButtons
          value={preferredLanguage}
          onValueChange={(value) => {
            if (value === 'en' || value === 'es') {
              setPreferredLanguage(value);
            }
          }}
          buttons={[
            { value: 'en', label: 'English' },
            { value: 'es', label: 'Espanol' },
          ]}
        />

        {errorText ? <HelperText type="error">{errorText}</HelperText> : null}
        <Button
          mode="contained"
          onPress={() => void handleConfirm()}
          disabled={submitting || !displayName.trim()}
          loading={submitting}
        >
          Confirm profile
        </Button>
        <Button onPress={() => void handleSignOut()} disabled={submitting}>
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
    padding: 24,
  },
  header: {
    gap: 8,
    marginBottom: 8,
  },
  subtitle: {
    color: '#58606E',
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
});
