// Hidden developer screen for the voice pipeline (task C1 step 3):
// record → upload evidence → process-incident-turn → show transcript / applied / suggested / timing.
// TODO(A1b): swap the numeric spacing below for src/theme/tokens.ts once it exists. Colours come from the Paper theme.
import { randomUUID } from 'expo-crypto';
import { useCallback, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Button, Card, Divider, HelperText, Text, TextInput, TouchableRipple, useTheme } from 'react-native-paper';

import { createDraft, processTurn, type ProcessTurnResponse, type TurnProposal } from '../../lib/api';
import { EvidenceUploadError, uploadEvidence } from '../../lib/evidence';
import { useRecorder } from './useRecorder';

const QUESTION_KEY = 'what_happened';
/** Bump on every change you need to see on the phone; if the screen shows an older value, the bundle is stale. */
const DEV_BUILD = 'voice-dev #5 · file-system read + recorder checks';

type PendingTurn =
  | { kind: 'audio'; clientTurnId: string; uri: string; evidenceId?: string; uploaded: boolean }
  | { kind: 'text'; clientTurnId: string; text: string };

type TurnOutcome = { response: ProcessTurnResponse; totalMs: number; uploadMs: number };
type TurnFailure = { message: string; code: string; retryable: boolean };

const formatClock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
const formatValue = (v: TurnProposal['value']) => (Array.isArray(v) ? v.join(', ') : v);

export function VoiceDevScreen() {
  const theme = useTheme();
  const [revisionId, setRevisionId] = useState<string | null>(null);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [creatingDraft, setCreatingDraft] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<TurnOutcome | null>(null);
  const [failure, setFailure] = useState<TurnFailure | null>(null);
  const pendingRef = useRef<PendingTurn | null>(null);

  const runTurn = useCallback(
    async (pending: PendingTurn, startedAt: number, finish?: () => void) => {
      if (!revisionId) return;
      pendingRef.current = pending;
      setBusy(true);
      setFailure(null);
      setOutcome(null);
      let uploadMs = 0;
      try {
        let audioEvidenceId: string | undefined;
        if (pending.kind === 'audio') {
          if (!pending.uploaded) {
            const uploadStart = Date.now();
            try {
              const uploaded = await uploadEvidence({
                revisionId,
                uri: pending.uri,
                mediaType: 'audio',
                questionKey: QUESTION_KEY,
                evidenceId: pending.evidenceId,
              });
              pending.evidenceId = uploaded.evidenceId;
              pending.uploaded = true;
            } catch (error) {
              if (error instanceof EvidenceUploadError) {
                pending.evidenceId = error.evidenceId ?? pending.evidenceId;
                setFailure({ message: error.message, code: error.code, retryable: error.retryable });
                return;
              }
              throw error;
            }
            uploadMs = Date.now() - uploadStart;
          }
          audioEvidenceId = pending.evidenceId;
        }

        const result = await processTurn(
          pending.kind === 'audio'
            ? { incident_revision_id: revisionId, client_turn_id: pending.clientTurnId, question_key: QUESTION_KEY, audio_evidence_id: audioEvidenceId ?? '' }
            : { incident_revision_id: revisionId, client_turn_id: pending.clientTurnId, question_key: QUESTION_KEY, text: pending.text },
        );
        if (result.ok) {
          pendingRef.current = null;
          setOutcome({ response: result.data, totalMs: Date.now() - startedAt, uploadMs });
        } else {
          setFailure({ message: result.message, code: result.code, retryable: result.retryable });
        }
      } catch {
        setFailure({ message: 'Something went wrong. Try again.', code: 'UNKNOWN', retryable: true });
      } finally {
        setBusy(false);
        finish?.();
      }
    },
    [revisionId],
  );

  const recorder = useRecorder({
    onFinished: ({ uri }) => {
      const stoppedAt = Date.now();
      void runTurn({ kind: 'audio', clientTurnId: randomUUID(), uri, uploaded: false }, stoppedAt, () => recorder.reset());
    },
  });

  const onNewDraft = async () => {
    setCreatingDraft(true);
    setDraftError(null);
    const result = await createDraft();
    setCreatingDraft(false);
    if (result.ok) {
      setRevisionId(result.data.revisionId);
      setOutcome(null);
      setFailure(null);
      pendingRef.current = null;
    } else {
      setDraftError(result.message);
    }
  };

  const onMicPress = () => {
    if (recorder.state === 'recording') void recorder.stop();
    else void recorder.start();
  };

  const onSendText = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    void runTurn({ kind: 'text', clientTurnId: randomUUID(), text: trimmed }, Date.now());
  };

  const onRetry = () => {
    // Same client_turn_id (and same evidence id for audio), so the server never double-applies.
    if (pendingRef.current) void runTurn(pendingRef.current, Date.now());
  };

  const recording = recorder.state === 'recording';
  const micDisabled = !revisionId || busy || recorder.state === 'processing';
  const micColor = recording ? theme.colors.error : theme.colors.primary;
  const micLabel = recording
    ? `Stop · ${formatClock(recorder.seconds)}`
    : busy || recorder.state === 'processing'
      ? 'Processing…'
      : 'Tap to talk';

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text variant="headlineSmall">Voice pipeline (dev)</Text>
      <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>
        {DEV_BUILD}
      </Text>

      <Button mode="outlined" onPress={onNewDraft} loading={creatingDraft} disabled={creatingDraft || recording} contentStyle={styles.buttonContent}>
        New draft
      </Button>
      <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }} selectable>
        {revisionId ? `Revision ${revisionId}` : 'Create a draft first.'}
      </Text>
      {draftError ? <HelperText type="error">{draftError}</HelperText> : null}

      <View style={styles.micArea}>
        <TouchableRipple
          onPress={onMicPress}
          disabled={micDisabled}
          borderless
          accessibilityRole="button"
          accessibilityLabel={recording ? 'Stop recording' : 'Start recording'}
          style={[styles.mic, { backgroundColor: micColor, opacity: micDisabled ? 0.4 : 1 }]}
        >
          <Text variant="titleMedium" style={{ color: theme.colors.onPrimary }}>
            {micLabel}
          </Text>
        </TouchableRipple>

        <View style={styles.wave} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          {Array.from({ length: 40 }, (_, i) => {
            const level = recorder.levels[i - (40 - recorder.levels.length)] ?? 0;
            return <View key={i} style={[styles.bar, { height: 4 + level * 44, backgroundColor: recording ? micColor : theme.colors.outlineVariant }]} />;
          })}
        </View>

        <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }} selectable>
          {`native ${recorder.diagnostics.nativeRecording ? 'REC' : 'idle'} · ${recorder.diagnostics.durationMillis} ms · ` +
            `file ${recorder.diagnostics.fileSize} B · meter ${recorder.diagnostics.meteringDb?.toFixed(1) ?? '—'} dB · ` +
            `saved ${recorder.diagnostics.lastFileBytes ?? '—'} B`}
        </Text>

        {recording ? (
          <Button mode="text" onPress={() => void recorder.cancel()} contentStyle={styles.buttonContent}>
            Cancel
          </Button>
        ) : null}
        {recorder.state === 'denied' ? (
          <HelperText type="error">Microphone access is off. Allow it in Settings, or type your answer below.</HelperText>
        ) : null}
        {recorder.state === 'error' && recorder.error ? <HelperText type="error">{recorder.error}</HelperText> : null}
      </View>

      <TextInput mode="outlined" label="Or type what happened" value={text} onChangeText={setText} multiline numberOfLines={3} />
      <Button mode="contained" onPress={onSendText} disabled={!revisionId || busy || !text.trim()} loading={busy && !recording} contentStyle={styles.buttonContent}>
        Send
      </Button>

      {failure ? (
        <Card mode="outlined">
          <Card.Content style={styles.cardContent}>
            <Text variant="titleSmall" style={{ color: theme.colors.error }}>
              {failure.code}
            </Text>
            <Text variant="bodyMedium">{failure.message}</Text>
            {pendingRef.current?.kind === 'audio' ? (
              <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }} selectable>
                uri: {pendingRef.current.uri}
              </Text>
            ) : null}
          </Card.Content>
          {pendingRef.current ? (
            <Card.Actions>
              <Button onPress={onRetry} disabled={busy} contentStyle={styles.buttonContent}>
                Retry
              </Button>
            </Card.Actions>
          ) : null}
        </Card>
      ) : null}

      {outcome ? <Result outcome={outcome} /> : null}
    </ScrollView>
  );
}

