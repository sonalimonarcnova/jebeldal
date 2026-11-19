import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Card, Chip, HelperText, SegmentedButtons, Text } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';

import { createIncidentDraft, loadIncidentCards } from '../../src/features/incidents/repository';
import type { IncidentCard } from '../../src/features/incidents/model';
import { AppButton as Button } from '../../src/ui/AppButton';
import { palette } from '../../src/ui/theme';

type IncidentFilter = 'draft' | 'submitted';

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Date unavailable' : date.toLocaleDateString();
}

function formLabel(formKey: string): string {
  switch (formKey) {
    case 'auto':
      return 'Auto';
    case 'general_liability':
    case 'gl':
      return 'General Liability';
    case 'workers_comp':
    case 'wc':
      return "Workers' Comp";
    default:
      return formKey;
  }
}

function IncidentCardView({
  incident,
  onOpen,
}: {
  incident: IncidentCard;
  onOpen: (revisionId: string) => void;
}) {
  const activeRevisionId = incident.activeRevisionId;
  const content = (
    <Card.Content style={styles.cardContent}>
      <View style={styles.cardTop}>
        <Text variant="labelLarge">{formatDate(incident.updatedAt)}</Text>
        <Chip compact>
          {incident.status === 'submitted' ? 'Submitted' : 'Draft'}
        </Chip>
      </View>
      <Text variant="titleMedium">
        {incident.summary ?? (incident.status === 'draft' ? 'New incident report' : 'Incident report')}
      </Text>
      <Text variant="bodyMedium">{incident.location ?? 'Location not provided'}</Text>
      {incident.triggeredForms.length ? (
        <Text variant="bodySmall">{incident.triggeredForms.map(formLabel).join(' · ')}</Text>
      ) : null}
      {incident.reportReference ? (
        <Text variant="bodySmall">Reference {incident.reportReference}</Text>
      ) : null}
      {incident.status === 'submitted' ? (
        <Text variant="bodySmall" style={styles.secondary}>Awaiting review</Text>
      ) : null}
      {incident.status === 'draft' && incident.revisionVersion !== null ? (
        <Text variant="bodySmall" style={styles.secondary}>
          Saved revision {incident.revisionVersion}
        </Text>
      ) : null}
    </Card.Content>
  );

  return activeRevisionId ? (
    <Card
      style={styles.card}
      onPress={() => onOpen(activeRevisionId)}
      accessibilityLabel={incident.status === 'draft' ? 'Resume draft' : 'View submitted report'}
    >
      {content}
    </Card>
  ) : (
    <Card style={styles.card}>{content}</Card>
  );
}

export default function IncidentsRoute() {
  const [filter, setFilter] = useState<IncidentFilter>('draft');
  const [incidents, setIncidents] = useState<IncidentCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setIncidents(await loadIncidentCards());
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Could not load incidents.');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  const startIncident = async () => {
    setCreating(true);
    setCreateError(null);
    try {
      const revisionId = await createIncidentDraft();
      router.push({
        pathname: '/incident/[revisionId]',
        params: { revisionId, returnTo: 'incidents' },
      });
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : 'Could not create an incident draft.');
    } finally {
      setCreating(false);
    }
  };

  const filteredIncidents = incidents.filter((incident) => incident.status === filter);

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <View style={styles.flex}>
            <Text variant="headlineMedium">Incidents</Text>
            <Text variant="bodyMedium" style={styles.secondary}>
              Your drafts and submitted reports
            </Text>
          </View>
          <Button
            mode="contained"
            compact
            onPress={() => void startIncident()}
            disabled={creating}
            loading={creating}
            accessibilityLabel="Create incident draft"
          >
            New report
          </Button>
        </View>

        <SegmentedButtons
          value={filter}
          onValueChange={(value) => {
            if (value === 'draft' || value === 'submitted') {
              setFilter(value);
            }
          }}
          buttons={[
            { value: 'draft', label: `Drafts (${incidents.filter((item) => item.status === 'draft').length})` },
            {
              value: 'submitted',
              label: `Submitted (${incidents.filter((item) => item.status === 'submitted').length})`,
            },
          ]}
        />

        {createError ? <HelperText type="error">{createError}</HelperText> : null}
        {loading ? (
          <ActivityIndicator accessibilityLabel="Loading incidents" />
        ) : loadError ? (
          <Card style={styles.card}>
            <Card.Content style={styles.cardContent}>
              <Text variant="titleMedium">Incidents could not be loaded</Text>
              <HelperText type="error">{loadError}</HelperText>
              <Button onPress={() => void refresh()}>Retry</Button>
            </Card.Content>
          </Card>
        ) : filteredIncidents.length === 0 ? (
          <Card style={[styles.card, styles.emptyCard]}>
            <Card.Content style={styles.cardContent}>
              <Chip
                compact
                style={styles.emptyIcon}
              >
                {filter === 'draft' ? 'Draft workspace' : 'Report history'}
              </Chip>
              <Text variant="titleMedium">
                {filter === 'draft' ? 'No incident drafts yet' : 'No submitted incidents yet'}
              </Text>
              <Text variant="bodyMedium">
                {filter === 'draft'
                  ? 'Create a draft to start an incident report.'
                  : 'Submitted reports will appear here.'}
              </Text>
              {filter === 'draft' ? (
                <Button mode="contained" onPress={() => void startIncident()} disabled={creating}>
                  Create incident draft
                </Button>
              ) : null}
            </Card.Content>
          </Card>
        ) : (
          <View style={styles.list}>
            {filteredIncidents.map((incident) => (
              <IncidentCardView
                key={incident.id}
                incident={incident}
                onOpen={(revisionId) =>
                  router.push({
                    pathname: '/incident/[revisionId]',
                    params: { revisionId, returnTo: 'incidents' },
                  })
                }
              />
            ))}
          </View>
        )}
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
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
  },
  flex: {
    flex: 1,
  },
  list: {
    gap: 12,
  },
  cardContent: {
    gap: 8,
    padding: 18,
  },
  cardTop: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  secondary: {
    color: palette.mutedText,
  },
  card: {
    backgroundColor: palette.surface,
    borderColor: palette.border,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
  },
  emptyCard: {
    marginTop: 8,
  },
  emptyIcon: {
    alignSelf: 'flex-start',
    backgroundColor: palette.primaryContainer,
  },
});
