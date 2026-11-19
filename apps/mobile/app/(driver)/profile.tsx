import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Avatar, Card, HelperText, Text } from 'react-native-paper';
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
        <Text variant="headlineMedium" style={styles.title}>Profile</Text>
        {profile ? (
          <Card style={styles.card}>
            <Card.Content style={styles.cardContent}>
              <View style={styles.profileHeading}>
                <Avatar.Icon
                  size={64}
                  icon="account-outline"
                  color={palette.primary}
                  accessible={false}
                  accessibilityElementsHidden
                  importantForAccessibility="no-hide-descendants"
                  style={styles.avatar}
                />
                <View style={styles.flex}>
                  <Text variant="titleLarge" style={styles.name}>{profile.displayName}</Text>
                  <Text variant="bodyMedium" style={styles.secondary}>{profile.organizationName}</Text>
                </View>
              </View>
              <View style={styles.details}>
                <View style={styles.detailRow}>
                  <Text variant="labelMedium" style={styles.secondary}>Employee ID</Text>
                  <Text variant="bodyLarge">{profile.employeeId || 'Not provided'}</Text>
                </View>
                <View style={styles.detailRow}>
                  <Text variant="labelMedium" style={styles.secondary}>Mobile</Text>
                  <Text variant="bodyLarge">{profile.phone || 'Not provided'}</Text>
                </View>
                <View style={styles.detailRow}>
                  <Text variant="labelMedium" style={styles.secondary}>Assigned unit</Text>
                  <Text variant="bodyLarge">{profile.vehicle?.unitNumber ?? 'Not assigned'}</Text>
                </View>
                <View style={styles.detailRow}>
                  <Text variant="labelMedium" style={styles.secondary}>Report language</Text>
                  <Text variant="bodyLarge">{profile.preferredLanguage.toUpperCase()}</Text>
                </View>
              </View>
              <Button
                icon="account-edit-outline"
                mode="outlined"
                accessibilityLabel="Review profile details"
                onPress={() =>
                  router.push({
                    pathname: '/(auth)/profile',
                    params: { returnTo: 'driver-profile' },
                  })
                }
              >
                Review profile details
              </Button>
            </Card.Content>
          </Card>
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
    gap: 16,
    padding: 20,
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
  },
  title: {
    color: palette.text,
  },
  card: {
    backgroundColor: palette.surface,
    borderColor: palette.border,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
  },
  cardContent: {
    gap: 20,
    padding: 20,
  },
  profileHeading: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 16,
  },
  avatar: {
    backgroundColor: palette.primaryContainer,
  },
  flex: {
    flex: 1,
  },
  name: {
    color: palette.text,
  },
  secondary: {
    color: palette.mutedText,
  },
  details: {
    backgroundColor: palette.surfaceVariant,
    borderRadius: 14,
    gap: 16,
    padding: 16,
  },
  detailRow: {
    gap: 4,
  },
});
