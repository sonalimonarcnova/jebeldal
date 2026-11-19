import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Button, Card, HelperText, Text, TextInput } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '../../src/auth/AuthProvider';
import {
  clearCachedDraftText,
  readCachedDraftText,
  writeCachedDraftText,
} from '../../src/features/incidents/draftCache';
import {
  loadIncidentDraft,
  saveIncidentTextAnswer,
  type IncidentDraft,
} from '../../src/features/incidents/repository';

export default function IncidentDraftRoute() {
  const { revisionId: revisionIdParam } = useLocalSearchParams<{ revisionId: string }>();
  const revisionId = Array.isArray(revisionIdParam) ? revisionIdParam[0] : revisionIdParam;
  const { session } = useAuth();
  const [draft, setDraft] = useState<IncidentDraft | null>(null);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [localMessage, setLocalMessage] = useState<string | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  const loadDraft = useCallback(async () => {
    if (!revisionId || !session?.user.id) {
      setErrorText('A signed-in driver and incident revision are required.');
      setLoading(false);
      return;
    }

    setLoading(true);
    setErrorText(null);
    setLocalMessage(null);
    try {
      const [remoteDraft, cachedDraft] = await Promise.all([
        loadIncidentDraft(revisionId),
        readCachedDraftText(session.user.id, revisionId, 'what_happened'),
      ]);
      setDraft(remoteDraft);

      if (cachedDraft && cachedDraft.expectedVersion === remoteDraft.version) {
        setText(cachedDraft.text);
        setDirty(cachedDraft.text !== remoteDraft.narrative);
        if (cachedDraft.text !== remoteDraft.narrative) {
          setLocalMessage('Unsaved text was restored from this device. Save it to sync with the report.');
        }
      } else {
        setText(remoteDraft.narrative);
        setDirty(false);
        if (cachedDraft) {
          setLocalMessage(
            'Local text was not restored because the server revision changed. Review the server copy before editing.',
          );
        }
      }
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Could not load incident draft.');
    } finally {
      setLoading(false);
    }
  }, [revisionId, session?.user.id]);

  useEffect(() => {
    void loadDraft();
  }, [loadDraft]);

  useEffect(() => {
    if (!dirty || !draft || !revisionId || !session?.user.id) {
      return;
    }

    const timeout = setTimeout(() => {
      void writeCachedDraftText(
        session.user.id,
        revisionId,
        draft.fieldKey,
        text,
        draft.version,
      )
        .then(() => setLocalMessage('Unsaved text is stored on this device.'))
        .catch((error: unknown) => {
          setErrorText(
            error instanceof Error ? `Could not save local draft text: ${error.message}` : 'Could not save local draft text.',
          );
        });
    }, 350);

    return () => clearTimeout(timeout);
  }, [dirty, draft, revisionId, session?.user.id, text]);

  const save = async () => {
    if (!draft || !revisionId || !session?.user.id || !text.trim()) {
      return;
    }

    setSaving(true);
    setErrorText(null);
    setSaveMessage(null);
    try {
      const nextVersion = await saveIncidentTextAnswer(draft, draft.version, text.trim());
      setDraft({ ...draft, version: nextVersion, narrative: text.trim() });
      setDirty(false);
      setLocalMessage(null);
      setSaveMessage('Answer saved to this incident draft.');
      try {
        await clearCachedDraftText(session.user.id, revisionId, draft.fieldKey);
      } catch (error) {
        setErrorText(
          error instanceof Error
            ? `The server saved the answer, but local cache cleanup failed: ${error.message}`
            : 'The server saved the answer, but local cache cleanup failed.',
        );
      }
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Could not save incident answer.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.centered}>
        <ActivityIndicator accessibilityLabel="Loading incident draft" />
      </SafeAreaView>
    );
  }

  if (!draft) {
    return (
      <SafeAreaView style={styles.centered}>
        <Text variant="titleLarge">Incident draft unavailable</Text>
        {errorText ? <HelperText type="error">{errorText}</HelperText> : null}
        <Button onPress={() => void loadDraft()}>Retry</Button>
        <Button onPress={() => router.replace('/(driver)/incidents')}>Back to incidents</Button>
      </SafeAreaView>
    );
  }

  if (draft.status === 'submitted') {
    return (
      <SafeAreaView style={styles.centered}>
        <Text variant="titleLarge">This incident has been submitted.</Text>
        <Text variant="bodyMedium">Submitted reports are read-only.</Text>
        <Button onPress={() => router.replace('/(driver)/incidents')}>Back to incidents</Button>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <Button onPress={() => router.back()}>Back</Button>
          <Text variant="labelLarge">Draft · revision {draft.version}</Text>
        </View>
        <Card>
          <Card.Content style={styles.cardContent}>
            <Text variant="headlineSmall">{draft.fieldPrompt}</Text>
            <Text variant="bodyMedium" style={styles.secondary}>
              Tell us what happened. Your answer is saved to this incident only when you choose Save.
            </Text>
            <TextInput
              mode="outlined"
              label={draft.fieldPrompt}
              accessibilityLabel={draft.fieldPrompt}
              multiline
              value={text}
              onChangeText={(value) => {
                setText(value);
                setDirty(value.trim() !== draft.narrative);
                setSaveMessage(null);
              }}
              disabled={saving}
              style={styles.narrative}
            />
            {localMessage ? <HelperText type="info">{localMessage}</HelperText> : null}
            {saveMessage ? <HelperText type="info">{saveMessage}</HelperText> : null}
            {errorText ? <HelperText type="error">{errorText}</HelperText> : null}
            <Button
              mode="contained"
              onPress={() => void save()}
              disabled={saving || !dirty || !text.trim()}
              loading={saving}
            >
              Save answer
            </Button>
          </Card.Content>
        </Card>
        <Button onPress={() => router.replace('/(driver)/incidents')}>Back to incidents</Button>
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
  cardContent: {
    gap: 12,
  },
  narrative: {
    minHeight: 150,
  },
  secondary: {
    color: '#58606E',
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    padding: 24,
  },
});
