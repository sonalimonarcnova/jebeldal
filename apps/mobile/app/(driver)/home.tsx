import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Avatar, Button, Card, HelperText, Text } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '../../src/auth/AuthProvider';
import { createIncidentDraft } from '../../src/features/incidents/repository';
import { loadLatestHomeTrip } from '../../src/features/home/repository';
import type { HomeTrip } from '../../src/features/home/model';

function formatTripDate(value: string | null): string {
  if (!value) {
    return 'Time not provided';
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Time not provided' : date.toLocaleString();
}

export default function HomeRoute() {
  const { session, profile } = useAuth();
  const [trip, setTrip] = useState<HomeTrip | null>(null);
  const [loadingTrip, setLoadingTrip] = useState(true);
  const [tripError, setTripError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const refreshTrip = useCallback(async () => {
    const userId = session?.user.id;
    if (!userId) {
      setTrip(null);
      setLoadingTrip(false);
      return;
    }

    setLoadingTrip(true);
    setTripError(null);
    try {
      setTrip(await loadLatestHomeTrip(userId));
    } catch (error) {
      setTripError(error instanceof Error ? error.message : 'Could not load trip information.');
    } finally {
      setLoadingTrip(false);
    }
  }, [session?.user.id]);

  useFocusEffect(
    useCallback(() => {
      void refreshTrip();
    }, [refreshTrip]),
  );

  const startIncident = async () => {
    setCreating(true);
    setCreateError(null);
    try {
      const revisionId = await createIncidentDraft();
      router.push({ pathname: '/incident/[revisionId]', params: { revisionId } });
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : 'Could not create an incident draft.');
    } finally {
      setCreating(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <View>
            <Text variant="labelLarge">{new Date().toLocaleDateString()}</Text>
            <Text variant="headlineMedium">Hi, {profile?.displayName ?? 'Driver'}</Text>
          </View>
          <Button
            mode="outlined"
            compact
            accessibilityLabel="Open profile"
            onPress={() => router.push('/(driver)/profile')}
          >
            Profile
          </Button>
        </View>

        <Card>
          <Card.Content style={styles.score}>
            <Avatar.Text size={56} label="92" />
            <View style={styles.flex}>
              <Text variant="titleMedium">Driving score</Text>
              <Text variant="bodyMedium">Demo display data</Text>
              <Text variant="bodySmall" style={styles.secondary}>
                This score is sample data, not a live fleet signal.
              </Text>
            </View>
          </Card.Content>
        </Card>

        <Card>
          <Card.Content style={styles.section}>
            <Text variant="titleMedium">Today</Text>
            {loadingTrip ? (
              <ActivityIndicator accessibilityLabel="Loading trip information" />
            ) : tripError ? (
              <>
                <HelperText type="error">{tripError}</HelperText>
                <Button onPress={() => void refreshTrip()}>Retry trip data</Button>
              </>
            ) : trip ? (
              <>
                <Text variant="bodyLarge">
                  {trip.origin ?? 'Origin not provided'} {'->'} {trip.destination ?? 'Destination not provided'}
                </Text>
                <Text variant="bodyMedium">
                  {profile?.vehicle?.unitNumber ?? 'No unit assigned'} · {formatTripDate(trip.startedAt)}
                </Text>
                {trip.purpose ? <Text variant="bodySmall">{trip.purpose}</Text> : null}
                <Text variant="bodySmall" style={styles.secondary}>
                  Trip information is fictional demo data.
                </Text>
              </>
            ) : (
              <Text variant="bodyMedium">No trip information is available.</Text>
            )}
          </Card.Content>
        </Card>

        {trip?.preTripStatus ? (
          <Card>
            <Card.Content style={styles.section}>
              <Text variant="titleMedium">Pre-trip inspection</Text>
              <Text variant="bodyMedium">{trip.preTripStatus}</Text>
              <Text variant="bodySmall" style={styles.secondary}>
                Demo display data
              </Text>
            </Card.Content>
          </Card>
        ) : null}

        <View style={styles.section}>
          <Text variant="titleLarge">Quick actions</Text>
          <Button
            mode="contained"
            icon="plus"
            onPress={() => void startIncident()}
            disabled={creating}
            loading={creating}
            contentStyle={styles.actionButton}
          >
            File an incident report
          </Button>
          <Button
            mode="outlined"
            onPress={() => router.push('/(driver)/incidents')}
            contentStyle={styles.actionButton}
          >
            View incidents
          </Button>
          {createError ? <HelperText type="error">{createError}</HelperText> : null}
        </View>
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
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  score: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 16,
  },
  flex: {
    flex: 1,
  },
  section: {
    gap: 12,
  },
  secondary: {
    color: '#58606E',
  },
  actionButton: {
    minHeight: 48,
  },
});
