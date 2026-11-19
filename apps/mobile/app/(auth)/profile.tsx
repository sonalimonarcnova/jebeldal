import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { ActivityIndicator, Card, HelperText, Text, TextInput } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '../../src/auth/AuthProvider';
import { AppButton as Button } from '../../src/ui/AppButton';
import { palette } from '../../src/ui/theme';

export default function DriverProfileConfirmationRoute() {
  const { returnTo } = useLocalSearchParams<{ returnTo?: string }>();
  const returnToProfile = returnTo === 'driver-profile';
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
  const [submitting, setSubmitting] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);

  const handleBackToProfile = () => {
    router.replace('/(driver)/profile');
  };

  useEffect(() => {
    setDisplayName(profile?.displayName ?? '');
    setPhone(profile?.phone ?? '');
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
      await confirmProfile({ displayName, phone });
      router.replace(returnToProfile ? '/(driver)/profile' : '/(driver)/home');
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
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.header}>
            {returnToProfile ? (
              <Button
                mode="text"
                icon="arrow-left"
                accessibilityLabel="Back to profile"
                onPress={handleBackToProfile}
                style={styles.backButton}
              >
                Back
              </Button>
            ) : null}
            <Text variant="labelLarge" style={styles.eyebrow}>Profile confirmation</Text>
            <Text variant="headlineMedium" style={styles.title}>Your profile</Text>
            <Text variant="bodyMedium" style={styles.subtitle}>
              Confirm the roster details used for your incident reports.
            </Text>
          </View>

          <Card mode="elevated" style={styles.card}>
            <Card.Content style={styles.form}>
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
              <View style={styles.meta}>
                <Text variant="bodyMedium">
                  <Text style={styles.metaLabel}>Organization</Text>
                  {`\n${profile.organizationName}`}
                </Text>
                <Text variant="bodyMedium">
                  <Text style={styles.metaLabel}>Report language</Text>
                  {'\nEnglish (the only supported MVP language)'}
                </Text>
              </View>
              {errorText ? <HelperText type="error">{errorText}</HelperText> : null}
              <Button
                mode="contained"
                onPress={() => void handleConfirm()}
                disabled={submitting || !displayName.trim()}
                loading={submitting}
              >
                Confirm profile
              </Button>
              <Button mode="text" onPress={() => void handleSignOut()} disabled={submitting}>
                Sign out
              </Button>
            </Card.Content>
          </Card>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: palette.background,
  },
  flex: {
    flex: 1,
  },
  content: {
    alignSelf: 'center',
    gap: 24,
    padding: 24,
    width: '100%',
    maxWidth: 600,
  },
  header: {
    alignItems: 'flex-start',
    gap: 6,
  },
  backButton: {
    marginLeft: -8,
  },
  eyebrow: {
    color: palette.primary,
  },
  title: {
    color: palette.text,
  },
  subtitle: {
    color: palette.mutedText,
  },
  card: {
    borderColor: palette.border,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 20,
  },
  form: {
    gap: 16,
    padding: 20,
  },
  meta: {
    backgroundColor: palette.surfaceVariant,
    borderRadius: 12,
    gap: 12,
    padding: 16,
  },
  metaLabel: {
    color: palette.mutedText,
    fontWeight: '600',
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
});
