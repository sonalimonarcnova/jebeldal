import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import {
  ActivityIndicator,
  Button,
  Card,
  Checkbox,
  Chip,
  HelperText,
  Text,
  TextInput,
} from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '../../src/auth/AuthProvider';
import {
  clearCachedDraftText,
  readCachedDraftText,
  writeCachedDraftText,
} from '../../src/features/incidents/draftCache';
import {
  resolveCachedDraftText,
  type DraftCacheConflict,
} from '../../src/features/incidents/draftRecovery';
import {
  formFieldId,
  getFieldPrompt,
  initialFieldValue,
  validateFieldValue,
  type FormFieldDefinition,
  type FormJsonValue,
} from '../../src/features/incidents/formDefinition';
import {
  loadIncidentDraft,
  saveIncidentFieldAnswer,
  type IncidentDraft,
  type IncidentForm,
} from '../../src/features/incidents/repository';

type FieldValues = Record<string, unknown>;
type DirtyFields = Record<string, boolean>;

function getFieldValues(draft: IncidentDraft): FieldValues {
  const values: FieldValues = {};
  for (const form of draft.forms) {
    for (const field of form.definition?.fields ?? []) {
      const answer = draft.answers.find(
        (candidate) => candidate.formKey === form.formKey
          && candidate.fieldKey === field.key
          && candidate.answerState === 'confirmed',
      );
      values[formFieldId(form.formKey, field.key)] = initialFieldValue(field, answer?.value ?? null);
    }
  }
  return values;
}

