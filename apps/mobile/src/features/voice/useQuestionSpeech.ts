import * as Speech from 'expo-speech';
import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Reads each new interview question aloud once (ST-14), unless muted. `questionId` identifies the question so the
 * same one is not repeated on every re-render; `replay` is the "Hear it again" action.
 */
export function useQuestionSpeech(questionId: string | null, prompt: string | null) {
  const [muted, setMuted] = useState(false);
  const spokenRef = useRef<string | null>(null);

  const speak = useCallback((text: string) => {
    void Speech.stop();
    Speech.speak(text, { language: 'en-US', rate: 0.95 });
  }, []);

  useEffect(() => {
    if (!questionId || !prompt || spokenRef.current === questionId) return;
    spokenRef.current = questionId;
    if (!muted) speak(prompt);
  }, [muted, prompt, questionId, speak]);

  // Stop talking when the screen goes away.
  useEffect(() => () => void Speech.stop(), []);

  const toggleMute = useCallback(() => {
    setMuted((current) => {
      if (!current) void Speech.stop();
      return !current;
    });
  }, []);

  const replay = useCallback(() => {
    if (prompt) speak(prompt);
  }, [prompt, speak]);

  /** Call before recording so the phone does not record its own voice. */
  const stop = useCallback(() => void Speech.stop(), []);

  return { muted, toggleMute, replay, stop };
}
