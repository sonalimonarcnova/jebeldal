import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import {
  ActivityIndicator,
  HelperText,
  SegmentedButtons,
  Text,
  TextInput,
} from 'react-native-paper';
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
  const [preferredLanguage, setPreferredLanguage] = useState<'en' | 'es'>(
    profile?.preferredLanguage ?? 'en',
  );
  const [submitting, setSubmitting] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);

  const handleBack = () => {
    if (returnToProfile) {
      router.replace('/(driver)/profile');
      return;
    }
    router.back();
  };

  useEffect(() => {
    setDisplayName(profile?.displayName ?? '');
    setPhone(profile?.phone ?? '');
    setPreferredLanguage(profile?.preferredLanguage ?? 'en');
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
      router.replace('/(driver)/face');
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
            <View style={styles.headerTop}>
              <Button
                mode="text"
                icon="arrow-left"
                accessibilityLabel={returnToProfile ? 'Back to profile' : 'Back'}
                onPress={handleBack}
                style={styles.backButton}
              >
                Back
              </Button>
              <Text variant="labelLarge" style={styles.stepText}>Step 1 of 4</Text>
            </View>
            <Text variant="headlineMedium" style={styles.title}>Your profile</Text>
            <Text variant="bodyMedium" style={styles.subtitle}>
              We pulled this from your fleet roster. Fix anything that's off.
            </Text>
          </View>

          <View style={styles.profileCard}>
            <View style={styles.initialsBadge}>
              <Text variant="titleLarge" style={styles.initialsText}>
                {displayName
                  .split(/\s+/)
                  .filter(Boolean)
                  .slice(0, 2)
                  .map((part) => part[0]?.toUpperCase())
                  .join('') || 'DR'}
              </Text>
            </View>
            <View style={styles.profileCardDetails}>
              <Text variant="titleMedium" style={styles.profileName}>
                {displayName.trim() || 'Driver'}
              </Text>
              <Text variant="bodySmall" style={styles.profileRole}>Driver</Text>
            </View>
          </View>

          <View style={styles.form}>
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
              label="Home terminal"
              accessibilityLabel="Home terminal"
              value={profile.organizationName || 'Not provided'}
              editable={false}
            />
            <TextInput
              mode="outlined"
              label="Assigned unit"
              accessibilityLabel="Assigned unit"
              value={
                profile.vehicle
                  ? `${profile.vehicle.unitNumber} · ${profile.vehicle.makeModel ?? 'Vehicle'}`
                  : 'No unit assigned'
              }
              editable={false}
            />
            <View style={styles.languageSection}>
              <Text variant="bodyMedium" style={styles.languageLabel}>Report language</Text>
              <SegmentedButtons
                value={preferredLanguage}
                onValueChange={(value) => {
                  if (value === 'en' || value === 'es') {
                    setPreferredLanguage(value);
                  }
                }}
                density="small"
                buttons={[
                  {
                    value: 'en',
                    label: 'English',
                    disabled: submitting,
                    accessibilityLabel: 'English report language',
                  },
                  {
                    value: 'es',
                    label: 'Español',
                    disabled: submitting,
                    accessibilityLabel: 'Spanish report language',
                  },
                ]}
              />
            </View>
            {errorText ? <HelperText type="error">{errorText}</HelperText> : null}
            <Button
              mode="contained"
              onPress={() => void handleConfirm()}
              disabled={submitting || !displayName.trim()}
              loading={submitting}
            >
              Continue
            </Button>
            <Button mode="text" onPress={() => void handleSignOut()} disabled={submitting}>
              Sign out
            </Button>
          </View>
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
    gap: 20,
    padding: 24,
    width: '100%',
    maxWidth: 520,
  },
  header: {
    alignItems: 'flex-start',
    gap: 8,
  },
  headerTop: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
  },
  backButton: {
    marginLeft: -8,
  },
  stepText: {
    color: palette.mutedText,
  },
  title: {
    color: palette.text,
  },
  subtitle: {
    color: palette.mutedText,
  },
  profileCard: {
    alignItems: 'center',
    backgroundColor: palette.surface,
    borderColor: palette.border,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 16,
    flexDirection: 'row',
    gap: 12,
    padding: 14,
  },
  initialsBadge: {
    alignItems: 'center',
    backgroundColor: palette.primaryContainer,
    borderRadius: 22,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  initialsText: {
    color: palette.primary,
    fontWeight: '700',
  },
  profileCardDetails: {
    flex: 1,
    gap: 2,
  },
  profileName: {
    color: palette.text,
  },
  profileRole: {
    color: palette.mutedText,
  },
  form: {
    gap: 14,
  },
  languageSection: {
    gap: 8,
    marginTop: 2,
  },
  languageLabel: {
    color: palette.text,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
});
