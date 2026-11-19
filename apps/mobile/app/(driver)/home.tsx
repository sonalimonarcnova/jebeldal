import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type GestureResponderEvent,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { ActivityIndicator, HelperText, Text } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '../../src/auth/AuthProvider';
import { createIncidentDraft } from '../../src/features/incidents/repository';
import {
  countUploadedCategories,
  setupDocumentCategories,
  walkaroundPhotoCategories,
  type DriverFile,
} from '../../src/features/files/model';
import { describeFileError, loadDriverFiles } from '../../src/features/files/repository';
import type { HomeTrip } from '../../src/features/home/model';
import { loadLatestHomeTrip } from '../../src/features/home/repository';
import { AppButton as Button } from '../../src/ui/AppButton';
import { palette } from '../../src/ui/theme';
import {
  isFaceIdReady,
} from '../../src/features/home/deviceAuth';

function formatHomeDate(value: Date): string {
  return value.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}

function formatTripTime(value: string | null): string {
  if (!value) return 'Departure time unavailable';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? 'Departure time unavailable'
    : `Depart ${date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
}

function initials(displayName: string | undefined): string {
  const parts = displayName?.trim().split(/\s+/).filter(Boolean) ?? [];
  return parts.slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'D';
}

function QuickAction({
  icon,
  title,
  subtitle,
  iconColor,
  iconBackground,
  onPress,
  disabled = false,
}: {
  icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
  title: string;
  subtitle: string;
  iconColor: string;
  iconBackground: string;
  onPress: (event: GestureResponderEvent) => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${subtitle}`}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.quickAction, pressed && !disabled ? styles.pressed : null]}
    >
      <View style={[styles.quickIcon, { backgroundColor: iconBackground }]}>
        <MaterialCommunityIcons name={icon} size={24} color={iconColor} accessible={false} />
      </View>
      <View style={styles.quickCopy}>
        <Text variant="titleMedium" style={styles.primaryText}>{title}</Text>
        <Text variant="bodyMedium" style={styles.secondaryText}>{subtitle}</Text>
      </View>
      <MaterialCommunityIcons
        name="chevron-right"
        size={22}
        color={palette.mutedText}
        accessible={false}
      />
    </Pressable>
  );
}