function Result({ outcome }: { outcome: TurnOutcome }) {
  const theme = useTheme();
  const { response, totalMs, uploadMs } = outcome;
  const muted = { color: theme.colors.onSurfaceVariant };
  return (
    <Card mode="outlined">
      <Card.Content style={styles.cardContent}>
        <Text variant="labelLarge">
          {response.mode.toUpperCase()} · total {totalMs} ms
        </Text>
        <Text variant="bodySmall" style={muted}>
          upload {uploadMs} ms · stt {response.latency_ms.stt} ms · llm {response.latency_ms.llm} ms
        </Text>
        <Divider />
        <Text variant="titleSmall">Transcript</Text>
        <Text variant="bodyMedium" selectable>
          {response.transcript || '(empty)'}
        </Text>
        <Divider />
        <Text variant="titleSmall">Applied ({response.applied.length})</Text>
        {response.applied.map((p) => (
          <Text key={p.key} variant="bodyMedium">
            {p.key}: {formatValue(p.value)}
            <Text variant="bodySmall" style={muted}>{`  ${p.confidence.toFixed(2)} · “${p.evidence_quote.slice(0, 60)}”`}</Text>
          </Text>
        ))}
        <Text variant="titleSmall">Suggested ({response.suggested.length})</Text>
        {response.suggested.length === 0 ? (
          <Text variant="bodySmall" style={muted}>
            none
          </Text>
        ) : (
          response.suggested.map((p) => (
            <Text key={p.key} variant="bodyMedium">
              {p.key}: {formatValue(p.value)} ({p.confidence.toFixed(2)})
            </Text>
          ))
        )}
        {response.kept_existing.length > 0 ? (
          <Text variant="bodySmall" style={muted}>
            Kept driver answers: {response.kept_existing.join(', ')}
          </Text>
        ) : null}
        <Text variant="bodySmall" style={muted} selectable>
          turn {response.turn_id}
        </Text>
      </Card.Content>
    </Card>
  );
}

const styles = StyleSheet.create({
  content: { gap: 12, padding: 20, paddingBottom: 48 },
  buttonContent: { minHeight: 48 },
  micArea: { alignItems: 'center', gap: 12, paddingVertical: 8 },
  mic: { width: 140, height: 140, borderRadius: 70, alignItems: 'center', justifyContent: 'center' },
  wave: { flexDirection: 'row', alignItems: 'center', height: 52, gap: 2 },
  bar: { width: 4, borderRadius: 2 },
  cardContent: { gap: 6 },
});
