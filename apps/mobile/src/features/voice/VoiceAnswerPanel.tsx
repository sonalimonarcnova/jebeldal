// Mic control for the current interview question (ST-13, ST-15): idle "Tap to answer" → recording (red, timer,
// live waveform) → processing (spinner). Recording lives here; upload/turn/save is the screen's job (onRecorded).
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Card, HelperText, Text, useTheme } from 'react-native-paper';

import { useRecorder } from './useRecorder';

export type VoicePanelFailure = { message: string; retryable: boolean };

type Props = {
  disabled: boolean;
  /** true while the screen uploads / processes / saves the recording */
  busy: boolean;
  /** what the driver said, shown as the answer line once the turn completes */
  transcript: string | null;
  failure: VoicePanelFailure | null;
  onRecorded: (uri: string) => void;
  onRetry: () => void;
  onTypeInstead: () => void;
  /** e.g. stop text-to-speech so the phone does not record its own voice */
  onBeforeRecord?: () => void;
};

const BAR_COUNT = 40;
const formatClock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

export function VoiceAnswerPanel({ disabled, busy, transcript, failure, onRecorded, onRetry, onTypeInstead, onBeforeRecord }: Props) {
  const theme = useTheme();
  const recorder = useRecorder({ onFinished: ({ uri }) => onRecorded(uri) });
  const recording = recorder.state === 'recording';
  const processing = busy || recorder.state === 'processing';

  // The recorder stays in 'processing' until the screen is done with the clip.
  useEffect(() => {
    if (recorder.state === 'processing' && !busy) recorder.reset();
  }, [busy, recorder]);

  const onPress = () => {
    if (recording) {
      void recorder.stop();
      return;
    }
    onBeforeRecord?.();
    void recorder.start();
  };

  const label = recording ? `Stop · ${formatClock(recorder.seconds)}` : processing ? 'Working on your answer…' : 'Tap to answer';
  const barColor = recording ? theme.colors.error : theme.colors.outlineVariant;

  return (
    <View style={styles.panel}>
      <Button
        mode="contained"
        icon={recording ? 'stop' : 'microphone'}
        onPress={onPress}
        loading={processing && !recording}
        disabled={disabled || (processing && !recording)}
        buttonColor={recording ? theme.colors.error : undefined}
        contentStyle={styles.micContent}
        style={styles.mic}
        accessibilityLabel={recording ? 'Stop recording your answer' : 'Record your answer'}
        accessibilityHint={recording ? undefined : 'Speak your answer; we fill in what you mention'}
      >
        {label}
      </Button>

      {recording || recorder.levels.length > 0 ? (
        <View style={styles.wave} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          {Array.from({ length: BAR_COUNT }, (_, i) => {
            const level = recorder.levels[i - (BAR_COUNT - recorder.levels.length)] ?? 0;
            return <View key={i} style={[styles.bar, { height: 4 + level * 40, backgroundColor: barColor }]} />;
          })}
        </View>
      ) : null}

      {recording ? (
        <Button mode="text" onPress={() => void recorder.cancel()} contentStyle={styles.secondaryContent}>
          Cancel
        </Button>
      ) : null}

      {recorder.state === 'denied' ? (
        <Card mode="outlined">
          <Card.Content style={styles.cardContent}>
            <Text variant="titleSmall">Microphone is off for JebelDAL</Text>
            <Text variant="bodyMedium">
              To answer by voice, allow the microphone in your phone’s Settings. You can type your answer instead.
            </Text>
          </Card.Content>
          <Card.Actions>
            <Button onPress={onTypeInstead} contentStyle={styles.secondaryContent}>
              Type instead
            </Button>
          </Card.Actions>
        </Card>
      ) : null}
      {recorder.state === 'error' && recorder.error ? <HelperText type="error" visible>{recorder.error}</HelperText> : null}

      {failure ? (
        <Card mode="outlined">
          <Card.Content style={styles.cardContent}>
            <Text variant="titleSmall" style={{ color: theme.colors.error }}>
              We couldn’t use that answer
            </Text>
            <Text variant="bodyMedium">{failure.message}</Text>
            <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
              Nothing you already saved is lost.
            </Text>
          </Card.Content>
          <Card.Actions>
            {failure.retryable ? (
              <Button onPress={onRetry} disabled={busy} contentStyle={styles.secondaryContent}>
                Retry
              </Button>
            ) : null}
            <Button onPress={onTypeInstead} contentStyle={styles.secondaryContent}>
              Type instead
            </Button>
          </Card.Actions>
        </Card>
      ) : null}

      {transcript && !failure ? (
        <View style={styles.transcript}>
          <Text variant="labelMedium" style={{ color: theme.colors.onSurfaceVariant }}>
            You said
          </Text>
          <Text variant="bodyMedium" selectable>
            {transcript}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { gap: 12 },
  mic: { borderRadius: 16 },
  micContent: { height: 64 },
  secondaryContent: { minHeight: 48 },
  wave: { alignItems: 'center', alignSelf: 'center', flexDirection: 'row', gap: 2, height: 48 },
  bar: { borderRadius: 2, width: 4 },
  cardContent: { gap: 6 },
  transcript: { gap: 4 },
});