export default function HomeRoute() {
  const { session, profile } = useAuth();
  const [trip, setTrip] = useState<HomeTrip | null>(null);
  const [loadingTrip, setLoadingTrip] = useState(true);
  const [tripError, setTripError] = useState<string | null>(null);
  const [files, setFiles] = useState<DriverFile[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(true);
  const [filesError, setFilesError] = useState<string | null>(null);
  const [faceIdReady, setFaceIdReady] = useState(false);
  const [setupError, setSetupError] = useState<string | null>(null);
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

  const refreshFiles = useCallback(async () => {
    setLoadingFiles(true);
    setFilesError(null);
    try {
      setFiles(await loadDriverFiles());
    } catch (error) {
      setFilesError(describeFileError(error, 'Could not load setup progress.'));
    } finally {
      setLoadingFiles(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refreshTrip();
      void refreshFiles();

      const userId = session?.user.id;
      if (userId) {
        void isFaceIdReady(userId)
          .then((value) => setFaceIdReady(value))
          .catch((error: unknown) => {
            setSetupError(describeFileError(error, 'Could not load device setup status.'));
          });
      }
    }, [refreshFiles, refreshTrip, session?.user.id]),
  );

  const startIncident = async () => {
    setCreating(true);
    setCreateError(null);
    try {
      const revisionId = await createIncidentDraft();
      router.push({
        pathname: '/incident/[revisionId]',
        params: { revisionId, returnTo: 'home' },
      });
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : 'Could not create an incident draft.');
    } finally {
      setCreating(false);
    }
  };

  const documentsAdded = countUploadedCategories(files, setupDocumentCategories);
  const photosAdded = countUploadedCategories(files, walkaroundPhotoCategories);
  const remainingSetupItems = Number(!faceIdReady) + Number(documentsAdded < setupDocumentCategories.length)
    + Number(photosAdded < walkaroundPhotoCategories.length);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.page}>
          <View style={styles.header}>
            <View style={styles.headerCopy}>
              <Text variant="bodyMedium" style={styles.secondaryText}>{formatHomeDate(new Date())}</Text>
              <Text variant="headlineLarge" style={styles.primaryText}>
                Hi, {profile?.displayName ?? 'Driver'}
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Open profile"
              onPress={() =>
                router.push({
                  pathname: '/(auth)/profile',
                  params: { returnTo: 'driver-profile' },
                })
              }
              style={({ pressed }) => [styles.profileAvatar, pressed ? styles.pressed : null]}
            >
              <Text variant="titleMedium" style={styles.avatarText}>
                {initials(profile?.displayName)}
              </Text>
            </Pressable>
          </View>

          <View style={styles.body}>
            <View style={styles.card}>
              <Text variant="titleMedium" style={styles.primaryText}>Finish setting up</Text>
              <Text variant="bodyMedium" style={styles.secondaryText}>
                {loadingFiles
                  ? 'Checking your setup progress.'
                  : filesError
                    ? 'Setup progress is unavailable.'
                    : remainingSetupItems === 0
                      ? 'You’re ready to file reports.'
                      : `${remainingSetupItems} left so your reports are ready to file.`}
              </Text>
              <View style={styles.setupChips}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={faceIdReady ? 'Face ID set up on this device' : 'Set up Face ID'}
                  onPress={() => router.push('/(driver)/face')}
                  style={({ pressed }) => [styles.setupChip, pressed ? styles.pressed : null]}
                >
                  <MaterialCommunityIcons
                    name={faceIdReady ? 'check-circle-outline' : 'face-recognition'}
                    size={20}
                    color={faceIdReady ? palette.success : palette.text}
                    accessible={false}
                  />
                  <Text variant="bodyMedium" style={styles.primaryText}>Face ID</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Open documents, ${documentsAdded} of ${setupDocumentCategories.length} added`}
                  onPress={() => router.navigate('/(driver)/files')}
                  style={({ pressed }) => [styles.setupChip, pressed ? styles.pressed : null]}
                >
                  <MaterialCommunityIcons
                    name="file-document-outline"
                    size={20}
                    color={palette.text}
                    accessible={false}
                  />
                  <Text variant="bodyMedium" style={styles.primaryText}>
                    Documents {documentsAdded}/{setupDocumentCategories.length}
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Open truck photos, ${photosAdded} of ${walkaroundPhotoCategories.length} added`}
                  onPress={() =>
                    router.push({
                      pathname: '/(driver)/files',
                      params: { tab: 'photos' },
                    })
                  }
                  style={({ pressed }) => [styles.setupChip, pressed ? styles.pressed : null]}
                >
                  <MaterialCommunityIcons
                    name="camera-outline"
                    size={20}
                    color={palette.text}
                    accessible={false}
                  />
                  <Text variant="bodyMedium" style={styles.primaryText}>
                    Truck photos {photosAdded}/{walkaroundPhotoCategories.length}
                  </Text>
                </Pressable>
              </View>
              {filesError ? <HelperText type="error">{filesError}</HelperText> : null}
              {setupError ? <HelperText type="error">{setupError}</HelperText> : null}
            </View>

            <View style={[styles.card, styles.scoreCard]}>
              <View style={styles.scoreRing}>
                <Text variant="headlineSmall" style={styles.scoreText}>92</Text>
              </View>
              <View style={styles.scoreCopy}>
                <Text variant="bodyMedium" style={styles.secondaryText}>Driving score</Text>
                <Text variant="titleLarge" style={styles.primaryText}>Sample score</Text>
                <Text variant="bodyMedium" style={styles.scoreNote}>
                  Demo only · no live fleet ranking
                </Text>
              </View>
            </View>

            <View style={styles.card}>
              <Text variant="bodyMedium" style={styles.secondaryText}>Today</Text>
              {loadingTrip ? (
                <ActivityIndicator accessibilityLabel="Loading trip information" />
              ) : tripError ? (
                <>
                  <HelperText type="error">{tripError}</HelperText>
                  <Button onPress={() => void refreshTrip()}>Retry trip data</Button>
                </>
              ) : (
                <>
                  <View style={styles.todayRow}>
                    <View style={[styles.todayIcon, styles.routeIcon]}>
                      <MaterialCommunityIcons
                        name="routes"
                        size={24}
                        color={palette.primary}
                        accessible={false}
                      />
                    </View>
                    <View style={styles.todayCopy}>
                      <Text variant="titleMedium" style={styles.primaryText}>
                        {trip?.origin && trip.destination
                          ? `${trip.origin} → ${trip.destination}`
                          : 'No trip information available'}
                      </Text>
                      <Text variant="bodyMedium" style={styles.secondaryText}>
                        {trip
                          ? `${profile?.vehicle?.unitNumber ?? 'No unit assigned'} · ${formatTripTime(trip.startedAt)}`
                          : 'Trip details will appear here when available.'}
                      </Text>
                    </View>
                  </View>
                  <View style={styles.todayRow}>
                    <View style={[styles.todayIcon, styles.inspectionIcon]}>
                      <MaterialCommunityIcons
                        name="calendar-clock"
                        size={24}
                        color={palette.warning}
                        accessible={false}
                      />
                    </View>
                    <View style={styles.todayCopy}>
                      <Text variant="titleMedium" style={styles.primaryText}>Pre-trip inspection</Text>
                      <Text variant="bodyMedium" style={styles.secondaryText}>
                        {trip?.preTripStatus ?? 'Inspection status unavailable'}
                      </Text>
                    </View>
                  </View>
                </>
              )}
            </View>

            <View style={styles.quickSection}>
              <Text variant="bodyMedium" style={styles.secondaryText}>Quick actions</Text>
              <View style={styles.quickCard}>
                <QuickAction
                  icon="plus"
                  title="File an incident report"
                  subtitle="Talk it through, about 3 min"
                  iconColor={palette.error}
                  iconBackground="#FFF1F2"
                  onPress={() => void startIncident()}
                  disabled={creating}
                />
                <View style={styles.divider} />
                <QuickAction
                  icon="file-upload-outline"
                  title="Add a document"
                  subtitle="License, medical card, vehicle registration"
                  iconColor={palette.primary}
                  iconBackground="#EFF8FF"
                  onPress={() => router.navigate('/(driver)/files')}
                />
                <View style={styles.divider} />
                <QuickAction
                  icon="camera-outline"
                  title="Take truck photos"
                  subtitle={`Walk-around for ${profile?.vehicle?.unitNumber
                    ? `unit ${profile.vehicle.unitNumber}`
                    : 'your assigned unit'}`}
                  iconColor="#7C3AED"
                  iconBackground="#F5F0FF"
                  onPress={() =>
                    router.push({
                      pathname: '/(driver)/files',
                      params: { tab: 'photos' },
                    })
                  }
                />
              </View>
              {creating ? <ActivityIndicator accessibilityLabel="Creating incident report" /> : null}
              {createError ? <HelperText type="error">{createError}</HelperText> : null}
            </View>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: palette.surface,
  },
  scroll: {
    backgroundColor: palette.surfaceVariant,
  },
  scrollContent: {
    paddingBottom: 24,
  },
  page: {
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
  },
  header: {
    alignItems: 'center',
    backgroundColor: palette.surface,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingVertical: 16,
  },
  headerCopy: {
    flex: 1,
    gap: 2,
  },
  primaryText: {
    color: palette.text,
  },
  secondaryText: {
    color: palette.mutedText,
  },
  profileAvatar: {
    alignItems: 'center',
    backgroundColor: '#0A8EFF',
    borderRadius: 30,
    height: 60,
    justifyContent: 'center',
    marginLeft: 16,
    width: 60,
  },
  avatarText: {
    color: palette.surface,
  },
  body: {
    gap: 16,
    padding: 20,
  },
  card: {
    backgroundColor: palette.surface,
    borderRadius: 20,
    gap: 8,
    padding: 20,
  },
  setupChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 6,
  },
  setupChip: {
    alignItems: 'center',
    backgroundColor: palette.surfaceVariant,
    borderRadius: 24,
    flexDirection: 'row',
    gap: 6,
    minHeight: 40,
    paddingHorizontal: 12,
  },
  scoreCard: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 16,
  },
  scoreRing: {
    alignItems: 'center',
    borderColor: '#32C75A',
    borderRadius: 44,
    borderWidth: 6,
    height: 88,
    justifyContent: 'center',
    width: 88,
  },
  scoreText: {
    color: palette.text,
    fontWeight: '700',
  },
  scoreCopy: {
    flex: 1,
    gap: 2,
  },
  scoreNote: {
    color: palette.success,
  },
  todayRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    marginTop: 4,
  },
  todayIcon: {
    alignItems: 'center',
    borderRadius: 13,
    height: 52,
    justifyContent: 'center',
    width: 52,
  },
  routeIcon: {
    backgroundColor: '#EFF8FF',
  },
  inspectionIcon: {
    backgroundColor: '#FFFBEB',
  },
  todayCopy: {
    flex: 1,
    gap: 2,
  },
  quickSection: {
    gap: 8,
  },
  quickCard: {
    backgroundColor: palette.surface,
    borderRadius: 20,
    overflow: 'hidden',
  },
  quickAction: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    minHeight: 76,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  quickIcon: {
    alignItems: 'center',
    borderRadius: 14,
    height: 52,
    justifyContent: 'center',
    width: 52,
  },
  quickCopy: {
    flex: 1,
    gap: 2,
  },
  divider: {
    backgroundColor: palette.border,
    height: StyleSheet.hairlineWidth,
    marginLeft: 16,
  },
  pressed: {
    opacity: 0.75,
  },
});
