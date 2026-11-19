import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { HelperText, Text } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '../../src/auth/AuthProvider';
import { AppButton as Button } from '../../src/ui/AppButton';
import { palette } from '../../src/ui/theme';

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
        <View style={styles.header}>
          <Text variant="headlineMedium" style={styles.title}>Your profile</Text>
          <Text variant="bodyMedium" style={styles.subtitle}>
            Keep your driver details current before filing incidents.
          </Text>
        </View>
        {profile ? (
          <View style={styles.panel}>
            <View style={styles.profileCard}>
              <View style={styles.initialsBadge}>
                <Text variant="titleLarge" style={styles.initialsText}>
                  {profile.displayName
                    .split(/\s+/)
                    .filter(Boolean)
                    .slice(0, 2)
                    .map((part) => part[0]?.toUpperCase())
                    .join('') || 'DR'}
                </Text>
              </View>
              <View style={styles.profileCardDetails}>
                <Text variant="titleMedium" style={styles.name}>{profile.displayName}</Text>
                <Text variant="bodySmall" style={styles.secondary}>Driver</Text>
              </View>
            </View>

            <View style={styles.details}>
              <View style={styles.detailRow}>
                <Text variant="labelMedium" style={styles.label}>Full name</Text>
                <Text variant="bodyLarge" style={styles.value}>{profile.displayName || 'Not provided'}</Text>
              </View>
              <View style={styles.detailRow}>
                <Text variant="labelMedium" style={styles.label}>Mobile</Text>
                <Text variant="bodyLarge" style={styles.value}>{profile.phone || 'Not provided'}</Text>
              </View>
              <View style={styles.detailRow}>
                <Text variant="labelMedium" style={styles.label}>Employee ID</Text>
                <Text variant="bodyLarge" style={styles.value}>{profile.employeeId || 'Not provided'}</Text>
              </View>
              <View style={styles.detailRow}>
                <Text variant="labelMedium" style={styles.label}>Home terminal</Text>
                <Text variant="bodyLarge" style={styles.value}>{profile.organizationName || 'Not provided'}</Text>
              </View>
              <View style={styles.detailRow}>
                <Text variant="labelMedium" style={styles.label}>Assigned unit</Text>
                <Text variant="bodyLarge" style={styles.value}>
                  {profile.vehicle
                    ? `${profile.vehicle.unitNumber} · ${profile.vehicle.makeModel ?? 'Vehicle'}`
                    : 'No unit assigned'}
                </Text>
              </View>
              <View style={styles.detailRow}>
                <Text variant="labelMedium" style={styles.label}>Report language</Text>
                <View style={styles.languageRow}>
                  <View
                    style={[
                      styles.languageChip,
                      profile.preferredLanguage === 'en' && styles.languageChipActive,
                    ]}
                  >
                    <Text
                      variant="labelMedium"
                      style={[
                        styles.languageChipLabel,
                        profile.preferredLanguage === 'en' && styles.languageChipLabelActive,
                      ]}
                    >
                      English
                    </Text>
                  </View>
                  <View
                    style={[
                      styles.languageChip,
                      profile.preferredLanguage === 'es' && styles.languageChipActive,
                    ]}
                  >
                    <Text
                      variant="labelMedium"
                      style={[
                        styles.languageChipLabel,
                        profile.preferredLanguage === 'es' && styles.languageChipLabelActive,
                      ]}
                    >
                      Español
                    </Text>
                  </View>
                </View>
              </View>
            </View>

            <Button
              icon="account-edit-outline"
              mode="contained"
              accessibilityLabel="Review profile details"
              onPress={() =>
                router.push({
                  pathname: '/(auth)/profile',
                  params: { returnTo: 'driver-profile' },
                })
              }
            >
              Edit profile details
            </Button>
          </View>
        ) : (
          <HelperText type="error">Driver profile is unavailable.</HelperText>
        )}
        {errorText ? <HelperText type="error">{errorText}</HelperText> : null}
        <Button
          mode="outlined"
          icon="logout"
          accessibilityLabel="Sign out"
          onPress={() => void handleSignOut()}
          loading={signingOut}
        >
          Sign out
        </Button>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: palette.background,
  },
  content: {
    gap: 20,
    padding: 24,
    width: '100%',
    maxWidth: 520,
    alignSelf: 'center',
  },
  header: {
    gap: 8,
  },
  title: {
    color: palette.text,
  },
  subtitle: {
    color: palette.mutedText,
  },
  panel: {
    backgroundColor: palette.surface,
    borderColor: palette.border,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 16,
    padding: 14,
  },
  profileCard: {
    alignItems: 'center',
    backgroundColor: palette.surfaceVariant,
    borderRadius: 12,
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
  name: {
    color: palette.text,
  },
  secondary: {
    color: palette.mutedText,
  },
  details: {
    borderColor: palette.border,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  detailRow: {
    borderBottomColor: palette.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  label: {
    color: palette.mutedText,
  },
  value: {
    color: palette.text,
  },
  languageRow: {
    flexDirection: 'row',
    gap: 8,
  },
  languageChip: {
    backgroundColor: palette.surfaceVariant,
    borderColor: palette.border,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  languageChipActive: {
    backgroundColor: palette.primaryContainer,
    borderColor: palette.primary,
  },
  languageChipLabel: {
    color: palette.mutedText,
  },
  languageChipLabelActive: {
    color: palette.onPrimaryContainer,
  },
});