function formTitle(form: IncidentForm): string {
  return form.definition?.title
    ?? form.formKey.replace(/[_-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toLocaleUpperCase('en'));
}

function valuesEqual(field: FormFieldDefinition, value: unknown, savedValue: unknown): boolean {
  const parsed = validateFieldValue(field, value);
  return parsed.ok && JSON.stringify(parsed.value) === JSON.stringify(savedValue ?? null);
}

function displayAnswer(field: FormFieldDefinition, value: unknown): string {
  if (value === null || value === undefined || value === '') {
    return 'No answer saved.';
  }
  if (typeof value === 'boolean') {
    return value ? 'Yes' : 'No';
  }
  if (Array.isArray(value)) {
    return value.map((item) => {
      const option = field.options.find((candidate) => candidate.value === item);
      return option?.label ?? String(item);
    }).join(', ') || 'No answer saved.';
  }
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  return String(value);
}

function IncidentFieldEditor({
  field,
  value,
  onChange,
  disabled,
  readOnly,
}: {
  field: FormFieldDefinition;
  value: unknown;
  onChange: (value: unknown) => void;
  disabled: boolean;
  readOnly: boolean;
}) {
  const label = getFieldPrompt(field);
  if (readOnly) {
    return (
      <View style={styles.fieldControl}>
        <Text variant="labelLarge">{label}{field.required ? ' · Required' : ''}</Text>
        {field.configurationError ? (
          <HelperText type="error" visible>{field.configurationError}</HelperText>
        ) : null}
        <Text selectable>{displayAnswer(field, value)}</Text>
      </View>
    );
  }
  if (field.configurationError) {
    return (
      <View style={styles.fieldControl}>
        <Text variant="labelLarge">{label}</Text>
        <HelperText type="error" visible>{field.configurationError}</HelperText>
        {value !== null && value !== undefined && value !== '' ? (
          <Text selectable>{`Saved answer: ${displayAnswer(field, value)}`}</Text>
        ) : null}
      </View>
    );
  }

  if (field.type === 'boolean') {
    return (
      <View style={styles.fieldControl}>
        <Text variant="labelLarge">{label}{field.required ? ' · Required' : ''}</Text>
        <View style={styles.choiceRow}>
          <Button
            mode={value === true ? 'contained' : 'outlined'}
            onPress={() => onChange(true)}
            disabled={disabled}
          >
            Yes
          </Button>
          <Button
            mode={value === false ? 'contained' : 'outlined'}
            onPress={() => onChange(false)}
            disabled={disabled}
          >
            No
          </Button>
        </View>
        {value === null || value === undefined ? (
          <Text variant="bodySmall">Choose Yes or No.</Text>
        ) : null}
      </View>
    );
  }

  if (field.type === 'enum') {
    return (
      <View style={styles.fieldControl}>
        <Text variant="labelLarge">{label}{field.required ? ' · Required' : ''}</Text>
        {field.options.map((option) => (
          <Button
            key={option.value}
            mode={value === option.value ? 'contained' : 'outlined'}
            onPress={() => onChange(option.value)}
            disabled={disabled}
            style={styles.optionButton}
          >
            {option.label}
          </Button>
        ))}
      </View>
    );
  }

  if (field.type === 'multi_enum') {
    const selected = Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
    return (
      <View style={styles.fieldControl}>
        <Text variant="labelLarge">{label}{field.required ? ' · Required' : ''}</Text>
        {field.options.map((option) => (
          <Checkbox.Item
            key={option.value}
            label={option.label}
            status={selected.includes(option.value) ? 'checked' : 'unchecked'}
            onPress={() => {
              onChange(selected.includes(option.value)
                ? selected.filter((item) => item !== option.value)
                : [...selected, option.value]);
            }}
            disabled={disabled}
          />
        ))}
      </View>
    );
  }

  const isLongText = field.type === 'long_text';
  const keyboardType = field.type === 'number' || field.type === 'currency'
    ? 'decimal-pad'
    : field.type === 'phone'
      ? 'phone-pad'
      : field.type === 'email'
        ? 'email-address'
        : field.type === 'date'
          ? 'numbers-and-punctuation'
          : 'default';

  return (
    <TextInput
      mode="outlined"
      label={`${label}${field.required ? ' · Required' : ''}`}
      accessibilityLabel={label}
      multiline={isLongText}
      keyboardType={keyboardType}
      value={typeof value === 'string' || typeof value === 'number' ? String(value) : ''}
      onChangeText={onChange}
      disabled={disabled}
      style={isLongText ? styles.longText : undefined}
    />
  );
}

export default function IncidentDraftRoute() {
  const { revisionId: revisionIdParam } = useLocalSearchParams<{ revisionId: string }>();
  const revisionId = Array.isArray(revisionIdParam) ? revisionIdParam[0] : revisionIdParam;
  const { session } = useAuth();
  const [draft, setDraft] = useState<IncidentDraft | null>(null);
  const [fieldValues, setFieldValues] = useState<FieldValues>({});
  const [dirtyFields, setDirtyFields] = useState<DirtyFields>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [savingFieldId, setSavingFieldId] = useState<string | null>(null);
  const [cacheConflict, setCacheConflict] = useState<DraftCacheConflict | null>(null);
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const [localMessage, setLocalMessage] = useState<string | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const dirtyFieldsRef = useRef<DirtyFields>({});
  const savedValuesRef = useRef<FieldValues>({});

  const replaceDirtyFields = (next: DirtyFields) => {
    dirtyFieldsRef.current = next;
    setDirtyFields(next);
  };

  const markFieldDirty = (fieldId: string, dirty: boolean) => {
    const next = { ...dirtyFieldsRef.current };
    if (dirty) {
      next[fieldId] = true;
    } else {
      delete next[fieldId];
    }
    replaceDirtyFields(next);
  };

  const loadDraft = useCallback(async (): Promise<boolean> => {
    if (!revisionId || !session?.user.id) {
      setErrorText('A signed-in driver and incident revision are required.');
      setLoading(false);
      return false;
    }

    setLoading(true);
    setErrorText(null);
    try {
      const remoteDraft = await loadIncidentDraft(revisionId);
      const cachedDraft = remoteDraft.fieldKey
        ? await readCachedDraftText(session.user.id, revisionId, remoteDraft.fieldKey)
        : null;
      const recovery = resolveCachedDraftText(cachedDraft, remoteDraft);
      const nextValues = getFieldValues(remoteDraft);
      const narrativeId = remoteDraft.fieldKey && remoteDraft.narrativeFormKey
        ? formFieldId(remoteDraft.narrativeFormKey, remoteDraft.fieldKey)
        : null;
      const submittedLocalDifference = remoteDraft.status === 'submitted'
        && cachedDraft !== null
        && cachedDraft.text !== remoteDraft.narrative;

      setLocalMessage(null);
      setCacheConflict(null);
      setNeedsRefresh(false);
      setDraft(remoteDraft);
      savedValuesRef.current = nextValues;
      if (narrativeId) {
        nextValues[narrativeId] = remoteDraft.narrative;
      }

      if (recovery.kind === 'conflict' || submittedLocalDifference) {
        const conflict = recovery.kind === 'conflict'
          ? recovery.conflict
          : {
            localText: cachedDraft?.text ?? '',
            serverText: remoteDraft.narrative,
            expectedVersion: cachedDraft?.expectedVersion ?? remoteDraft.version,
            currentVersion: remoteDraft.version,
          };
        setFieldValues(nextValues);
        replaceDirtyFields({});
        setCacheConflict(conflict);
        setLocalMessage('The local and server copies differ. Choose which copy to keep before editing.');
      } else if (recovery.kind === 'restore' && narrativeId && remoteDraft.fieldKey) {
        nextValues[narrativeId] = recovery.text;
        setFieldValues(nextValues);
        replaceDirtyFields(recovery.dirty ? { [narrativeId]: true } : {});
        if (recovery.dirty) {
          setLocalMessage('Unsaved text was restored from this device. Save it to sync with the report.');
        }
      } else {
        setFieldValues(nextValues);
        replaceDirtyFields({});
      }
      return true;
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Could not load incident draft.');
      return false;
    } finally {
      setLoading(false);
    }
  }, [revisionId, session?.user.id]);

  useEffect(() => {
    void loadDraft();
  }, [loadDraft]);

  const narrativeId = draft?.fieldKey && draft.narrativeFormKey
    ? formFieldId(draft.narrativeFormKey, draft.fieldKey)
    : null;
  const narrativeValue = narrativeId && typeof fieldValues[narrativeId] === 'string'
    ? fieldValues[narrativeId] as string
    : '';
  const narrativeDirty = narrativeId ? dirtyFields[narrativeId] === true : false;

  useEffect(() => {
    if (
      !narrativeDirty
      || cacheConflict
      || needsRefresh
      || !draft?.fieldKey
      || !revisionId
      || !session?.user.id
    ) {
      return;
    }

    const timeout = setTimeout(() => {
      void writeCachedDraftText(
        session.user.id,
        revisionId,
        draft.fieldKey as string,
        narrativeValue,
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
  }, [
    cacheConflict,
    draft,
    narrativeDirty,
    narrativeValue,
    needsRefresh,
    revisionId,
    session?.user.id,
  ]);

  const keepLocalCopy = async () => {
    if (!cacheConflict || !draft?.fieldKey || !narrativeId || !revisionId || !session?.user.id) {
      return;
    }

    setSavingFieldId(narrativeId);
    setErrorText(null);
    try {
      await writeCachedDraftText(
        session.user.id,
        revisionId,
        draft.fieldKey,
        cacheConflict.localText,
        draft.version,
      );
      setFieldValues((current) => ({ ...current, [narrativeId]: cacheConflict.localText }));
      markFieldDirty(narrativeId, cacheConflict.localText.trim() !== draft.narrative);
      setCacheConflict(null);
      setLocalMessage('Local text kept. Save its answer to replace the current server copy.');
      setSaveMessage(null);
    } catch (error) {
      setErrorText(
        error instanceof Error
          ? `Could not preserve the local copy: ${error.message}`
          : 'Could not preserve the local copy.',
      );
    } finally {
      setSavingFieldId(null);
    }
  };

  const keepServerCopy = async () => {
    if (!cacheConflict || !draft?.fieldKey || !narrativeId || !revisionId || !session?.user.id) {
      return;
    }

    setSavingFieldId(narrativeId);
    setErrorText(null);
    try {
      await clearCachedDraftText(session.user.id, revisionId, draft.fieldKey);
      const nextValues = { ...fieldValues, [narrativeId]: cacheConflict.serverText };
      setFieldValues(nextValues);
      savedValuesRef.current = { ...savedValuesRef.current, [narrativeId]: cacheConflict.serverText };
      markFieldDirty(narrativeId, false);
      setCacheConflict(null);
      setLocalMessage('Server copy kept. The local copy was discarded.');
    } catch (error) {
      setErrorText(
        error instanceof Error
          ? `Could not discard the local copy: ${error.message}`
          : 'Could not discard the local copy.',
      );
    } finally {
      setSavingFieldId(null);
    }
  };

  const changeFieldValue = (form: IncidentForm, field: FormFieldDefinition, value: unknown) => {
    const fieldId = formFieldId(form.formKey, field.key);
    setFieldValues((current) => ({ ...current, [fieldId]: value }));
    setFieldErrors((current) => {
      const next = { ...current };
      delete next[fieldId];
      return next;
    });
    markFieldDirty(fieldId, !valuesEqual(field, value, savedValuesRef.current[fieldId]));
    setSaveMessage(null);
  };

  const saveField = async (form: IncidentForm, field: FormFieldDefinition) => {
    if (!draft || !revisionId || !session?.user.id || field.configurationError) {
      return;
    }

    const fieldId = formFieldId(form.formKey, field.key);
    if (fieldId !== narrativeId && narrativeDirty) {
      setErrorText('Save the incident narrative first so this answer uses the same server revision.');
      return;
    }

    const input = fieldId === narrativeId && typeof fieldValues[fieldId] === 'string'
      ? (fieldValues[fieldId] as string).trim()
      : fieldValues[fieldId];
    const parsed = validateFieldValue(field, input);
    if (!parsed.ok) {
      setFieldErrors((current) => ({ ...current, [fieldId]: parsed.error }));
      return;
    }

    setSavingFieldId(fieldId);
    setErrorText(null);
    setSaveMessage(null);
    try {
      const nextVersion = await saveIncidentFieldAnswer(
        draft,
        form.formKey,
        field.key,
        parsed.value as FormJsonValue,
        draft.version,
      );
      setDraft((current) => current ? { ...current, version: nextVersion } : current);
      markFieldDirty(fieldId, false);
      savedValuesRef.current = { ...savedValuesRef.current, [fieldId]: parsed.value };

      let cacheCleanupError: string | null = null;
      if (fieldId === narrativeId && draft.fieldKey) {
        try {
          await clearCachedDraftText(session.user.id, revisionId, draft.fieldKey);
        } catch (error) {
          cacheCleanupError = error instanceof Error
            ? `The server saved the answer, but local cache cleanup failed: ${error.message}`
            : 'The server saved the answer, but local cache cleanup failed.';
        }
      }

      try {
        const refreshedDraft = await loadIncidentDraft(revisionId);
        const refreshedValues = getFieldValues(refreshedDraft);
        savedValuesRef.current = refreshedValues;
        setDraft(refreshedDraft);
        setFieldValues((current) => {
          const next = { ...refreshedValues };
          for (const [dirtyId, dirty] of Object.entries(dirtyFieldsRef.current)) {
            if (dirty && dirtyId !== fieldId) {
              next[dirtyId] = current[dirtyId];
            }
          }
          return next;
        });
        setSaveMessage(
          cacheCleanupError
            ?? 'Answer saved. Form activation and status were refreshed from the server.',
        );
        if (cacheCleanupError) {
          setErrorText(cacheCleanupError);
        }
      } catch (error) {
        setNeedsRefresh(true);
        setSaveMessage('Answer saved to the server.');
        setErrorText(
          error instanceof Error
            ? `The answer was saved, but form activation/status could not be refreshed: ${error.message}`
            : 'The answer was saved, but form activation/status could not be refreshed.',
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not save incident answer.';
      setErrorText(message);
      if (message.includes('changed on the server')) {
        setNeedsRefresh(true);
      }
    } finally {
      setSavingFieldId(null);
    }
  };

  const reloadServerForm = async () => {
    if (!draft || !revisionId || !session?.user.id) {
      return;
    }
    if (narrativeDirty && narrativeId && draft.fieldKey) {
      try {
        await writeCachedDraftText(
          session.user.id,
          revisionId,
          draft.fieldKey,
          narrativeValue,
          draft.version,
        );
      } catch (error) {
        setErrorText(
          error instanceof Error ? `Could not preserve local narrative before reload: ${error.message}` : 'Could not preserve local narrative before reload.',
        );
        return;
      }
    }
    const refreshed = await loadDraft();
    if (refreshed) {
      setLocalMessage('Server form reloaded. Unsaved non-narrative answers were discarded; the narrative cache was preserved.');
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

  const readOnly = draft.status === 'submitted';
  const controlsDisabled = readOnly
    || savingFieldId !== null
    || needsRefresh
    || cacheConflict !== null;

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <Button onPress={() => router.back()}>Back</Button>
          <Text variant="labelLarge">
            {readOnly ? 'Submitted' : 'Draft'} · revision {draft.version}
          </Text>
        </View>
        {readOnly ? (
          <Text variant="bodyMedium">Submitted reports are read-only.</Text>
        ) : null}
        {cacheConflict && narrativeId ? (
          <Card>
            <Card.Content style={styles.cardContent}>
              <Text variant="titleSmall">
                {readOnly ? 'This submitted incident has unsynced local text' : 'Unsynced local text needs your choice'}
              </Text>
              <Text variant="labelMedium">Current server copy</Text>
              <Text selectable>{cacheConflict.serverText || '(empty)'}</Text>
              <Text variant="labelMedium">
                Local copy · saved against revision {cacheConflict.expectedVersion}
              </Text>
              <Text selectable>{cacheConflict.localText || '(empty)'}</Text>
              <Text variant="bodySmall">
                {readOnly
                  ? 'Submitted reports cannot be changed. The local copy stays on this device until you discard it.'
                  : `The server is now at revision ${cacheConflict.currentVersion}. Neither copy has been changed.`}
              </Text>
              {!readOnly ? (
                <Button mode="contained" onPress={() => void keepLocalCopy()} disabled={savingFieldId !== null}>
                  Keep local text
                </Button>
              ) : null}
              <Button mode="outlined" onPress={() => void keepServerCopy()} disabled={savingFieldId !== null}>
                {readOnly ? 'Discard local copy and keep submitted report' : 'Keep server copy and discard local'}
              </Button>
            </Card.Content>
          </Card>
        ) : null}
        {needsRefresh ? (
          <Card>
            <Card.Content style={styles.cardContent}>
              <Text variant="titleSmall">Server state needs a refresh</Text>
              <Text variant="bodyMedium">
                If an answer was rejected as stale, it was not saved. Reload the server form before trying again; unsaved non-narrative answers will be discarded, while the narrative cache is preserved.
              </Text>
              <Button mode="contained" onPress={() => void reloadServerForm()}>
                Reload server form
              </Button>
            </Card.Content>
          </Card>
        ) : null}
        {!draft.forms.length ? (
          <Card>
            <Card.Content style={styles.cardContent}>
              <HelperText type="error" visible>
                No pinned forms are available for this incident revision.
              </HelperText>
            </Card.Content>
          </Card>
        ) : null}
        {draft.forms.map((form) => {
          const isActive = form.activationStatus === 'triggered';
          const fields = form.definition?.fields ?? [];
          let previousSection: string | null = null;
          return (
            <Card key={`${form.formKey}:${form.version}`}>
              <Card.Content style={styles.cardContent}>
                <View style={styles.formHeader}>
                  <View style={styles.formTitle}>
                    <Text variant="titleMedium">{formTitle(form)}</Text>
                    <Text variant="bodySmall">Pinned version {form.version}</Text>
                  </View>
                  <Chip compact>{isActive ? 'Active' : 'Not triggered'}</Chip>
                </View>
                {form.definitionError ? (
                  <HelperText type="error" visible>{form.definitionError}</HelperText>
                ) : null}
                {form.definition?.warnings.map((warning, index) => (
                  <HelperText key={`${form.formKey}:warning:${index}`} type="error" visible>
                    {warning}
                  </HelperText>
                ))}
                {fields.map((field) => {
                  const fieldId = formFieldId(form.formKey, field.key);
                  const showSection = field.section !== null && field.section !== previousSection;
                  previousSection = field.section;
                  const value = fieldValues[fieldId] ?? initialFieldValue(field, null);
                  return (
                    <View key={fieldId} style={styles.field}>
                      {showSection ? <Text variant="titleSmall">{field.section}</Text> : null}
                      <IncidentFieldEditor
                        field={field}
                        value={value}
                        onChange={(next) => changeFieldValue(form, field, next)}
                        disabled={controlsDisabled || !isActive}
                        readOnly={readOnly || !isActive}
                      />
                      {fieldErrors[fieldId] ? (
                        <HelperText type="error" visible>{fieldErrors[fieldId]}</HelperText>
                      ) : null}
                      {!readOnly && isActive && !field.configurationError ? (
                        <Button
                          mode="contained"
                          onPress={() => void saveField(form, field)}
                          disabled={
                            controlsDisabled
                            || !dirtyFields[fieldId]
                            || (fieldId !== narrativeId && narrativeDirty)
                          }
                          loading={savingFieldId === fieldId}
                        >
                          Save answer
                        </Button>
                      ) : null}
                    </View>
                  );
                })}
                {!fields.length && !form.definitionError ? (
                  <HelperText type="error" visible>
                    No fields are available in this pinned form definition.
                  </HelperText>
                ) : null}
              </Card.Content>
            </Card>
          );
        })}
        {localMessage ? <HelperText type="info">{localMessage}</HelperText> : null}
        {saveMessage ? <HelperText type="info">{saveMessage}</HelperText> : null}
        {errorText ? <HelperText type="error">{errorText}</HelperText> : null}
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
  formHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
  },
  formTitle: {
    flexShrink: 1,
    gap: 4,
  },
  field: {
    gap: 8,
  },
  fieldControl: {
    gap: 8,
  },
  choiceRow: {
    flexDirection: 'row',
    gap: 12,
  },
  optionButton: {
    alignSelf: 'stretch',
  },
  longText: {
    minHeight: 140,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    padding: 24,
  },
});
