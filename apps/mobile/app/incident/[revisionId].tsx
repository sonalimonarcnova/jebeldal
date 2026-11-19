import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type ScrollViewInstance,
} from 'react-native';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import * as LocalAuthentication from 'expo-local-authentication';
import {
  ActivityIndicator,
  Card,
  Chip,
  HelperText,
  List,
  Menu,
  ProgressBar,
  SegmentedButtons,
  Text,
  TextInput,
} from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '../../src/auth/AuthProvider';
import {
  createClientTurnId,
  findPinnedQuestionMapping,
  questionAnswerText,
  type InterviewQuestion,
} from '../../src/features/incidents/questionFlow';
import type { PersistedAnswerState } from '../../src/features/incidents/rpcOperations';
import {
  processIncidentTextTurn,
  selectNextQuestion,
} from '../../src/features/incidents/questionFlowRepository';
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
  groupedFormFieldId,
  getFieldPrompt,
  initialFieldValue,
  validateFieldValue,
  type FormFieldDefinition,
  type FormJsonValue,
} from '../../src/features/incidents/formDefinition';
import {
  loadIncidentDraft,
  checkIncidentSubmissionReadiness,
  createIncidentAnswerGroup,
  createIncidentEvidence,
  deleteIncidentAnswerGroup,
  finalizeIncidentEvidence,
  saveIncidentDetails,
  saveIncidentFieldAnswer,
  submitIncident,
  uploadIncidentEvidenceFile,
  type IncidentAnswer,
  type IncidentAnswerGroup,
  type IncidentDraft,
  type IncidentEvidence,
  type IncidentForm,
} from '../../src/features/incidents/repository';
import { formatLocation } from '../../src/features/incidents/model';
import {
  clearCachedDraftEdits,
  readCachedDraftEdits,
  resolveCachedDraftEdits,
  writeCachedDraftEdits,
  type DraftEditRecovery,
} from '../../src/features/incidents/draftEditCache';
import {
  clearPendingSubmission,
  createSignatureReference,
  readPendingSubmission,
  writePendingSubmission,
  type PendingSubmission,
} from '../../src/features/incidents/submissionCache';
import type { SubmitIssue } from '../../src/features/incidents/rpcOperations';
import { AppButton as Button } from '../../src/ui/AppButton';
import { palette } from '../../src/ui/theme';

type FieldValues = Record<string, unknown>;
type DirtyFields = Record<string, boolean>;
type PhotoUploadState = {
  uri: string;
  contentType: string;
  status: 'uploading' | 'failed' | 'uploaded';
};

const occurredAtFieldId = '__incident_details:occurred_at';
const locationFieldId = '__incident_details:location';

function getFieldValues(draft: IncidentDraft): FieldValues {
  const values: FieldValues = {
    [occurredAtFieldId]: toLocalDateTimeInput(draft.occurredAt),
    [locationFieldId]: formatLocation(draft.location) ?? '',
  };
  for (const form of draft.forms) {
    for (const field of form.definition?.fields.filter((candidate) => candidate.groupKey === null) ?? []) {
      const answer = draft.answers.find(
        (candidate) => candidate.formKey === form.formKey
          && candidate.fieldKey === field.key
          && candidate.groupInstanceId === null
          && candidate.answerState === 'confirmed',
      );
      values[formFieldId(form.formKey, field.key)] = initialFieldValue(field, answer?.value ?? null);
    }
  }
  for (const group of draft.groups) {
    const form = draft.forms.find((candidate) => candidate.formKey === group.formKey);
    for (const field of form?.definition?.fields.filter((candidate) => candidate.groupKey === group.groupKey) ?? []) {
      const answer = draft.answers.find(
        (candidate) => candidate.formKey === group.formKey
          && candidate.fieldKey === field.key
          && candidate.groupInstanceId === group.id
          && candidate.answerState === 'confirmed',
      );
      values[groupedFormFieldId(group.formKey, field.key, group.id)] = initialFieldValue(
        field,
        answer?.value ?? null,
      );
    }
  }
  return values;
}

function toLocalDateTimeInput(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

type DateControlType = 'date' | 'datetime';

function parseDateControlValue(value: unknown, type: DateControlType): Date | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  if (type === 'date') {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) return null;
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12);
    return date.getFullYear() === Number(match[1])
      && date.getMonth() === Number(match[2]) - 1
      && date.getDate() === Number(match[3])
      ? date
      : null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toLocalDateValue(date: Date): string {
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function formatDateControlValue(value: unknown, type: DateControlType): string | null {
  const date = parseDateControlValue(value, type);
  if (!date) return null;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    ...(type === 'datetime' ? { timeStyle: 'short' as const } : {}),
  }).format(date);
}

function answerIdentity(answer: IncidentAnswer): string {
  return JSON.stringify([answer.formKey, answer.fieldKey, answer.groupInstanceId]);
}

function parseAnswerFieldId(fieldId: string): [string, string, string?] | null {
  try {
    const parsed: unknown = JSON.parse(fieldId);
    if (
      Array.isArray(parsed)
      && typeof parsed[0] === 'string'
      && typeof parsed[1] === 'string'
      && (parsed[2] === undefined || typeof parsed[2] === 'string')
    ) {
      return parsed as [string, string, string?];
    }
  } catch {
    return null;
  }
  return null;
}

function displayConflictValue(field: FormFieldDefinition | null, value: unknown): string {
  if (field) return displayAnswer(field, value);
  if (value === null || value === undefined || value === '') return 'No value';
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    ? String(value)
    : JSON.stringify(value);
}

function findAnswerField(
  draft: IncidentDraft,
  formKey: string,
  fieldKey: string,
  groupInstanceId: string | null,
): FormFieldDefinition | null {
  const form = draft.forms.find((candidate) => candidate.formKey === formKey);
  const groupKey = groupInstanceId
    ? draft.groups.find((group) => group.id === groupInstanceId)?.groupKey ?? null
    : null;
  return form?.definition?.fields.find(
    (field) => field.key === fieldKey && field.groupKey === groupKey,
  ) ?? null;
}

function answerValueId(formKey: string, fieldKey: string, groupInstanceId: string | null): string {
  return groupInstanceId
    ? groupedFormFieldId(formKey, fieldKey, groupInstanceId)
    : formFieldId(formKey, fieldKey);
}

function locationValue(existing: unknown, label: string): FormJsonValue | null {
  if (!label.trim()) return null;
  const previous = typeof existing === 'object' && existing !== null && !Array.isArray(existing)
    ? existing as Record<string, unknown>
    : {};
  return { ...previous, label: label.trim() } as FormJsonValue;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function issueLabel(issue: SubmitIssue, draft: IncidentDraft): string {
  const field = issue.formKey && issue.fieldKey
    ? findAnswerField(draft, issue.formKey, issue.fieldKey, issue.groupInstanceId)
    : null;
  const fieldLabel = issue.label
    ?? (field ? getFieldPrompt(field) : issue.fieldKey ?? 'Report requirement');
  return `${fieldLabel} · ${issue.code.replaceAll('_', ' ').toLocaleLowerCase('en')}`;
}

function issueActionLabel(action: string | null): string | null {
  switch (action) {
    case 'capture_or_upload_evidence':
      return 'Capture or upload evidence';
    case 'add_group_entry':
      return 'Add the required repeated item';
    case 'answer_field':
      return 'Complete this field';
    case 'refresh_form_definitions':
      return 'Refresh pinned form definitions';
    default:
      return action;
  }
}

function formTitle(form: IncidentForm): string {
  return form.definition?.title
    ?? form.formKey.replace(/[_-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toLocaleUpperCase('en'));
}

function valuesEqual(field: FormFieldDefinition, value: unknown, savedValue: unknown): boolean {
  const parsed = validateFieldValue(field, value);
  return parsed.ok && JSON.stringify(parsed.value) === JSON.stringify(savedValue ?? null);
}

function answerStateLabel(answerState: PersistedAnswerState): string {
  switch (answerState) {
    case 'confirmed':
      return 'Confirmed';
    case 'unknown':
      return 'Unknown';
    case 'declined':
      return 'Declined';
    case 'not_applicable':
      return 'Not applicable';
    case 'pending_follow_up':
      return 'Pending follow-up';
  }
}

function displayAnswer(field: FormFieldDefinition, value: unknown): string {
  if (value === null || value === undefined || value === '') {
    return 'No answer saved.';
  }
  if (field.type === 'date' || field.type === 'datetime') {
    return formatDateControlValue(value, field.type) ?? String(value);
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

const answerStateActions: Partial<Record<PersistedAnswerState, string>> = {
  unknown: 'I don’t know',
  declined: 'Prefer not to answer',
  not_applicable: 'Not applicable',
  pending_follow_up: 'Follow up later',
};

function EnumFieldEditor({
  field,
  label,
  value,
  onChange,
  disabled,
}: {
  field: FormFieldDefinition;
  label: string;
  value: unknown;
  onChange: (value: unknown) => void;
  disabled: boolean;
}) {
  const [menuVisible, setMenuVisible] = useState(false);
  const selectedOption = field.options.find((option) => option.value === value);

  return (
    <View style={styles.fieldControl}>
      <Text variant="labelLarge">{label}{field.required ? ' · Required' : ''}</Text>
      <Menu
        visible={menuVisible}
        onDismiss={() => setMenuVisible(false)}
        anchorPosition="bottom"
        contentStyle={styles.dropdownMenu}
        anchor={
          <Button
            mode="outlined"
            icon={menuVisible ? 'chevron-up' : 'chevron-down'}
            onPress={() => setMenuVisible(true)}
            disabled={disabled}
            accessibilityLabel={`${label}: ${selectedOption?.label ?? 'Choose an option'}`}
            style={styles.dropdownButton}
            contentStyle={styles.dropdownButtonContent}
            labelStyle={styles.dropdownButtonLabel}
          >
            {selectedOption?.label ?? 'Choose an option'}
          </Button>
        }
      >
        {field.options.map((option) => (
          <Menu.Item
            key={option.value}
            title={option.label}
            trailingIcon={option.value === value ? 'check' : undefined}
            accessibilityState={{ selected: option.value === value }}
            onPress={() => {
              onChange(option.value);
              setMenuVisible(false);
            }}
          />
        ))}
      </Menu>
    </View>
  );
}

function DateTimeFieldEditor({
  label,
  type,
  value,
  onChange,
  disabled,
}: {
  label: string;
  type: DateControlType;
  value: unknown;
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  const parsedValue = parseDateControlValue(value, type);
  const [pickerMode, setPickerMode] = useState<'date' | 'time' | null>(null);
  const [selectedDate, setSelectedDate] = useState<Date | null>(parsedValue);
  const [selectedTime, setSelectedTime] = useState<Date | null>(parsedValue);

  useEffect(() => {
    setSelectedDate(parsedValue);
    setSelectedTime(parsedValue);
  }, [value, type]);

  const handlePickerChange = (event: DateTimePickerEvent, pickedDate?: Date) => {
    const mode = pickerMode;
    setPickerMode(null);
    if (event.type !== 'set' || !pickedDate || !mode) return;

    if (type === 'date') {
      setSelectedDate(pickedDate);
      onChange(toLocalDateValue(pickedDate));
      return;
    }

    if (mode === 'date') {
      setSelectedDate(pickedDate);
      const time = selectedTime;
      if (time) {
        const combined = new Date(pickedDate);
        combined.setHours(time.getHours(), time.getMinutes(), 0, 0);
        onChange(combined.toISOString());
      }
      return;
    }

    setSelectedTime(pickedDate);
    const date = selectedDate;
    if (date) {
      const combined = new Date(date);
      combined.setHours(pickedDate.getHours(), pickedDate.getMinutes(), 0, 0);
      onChange(combined.toISOString());
    }
  };

  const dateValue = selectedDate ?? parsedValue;
  const timeValue = selectedTime ?? parsedValue;
  const pickerValue = pickerMode === 'time'
    ? timeValue ?? new Date()
    : dateValue ?? new Date();
  const dateLabel = dateValue
    ? formatDateControlValue(toLocalDateValue(dateValue), 'date') ?? 'Choose date'
    : 'Choose date';
  const timeLabel = timeValue
    ? new Intl.DateTimeFormat(undefined, { timeStyle: 'short' }).format(timeValue)
    : 'Choose time';

  return (
    <View style={styles.fieldControl}>
      <Text variant="labelLarge">{label}</Text>
      <View style={styles.dateTimeControls}>
        <Button
          mode="outlined"
          icon="calendar-month"
          accessibilityLabel={`${label}: ${dateLabel}`}
          disabled={disabled}
          onPress={() => setPickerMode('date')}
          style={styles.dateTimeButton}
          contentStyle={styles.dateTimeButtonContent}
          labelStyle={styles.dateTimeButtonLabel}
        >
          {dateLabel}
        </Button>
        {type === 'datetime' ? (
          <Button
            mode="outlined"
            icon="clock-outline"
            accessibilityLabel={`${label}: ${timeLabel}`}
            disabled={disabled}
            onPress={() => setPickerMode('time')}
            style={styles.dateTimeButton}
            contentStyle={styles.dateTimeButtonContent}
            labelStyle={styles.dateTimeButtonLabel}
          >
            {timeLabel}
          </Button>
        ) : null}
      </View>
      {pickerMode ? (
        <DateTimePicker
          value={pickerValue}
          mode={pickerMode}
          display={Platform.OS === 'ios' ? 'compact' : 'default'}
          onChange={handlePickerChange}
          accentColor={palette.primary}
        />
      ) : null}
    </View>
  );
}

function IncidentFieldEditor({
  field,
  value,
  onChange,
  disabled,
  readOnly,
  promptOverride,
  onBlur,
}: {
  field: FormFieldDefinition;
  value: unknown;
  onChange: (value: unknown) => void;
  disabled: boolean;
  readOnly: boolean;
  promptOverride?: string;
  onBlur?: () => void;
}) {
  const label = promptOverride ?? getFieldPrompt(field);
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
        <SegmentedButtons
          value={value === true ? 'yes' : value === false ? 'no' : ''}
          onValueChange={(selected) => onChange(selected === 'yes')}
          buttons={[
            { value: 'yes', label: 'Yes', disabled },
            { value: 'no', label: 'No', disabled },
          ]}
        />
        {value === null || value === undefined ? (
          <HelperText type="info" visible>Choose Yes or No.</HelperText>
        ) : null}
      </View>
    );
  }

  if (field.type === 'enum') {
    return (
      <EnumFieldEditor
        field={field}
        label={label}
        value={value}
        onChange={onChange}
        disabled={disabled}
      />
    );
  }

  if (field.type === 'multi_enum') {
    const selected = Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
    return (
      <View style={styles.fieldControl}>
        <Text variant="labelLarge">{label}{field.required ? ' · Required' : ''}</Text>
        <HelperText type="info" visible>Select all that apply.</HelperText>
        <View style={styles.multiSelectOptions}>
          {field.options.map((option) => {
            const isSelected = selected.includes(option.value);
            return (
          <Pressable
            key={option.value}
            accessibilityRole="checkbox"
            accessibilityLabel={option.label}
            accessibilityState={{ checked: isSelected, disabled }}
            disabled={disabled}
            onPress={() => {
              onChange(isSelected
                ? selected.filter((item) => item !== option.value)
                : [...selected, option.value]);
            }}
            style={({ pressed }) => [
              styles.multiSelectOption,
              isSelected && styles.multiSelectOptionSelected,
              disabled && styles.multiSelectOptionDisabled,
              pressed && !disabled && styles.multiSelectOptionPressed,
            ]}
          >
            <List.Icon
              icon={isSelected ? 'checkbox-marked' : 'checkbox-blank-outline'}
              color={isSelected ? palette.primary : palette.mutedText}
            />
            <Text variant="bodyMedium" style={styles.multiSelectOptionLabel}>
              {option.label}
            </Text>
          </Pressable>
            );
          })}
        </View>
      </View>
    );
  }

  if (field.type === 'date' || field.type === 'datetime') {
    return (
      <DateTimeFieldEditor
        label={`${label}${field.required ? ' · Required' : ''}`}
        type={field.type}
        value={value}
        onChange={onChange}
        disabled={disabled}
      />
    );
  }

  const isLongText = field.type === 'long_text';
  const keyboardType = field.type === 'number' || field.type === 'currency'
    ? 'decimal-pad'
    : field.type === 'phone'
      ? 'phone-pad'
      : field.type === 'email'
        ? 'email-address'
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
      onBlur={onBlur}
      disabled={disabled}
      maxLength={field.validation?.maxLength}
      accessibilityHint={field.required ? 'Required field' : undefined}
      style={isLongText ? styles.longText : undefined}
    />
  );
}

export default function IncidentDraftRoute() {
  const {
    revisionId: revisionIdParam,
    returnTo: returnToParam,
  } = useLocalSearchParams<{ revisionId: string; returnTo?: string }>();
  const revisionId = Array.isArray(revisionIdParam) ? revisionIdParam[0] : revisionIdParam;
  const returnTo = Array.isArray(returnToParam) ? returnToParam[0] : returnToParam;
  const fallbackRoute = returnTo === 'home' ? '/(driver)/home' : '/(driver)/incidents';
  const backLabel = returnTo === 'home' ? 'Back to Home' : 'Back to Incidents';
  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace(fallbackRoute);
    }
  };
  const { session } = useAuth();
  const [draft, setDraft] = useState<IncidentDraft | null>(null);
  const [fieldValues, setFieldValues] = useState<FieldValues>({});
  const [dirtyFields, setDirtyFields] = useState<DirtyFields>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [savingFieldId, setSavingFieldId] = useState<string | null>(null);
  const [cacheConflict, setCacheConflict] = useState<DraftCacheConflict | null>(null);
  const [editCacheConflict, setEditCacheConflict] = useState<DraftEditRecovery>({ kind: 'none' });
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const [localMessage, setLocalMessage] = useState<string | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [nextQuestion, setNextQuestion] = useState<InterviewQuestion | null>(null);
  const [interviewComplete, setInterviewComplete] = useState(false);
  const [questionLoading, setQuestionLoading] = useState(false);
  const [questionError, setQuestionError] = useState<string | null>(null);
  const [questionAnswer, setQuestionAnswer] = useState<unknown>('');
  const [submittingTurn, setSubmittingTurn] = useState(false);
  const [turnMessage, setTurnMessage] = useState<string | null>(null);
  const [detailMessage, setDetailMessage] = useState<string | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [gpsLocation, setGpsLocation] = useState<FormJsonValue | null>(null);
  const [locationLoading, setLocationLoading] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [photoUploads, setPhotoUploads] = useState<Record<string, PhotoUploadState>>({});
  const [photoBusy, setPhotoBusy] = useState(false);
  const [creatingGroup, setCreatingGroup] = useState<string | null>(null);
  const [deletingGroup, setDeletingGroup] = useState<string | null>(null);
  const [historyAnswerId, setHistoryAnswerId] = useState<string | null>(null);
  const [expandedForms, setExpandedForms] = useState<Record<string, boolean>>({});
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({});
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [previewVisible, setPreviewVisible] = useState(false);
  const [expandedPreviewForms, setExpandedPreviewForms] = useState<Record<string, boolean>>({});
  const [pendingSubmission, setPendingSubmission] = useState<PendingSubmission | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitIssues, setSubmitIssues] = useState<SubmitIssue[]>([]);
  const [readinessVersion, setReadinessVersion] = useState<number | null>(null);
  const [readinessMessage, setReadinessMessage] = useState<string | null>(null);
  const [readinessLoading, setReadinessLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const dirtyFieldsRef = useRef<DirtyFields>({});
  const fieldValuesRef = useRef<FieldValues>({});
  const savedValuesRef = useRef<FieldValues>({});
  const draftRef = useRef<IncidentDraft | null>(draft);
  const pendingTurnRef = useRef<{ questionId: string; text: string; clientTurnId: string } | null>(null);
  const scrollRef = useRef<ScrollViewInstance | null>(null);
  const formOffsetsRef = useRef<Record<string, number>>({});
  const historyOffsetRef = useRef(0);
  const submitInFlightRef = useRef(false);
  draftRef.current = draft;

  useEffect(() => {
    fieldValuesRef.current = fieldValues;
  }, [fieldValues]);

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

  const persistCurrentEdits = async (
    expectedVersion: number,
    values: FieldValues = fieldValuesRef.current,
  ) => {
    if (!revisionId || !session?.user.id) return;
    const dirtyIds = Object.keys(dirtyFieldsRef.current)
      .filter((fieldId) => dirtyFieldsRef.current[fieldId]);
    await writeCachedDraftEdits(session.user.id, revisionId, {
      expectedVersion,
      dirtyFieldIds: dirtyIds,
      values: Object.fromEntries(dirtyIds.map((fieldId) => [fieldId, values[fieldId]])),
    });
  };

  const updateLocalFieldValue = (fieldId: string, value: unknown) => {
    fieldValuesRef.current = { ...fieldValuesRef.current, [fieldId]: value };
    setFieldValues((current) => ({ ...current, [fieldId]: value }));
  };

  const refreshDraftPreservingDirty = async (): Promise<IncidentDraft> => {
    if (!revisionId) throw new Error('An incident revision is required.');
    const refreshedDraft = await loadIncidentDraft(revisionId);
    const refreshedValues = getFieldValues(refreshedDraft);
    savedValuesRef.current = refreshedValues;
    setDraft(refreshedDraft);
    setFieldValues((current) => {
      const next = { ...refreshedValues };
      for (const [fieldId, dirty] of Object.entries(dirtyFieldsRef.current)) {
        if (dirty) next[fieldId] = current[fieldId];
      }
      fieldValuesRef.current = next;
      return next;
    });
    return refreshedDraft;
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
      const cachedEdits = await readCachedDraftEdits(session.user.id, revisionId);
      const editRecovery = resolveCachedDraftEdits(
        cachedEdits,
        remoteDraft.version,
        remoteDraft.status === 'submitted',
      );
      const cachedDraft = remoteDraft.fieldKey
        ? await readCachedDraftText(session.user.id, revisionId, remoteDraft.fieldKey)
        : null;
      const recovery = resolveCachedDraftText(cachedDraft, remoteDraft);
      const serverValues = getFieldValues(remoteDraft);
      const nextValues = editRecovery.kind === 'none'
        ? serverValues
        : { ...serverValues, ...editRecovery.values };
      const narrativeId = remoteDraft.fieldKey && remoteDraft.narrativeFormKey
        ? formFieldId(remoteDraft.narrativeFormKey, remoteDraft.fieldKey)
        : null;
      const submittedLocalDifference = remoteDraft.status === 'submitted'
        && cachedDraft !== null
        && cachedDraft.text !== remoteDraft.narrative;

      setLocalMessage(null);
      setCacheConflict(null);
      setEditCacheConflict(editRecovery.kind === 'conflict' ? editRecovery : { kind: 'none' });
      setNeedsRefresh(false);
      setDraft(remoteDraft);
      savedValuesRef.current = serverValues;

      if (recovery.kind === 'conflict' || submittedLocalDifference) {
        const conflict = recovery.kind === 'conflict'
          ? recovery.conflict
          : {
            localText: cachedDraft?.text ?? '',
            serverText: remoteDraft.narrative,
            expectedVersion: cachedDraft?.expectedVersion ?? remoteDraft.version,
            currentVersion: remoteDraft.version,
          };
        const displayedValues = {
          ...nextValues,
          ...(narrativeId ? { [narrativeId]: conflict.serverText } : {}),
        };
        fieldValuesRef.current = displayedValues;
        setFieldValues(displayedValues);
        setCacheConflict(conflict);
        setLocalMessage('The local and server narrative copies differ. Choose which copy to keep before editing.');
      } else if (recovery.kind === 'restore' && narrativeId && remoteDraft.fieldKey) {
        nextValues[narrativeId] = recovery.text;
        fieldValuesRef.current = nextValues;
        setFieldValues(nextValues);
        if (recovery.dirty) {
          setLocalMessage('Unsaved text was restored from this device. Save it to sync with the report.');
        }
      } else {
        fieldValuesRef.current = nextValues;
        setFieldValues(nextValues);
      }
      const restoredDirtyFields: DirtyFields = editRecovery.kind === 'none'
        ? {}
        : Object.fromEntries(editRecovery.dirtyFieldIds.map((fieldId) => [fieldId, true]));
      if (recovery.kind === 'restore' && recovery.dirty && narrativeId) {
        restoredDirtyFields[narrativeId] = true;
      }
      replaceDirtyFields(restoredDirtyFields);

      const pending = await readPendingSubmission(session.user.id, revisionId);
      if (
        pending
        && (remoteDraft.status === 'submitted' || pending.expectedVersion !== remoteDraft.version)
      ) {
        await clearPendingSubmission(session.user.id, revisionId);
        setPendingSubmission(null);
        if (remoteDraft.status === 'submitted') {
          setSubmitError(null);
        } else {
          setSubmitError('The draft changed after the last confirmation attempt. Your report is still a draft; review and confirm again.');
        }
      } else {
        setPendingSubmission(pending);
      }
      if (editRecovery.kind === 'conflict') {
        setLocalMessage(
          remoteDraft.status === 'submitted'
            ? 'Unsaved edits from this device are read-only and have not changed the submitted report.'
            : 'Unsaved edits were preserved. Choose which copy to keep before saving against the newer revision.',
        );
      } else if (editRecovery.kind === 'restore') {
        setLocalMessage('Unsaved edits were restored from this device. Save them to sync with the report.');
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

  useEffect(() => {
    if (
      !draft
      || draft.status !== 'draft'
      || !revisionId
      || !session?.user.id
      || editCacheConflict.kind === 'conflict'
      || cacheConflict
    ) {
      return;
    }

    const persist = () => {
      const dirtyIds = Object.keys(dirtyFieldsRef.current)
        .filter((fieldId) => dirtyFieldsRef.current[fieldId]);
      const values = Object.fromEntries(
        dirtyIds.map((fieldId) => [fieldId, fieldValuesRef.current[fieldId]]),
      );
      return writeCachedDraftEdits(session.user.id, revisionId, {
        expectedVersion: draft.version,
        dirtyFieldIds: dirtyIds,
        values,
      });
    };
    const timeout = setTimeout(() => {
      void persist().catch((error: unknown) => {
        setErrorText(errorMessage(error, 'Could not preserve unsaved form edits on this device.'));
      });
    }, 250);
    return () => {
      clearTimeout(timeout);
      void persist().catch(() => undefined);
    };
  }, [
    cacheConflict,
    draft,
    dirtyFields,
    editCacheConflict,
    revisionId,
    session?.user.id,
  ]);

  const keepUnsavedEdits = async () => {
    if (
      editCacheConflict.kind !== 'conflict'
      || !draft
      || draft.status !== 'draft'
      || !revisionId
      || !session?.user.id
    ) {
      return;
    }
    try {
      await writeCachedDraftEdits(session.user.id, revisionId, {
        expectedVersion: draft.version,
        dirtyFieldIds: editCacheConflict.dirtyFieldIds,
        values: editCacheConflict.values,
      });
      const restoredValues = { ...fieldValuesRef.current, ...editCacheConflict.values };
      fieldValuesRef.current = restoredValues;
      setFieldValues(restoredValues);
      replaceDirtyFields({
        ...dirtyFieldsRef.current,
        ...Object.fromEntries(editCacheConflict.dirtyFieldIds.map((fieldId) => [fieldId, true])),
      });
      setEditCacheConflict({ kind: 'none' });
      setLocalMessage('Your local edits are preserved against the current revision. Review and save each changed field.');
    } catch (error) {
      setErrorText(errorMessage(error, 'Could not preserve the local edits.'));
    }
  };

  const useServerEdits = async () => {
    if (
      editCacheConflict.kind !== 'conflict'
      || !revisionId
      || !session?.user.id
    ) {
      return;
    }
    const nextValues = { ...fieldValuesRef.current };
    const nextDirty = { ...dirtyFieldsRef.current };
    for (const fieldId of editCacheConflict.dirtyFieldIds) {
      nextValues[fieldId] = savedValuesRef.current[fieldId];
      delete nextDirty[fieldId];
    }
    await clearCachedDraftEdits(session.user.id, revisionId);
    fieldValuesRef.current = nextValues;
    setFieldValues(nextValues);
    replaceDirtyFields(nextDirty);
    setEditCacheConflict({ kind: 'none' });
    setLocalMessage('The current server values were kept; unsaved local edits were discarded.');
  };

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
      updateLocalFieldValue(narrativeId, cacheConflict.localText);
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
      const nextValues = { ...fieldValuesRef.current, [narrativeId]: cacheConflict.serverText };
      fieldValuesRef.current = nextValues;
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

  const changeAnswerValue = (
    form: IncidentForm,
    field: FormFieldDefinition,
    value: unknown,
    groupInstanceId: string | null,
  ) => {
    const fieldId = answerValueId(form.formKey, field.key, groupInstanceId);
    updateLocalFieldValue(fieldId, value);
    setFieldErrors((current) => {
      const next = { ...current };
      delete next[fieldId];
      return next;
    });
    markFieldDirty(fieldId, !valuesEqual(field, value, savedValuesRef.current[fieldId]));
    setSaveMessage(null);
  };

  const validateEditedField = (
    form: IncidentForm,
    field: FormFieldDefinition,
    groupInstanceId: string | null,
  ) => {
    const fieldId = answerValueId(form.formKey, field.key, groupInstanceId);
    if (!dirtyFieldsRef.current[fieldId]) return;
    const result = validateFieldValue(field, fieldValuesRef.current[fieldId]);
    if (!result.ok) {
      setFieldErrors((current) => ({ ...current, [fieldId]: result.error }));
    }
  };

  const saveField = async (
    form: IncidentForm,
    field: FormFieldDefinition,
    groupInstanceId: string | null = null,
  ) => {
    if (!draft || !revisionId || !session?.user.id || field.configurationError) {
      return;
    }

    const fieldId = answerValueId(form.formKey, field.key, groupInstanceId);
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
        'confirmed',
        groupInstanceId,
      );
      setDraft((current) => current ? { ...current, version: nextVersion } : current);
      markFieldDirty(fieldId, false);
      savedValuesRef.current = { ...savedValuesRef.current, [fieldId]: parsed.value };
      await persistCurrentEdits(nextVersion);

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
          fieldValuesRef.current = next;
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

  const loadNextQuestion = useCallback(async () => {
    const currentDraft = draftRef.current;
    if (!revisionId || currentDraft?.status !== 'draft') {
      setNextQuestion(null);
      setInterviewComplete(false);
      return;
    }
    setQuestionLoading(true);
    setQuestionError(null);
    try {
      const result = await selectNextQuestion(revisionId);
      if (result.kind === 'complete') {
        setNextQuestion(null);
        setInterviewComplete(true);
        setQuestionAnswer('');
      } else {
        setNextQuestion(result.question);
        setInterviewComplete(false);
        const field = currentDraft
          ? findPinnedQuestionMapping(result.question, currentDraft.forms)?.field ?? null
          : null;
        setQuestionAnswer(field ? initialFieldValue(field, null) : '');
      }
      setTurnMessage(null);
    } catch (error) {
      setNextQuestion(null);
      setInterviewComplete(false);
      setQuestionError(
        error instanceof Error
          ? `Question selection is unavailable: ${error.message}`
          : 'Question selection is unavailable. Retry when the service is available.',
      );
    } finally {
      setQuestionLoading(false);
    }
  }, [revisionId]);

  useEffect(() => {
    if (draft?.status === 'draft') {
      void loadNextQuestion();
    }
  }, [draft?.status, draft?.version, loadNextQuestion]);

  const submitInterviewAnswer = async () => {
    if (!draft || !revisionId || !nextQuestion || !session?.user.id) {
      return;
    }
    const mapping = findPinnedQuestionMapping(nextQuestion, draft.forms);
    if (!mapping) {
      setQuestionError('This question is not in the pinned form definitions, so it is read-only and cannot be saved as an answer.');
      return;
    }
    const { field } = mapping;

    const parsed = validateFieldValue(field, questionAnswer);
    if (!parsed.ok) {
      setQuestionError(parsed.error);
      return;
    }
    const text = questionAnswerText(field, parsed.value);
    if (!text) {
      setQuestionError('Enter an answer before submitting this turn.');
      return;
    }

    const fieldId = formFieldId(mapping.formKey, nextQuestion.fieldKey);
    if (dirtyFieldsRef.current[fieldId]) {
      setQuestionError('Save or discard this field’s existing edits before answering it in the interview.');
      return;
    }
    if (fieldId === narrativeId && narrativeDirty) {
      setQuestionError('Save the incident narrative first so this answer uses the current server revision.');
      return;
    }

    const questionId = `${nextQuestion.formKey ?? ''}:${nextQuestion.fieldKey}`;
    if (pendingTurnRef.current?.questionId !== questionId || pendingTurnRef.current.text !== text) {
      pendingTurnRef.current = { questionId, text, clientTurnId: createClientTurnId() };
    }
    const pendingTurn = pendingTurnRef.current;
    setSubmittingTurn(true);
    setQuestionError(null);
    setTurnMessage(null);
    let turnAccepted = false;
    try {
      await processIncidentTextTurn({
        revisionId,
        clientTurnId: pendingTurn.clientTurnId,
        text: pendingTurn.text,
      });
      turnAccepted = true;
      const draftAfterTurn = await loadIncidentDraft(revisionId);
      const nextVersion = await saveIncidentFieldAnswer(
        draftAfterTurn,
        mapping.formKey,
        nextQuestion.fieldKey,
        parsed.value as FormJsonValue,
        draftAfterTurn.version,
      );
      pendingTurnRef.current = null;
      setDraft((current) => current ? { ...current, version: nextVersion } : current);
      markFieldDirty(fieldId, false);
      await persistCurrentEdits(nextVersion);
      let cacheCleanupError: string | null = null;
      if (fieldId === narrativeId && draft.fieldKey) {
        try {
          await clearCachedDraftText(session.user.id, revisionId, draft.fieldKey);
        } catch {
          cacheCleanupError = 'The answer was saved, but local narrative cache cleanup failed.';
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
          fieldValuesRef.current = next;
          return next;
        });
        setTurnMessage(cacheCleanupError ?? 'Turn accepted and answer saved.');
        if (cacheCleanupError) {
          setErrorText(cacheCleanupError);
        }
      } catch {
        setNeedsRefresh(true);
        setTurnMessage('Turn accepted and answer saved to the server.');
        setErrorText('The answer was saved, but the latest form state could not be reloaded.');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The turn could not be submitted.';
      if (turnAccepted) {
        setNeedsRefresh(true);
      } else {
        try {
          setDraft(await loadIncidentDraft(revisionId));
        } catch {
          // Keep the draft visible; retrying with the stable turn ID remains safe.
        }
      }
      setQuestionError(
        turnAccepted
          ? `The turn was accepted, but its answer was not saved. Reload the server form before retrying; the same turn ID will be reused. ${message}`
          : `Turn processing is unavailable; the answer was not saved. ${message}`,
      );
    } finally {
      setSubmittingTurn(false);
    }
  };

  const saveInterviewAnswerState = async (answerState: PersistedAnswerState) => {
    if (
      !draft ||
      !nextQuestion ||
      !revisionId ||
      !nextQuestion.answerStates.includes(answerState)
    ) {
      return;
    }
    const mapping = findPinnedQuestionMapping(nextQuestion, draft.forms);
    if (!mapping) {
      setQuestionError('This graph node has no unique active pinned-field mapping and cannot save an answer status.');
      return;
    }
    const fieldId = formFieldId(mapping.formKey, nextQuestion.fieldKey);
    if (dirtyFieldsRef.current[fieldId]) {
      setQuestionError('Save or discard this field’s current edit before recording a response status.');
      return;
    }
    if (fieldId === narrativeId && narrativeDirty) {
      setQuestionError('Save the incident narrative first so this status uses the current server revision.');
      return;
    }
    setSubmittingTurn(true);
    setQuestionError(null);
    setTurnMessage(null);
    try {
      const nextVersion = await saveIncidentFieldAnswer(
        draft,
        mapping.formKey,
        nextQuestion.fieldKey,
        null,
        draft.version,
        answerState,
      );
      await persistCurrentEdits(nextVersion);
      const refreshedDraft = await loadIncidentDraft(revisionId);
      const refreshedValues = getFieldValues(refreshedDraft);
      savedValuesRef.current = refreshedValues;
      setDraft(refreshedDraft);
      setFieldValues((current) => {
        const next = { ...refreshedValues };
        for (const [dirtyId, dirty] of Object.entries(dirtyFieldsRef.current)) {
          if (dirty) next[dirtyId] = current[dirtyId];
        }
        fieldValuesRef.current = next;
        return next;
      });
      setTurnMessage(
        `${answerStateLabel(answerState)} saved. The planner will continue without treating it as a confirmed fact.`,
      );
      setSaveMessage(null);
      if (nextVersion !== refreshedDraft.version) {
        setNeedsRefresh(true);
        setQuestionError('The answer state was saved, but the revision changed again. Reload before continuing.');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not save this answer state.';
      setQuestionError(message);
      if (message.includes('changed on the server')) setNeedsRefresh(true);
    } finally {
      setSubmittingTurn(false);
    }
  };

  const useCurrentLocation = async () => {
    setLocationLoading(true);
    setDetailMessage(null);
    setLocationError(null);
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== 'granted') {
        setDetailMessage('Location permission was not granted. You can enter a place manually.');
        return;
      }

      const current = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      const [address] = await Location.reverseGeocodeAsync(current.coords);
      const addressParts = address
        ? [
          address.name,
          address.street,
          address.city,
          address.region,
          address.postalCode,
        ].filter((part): part is string => Boolean(part?.trim()))
        : [];
      const coordinates = current.coords;
      const label = addressParts.length
        ? [...new Set(addressParts)].join(', ')
        : `${coordinates.latitude.toFixed(5)}, ${coordinates.longitude.toFixed(5)}`;
      const nextLocation: FormJsonValue = {
        label,
        latitude: coordinates.latitude,
        longitude: coordinates.longitude,
        accuracy: coordinates.accuracy,
        captured_at: new Date(current.timestamp).toISOString(),
      };

      setGpsLocation(nextLocation);
      updateLocalFieldValue(locationFieldId, label);
      setFieldErrors((currentErrors) => {
        const next = { ...currentErrors };
        delete next[locationFieldId];
        return next;
      });
      markFieldDirty(locationFieldId, true);
      setDetailMessage(
        addressParts.length
          ? `Current location ready${coordinates.accuracy !== null ? ` · ±${Math.round(coordinates.accuracy)} m` : ''}. Confirm or edit it before saving.`
          : 'Address lookup was unavailable; current coordinates are ready. Confirm or edit them before saving.',
      );
    } catch (error) {
      setLocationError(`${errorMessage(error, 'Could not get the current location.')} You can enter a place manually.`);
    } finally {
      setLocationLoading(false);
    }
  };

  const saveIncidentDetailsEdits = async () => {
    if (!draft || draft.status !== 'draft' || !revisionId) return;
    const occurredAtInput = fieldValues[occurredAtFieldId];
    const locationInput = fieldValues[locationFieldId];
    const occurredAtText = typeof occurredAtInput === 'string' ? occurredAtInput.trim() : '';
    const locationText = typeof locationInput === 'string' ? locationInput : '';
    let occurredAt: string | null = null;
    if (occurredAtText) {
      const timestamp = new Date(occurredAtText).getTime();
      if (!Number.isFinite(timestamp)) {
        setFieldErrors((current) => ({ ...current, [occurredAtFieldId]: 'Enter a valid local date and time.' }));
        return;
      }
      occurredAt = new Date(timestamp).toISOString();
    }

    const savedLocationLabel = formatLocation(draft.location)?.trim() ?? '';
    const existingLocation = locationText.trim() === savedLocationLabel ? draft.location : null;
    const location = gpsLocation ?? locationValue(existingLocation, locationText);
    setSavingFieldId('incident-details');
    setDetailMessage(null);
    setErrorText(null);
    try {
      const nextVersion = await saveIncidentDetails(draft, occurredAt, location);
      markFieldDirty(occurredAtFieldId, false);
      markFieldDirty(locationFieldId, false);
      setGpsLocation(null);
      savedValuesRef.current = {
        ...savedValuesRef.current,
        [occurredAtFieldId]: toLocalDateTimeInput(occurredAt),
        [locationFieldId]: locationText.trim(),
      };
      await persistCurrentEdits(nextVersion);
      const refreshed = await refreshDraftPreservingDirty();
      setDetailMessage(`Occurred time and location saved on revision ${refreshed.version}.`);
    } catch (error) {
      const message = errorMessage(error, 'Could not save incident details.');
      setErrorText(message);
      if (message.includes('changed on the server')) setNeedsRefresh(true);
    } finally {
      setSavingFieldId(null);
    }
  };

  const addRepeatedGroup = async (form: IncidentForm, groupKey: string) => {
    if (!draft || draft.status !== 'draft') return;
    setCreatingGroup(`${form.formKey}:${groupKey}`);
    setErrorText(null);
    try {
      const position = draft.groups
        .filter((group) => group.formKey === form.formKey && group.groupKey === groupKey)
        .reduce((maximum, group) => Math.max(maximum, group.position), -1) + 1;
      await createIncidentAnswerGroup(draft, form.formKey, groupKey, position);
      const nextVersion = draft.version + 1;
      await persistCurrentEdits(nextVersion);
      await refreshDraftPreservingDirty();
    } catch (error) {
      const message = errorMessage(error, 'Could not add this repeated group.');
      setErrorText(message);
      if (message.includes('changed on the server')) setNeedsRefresh(true);
    } finally {
      setCreatingGroup(null);
    }
  };

  const removeRepeatedGroup = async (group: IncidentAnswerGroup) => {
    if (!draft || draft.status !== 'draft') return;
    const hasUnsavedGroupValues = Object.entries(dirtyFieldsRef.current).some(([fieldId, dirty]) => {
      const identity = parseAnswerFieldId(fieldId);
      return dirty && identity?.[2] === group.id;
    });
    if (hasUnsavedGroupValues) {
      setErrorText('Save or discard this repeated item’s unsaved fields before removing it.');
      return;
    }

    setDeletingGroup(group.id);
    setErrorText(null);
    try {
      const nextVersion = await deleteIncidentAnswerGroup(draft, group.id);
      await persistCurrentEdits(nextVersion);
      await refreshDraftPreservingDirty();
    } catch (error) {
      const message = errorMessage(error, 'Could not remove this repeated item.');
      setErrorText(message);
      if (message.includes('changed on the server')) setNeedsRefresh(true);
    } finally {
      setDeletingGroup(null);
    }
  };

  const confirmRemoveRepeatedGroup = (group: IncidentAnswerGroup, label: string) => {
    Alert.alert(
      `Remove ${label}?`,
      'Saved answers in this item will be deleted from the draft.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: () => void removeRepeatedGroup(group) },
      ],
    );
  };

  const uploadPhoto = async (
    evidence: Pick<IncidentEvidence, 'id' | 'objectPath'>,
    uri: string,
    contentType: string,
  ) => {
    setPhotoUploads((current) => ({
      ...current,
      [evidence.id]: { uri, contentType, status: 'uploading' },
    }));
    try {
      const response = await fetch(uri);
      if (!response.ok) throw new Error('The captured photo could not be read from this device.');
      const blob = await response.blob();
      await uploadIncidentEvidenceFile(evidence.objectPath, blob, contentType);
      const finalized = await finalizeIncidentEvidence(evidence.id);
      if (finalized.uploadStatus !== 'uploaded') {
        throw new Error('The server could not verify this photo. Capture a replacement or retry the upload.');
      }
      setPhotoUploads((current) => ({
        ...current,
        [evidence.id]: { uri, contentType, status: 'uploaded' },
      }));
      await persistCurrentEdits(finalized.revisionVersion);
      await refreshDraftPreservingDirty();
    } catch (error) {
      setPhotoUploads((current) => ({
        ...current,
        [evidence.id]: { uri, contentType, status: 'failed' },
      }));
      throw error;
    }
  };

  const captureIncidentPhoto = async () => {
    if (!draft || draft.status !== 'draft') return;
    if (Platform.OS === 'web') {
      setPhotoError('Incident photo capture is available on an iOS or Android device.');
      return;
    }
    setPhotoBusy(true);
    setPhotoError(null);
    let createdEvidenceId: string | null = null;
    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        setPhotoError('Camera permission is needed to capture incident evidence. Your draft is unchanged.');
        return;
      }
      const capture = await ImagePicker.launchCameraAsync({
        mediaTypes: ['images'],
        quality: 0.8,
      });
      if (capture.canceled || !capture.assets[0]) return;

      const asset = capture.assets[0];
      const response = await fetch(asset.uri);
      if (!response.ok) throw new Error('The captured photo could not be read from this device.');
      const blob = await response.blob();
      if (blob.size <= 0 || blob.size > 50 * 1024 * 1024) {
        throw new Error('The photo must be smaller than 50 MB. Capture a lower-resolution image and retry.');
      }
      const contentType = asset.mimeType ?? blob.type ?? 'image/jpeg';
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(contentType)) {
        throw new Error('The captured image format is not supported. Use JPEG, PNG, or WebP.');
      }

      const evidence = await createIncidentEvidence(
        draft,
        blob.size,
        asset.fileName ?? 'Incident photo',
      );
      createdEvidenceId = evidence.evidenceId;
      setDraft((current) => current ? { ...current, version: evidence.revisionVersion } : current);
      await persistCurrentEdits(evidence.revisionVersion);
      await refreshDraftPreservingDirty();
      await uploadPhoto(
        { id: evidence.evidenceId, objectPath: evidence.objectPath },
        asset.uri,
        contentType,
      );
    } catch (error) {
      if (createdEvidenceId) {
        try {
          await refreshDraftPreservingDirty();
        } catch {
          // Keep the captured file available for retry even if the status refresh fails.
        }
      }
      setPhotoError(errorMessage(error, 'The incident photo could not be uploaded. Retry without losing the captured image.'));
    } finally {
      setPhotoBusy(false);
    }
  };

  const retryPhotoUpload = async (evidence: IncidentEvidence) => {
    const local = photoUploads[evidence.id];
    if (!local || !draft || draft.status !== 'draft') {
      setPhotoError('The original image is no longer available on this device. Capture a replacement photo.');
      return;
    }
    setPhotoBusy(true);
    setPhotoError(null);
    try {
      const finalized = await finalizeIncidentEvidence(evidence.id);
      if (finalized.uploadStatus === 'uploaded') {
        setPhotoUploads((current) => ({
          ...current,
          [evidence.id]: { ...local, status: 'uploaded' },
        }));
        await persistCurrentEdits(finalized.revisionVersion);
        await refreshDraftPreservingDirty();
        return;
      }
      setDraft((current) => current ? { ...current, version: finalized.revisionVersion } : current);
      await persistCurrentEdits(finalized.revisionVersion);
      await uploadPhoto(evidence, local.uri, local.contentType);
    } catch (error) {
      setPhotoError(errorMessage(error, 'Photo upload failed. Retry when the connection is available.'));
    } finally {
      setPhotoBusy(false);
    }
  };

  const checkSubmissionReadiness = async () => {
    if (!draft || draft.status !== 'draft' || !interviewComplete) return;
    if (
      Object.values(dirtyFieldsRef.current).some(Boolean)
      || cacheConflict
      || editCacheConflict.kind === 'conflict'
      || needsRefresh
    ) {
      setSubmitError('Save or resolve all unsaved edits and reload stale server state before checking readiness.');
      return;
    }

    setReadinessLoading(true);
    setSubmitError(null);
    setSubmitIssues([]);
    setReadinessMessage(null);
    try {
      const result = await checkIncidentSubmissionReadiness(draft);
      if (result.revisionId !== draft.revisionId || result.version !== draft.version) {
        throw new Error('The server checked a different incident revision. Reload before continuing.');
      }
      setReadinessVersion(result.version);
      if (result.kind === 'blocked') {
        setSubmitIssues(result.issues);
        setReadinessMessage('The server found requirements that must be completed before device confirmation.');
      } else {
        setReadinessMessage('The server reports this revision is ready. Confirm on this device to submit it.');
      }
    } catch (error) {
      setReadinessVersion(null);
      setSubmitError(errorMessage(error, 'Could not check server readiness.'));
    } finally {
      setReadinessLoading(false);
    }
  };

  const submitReport = async () => {
    if (!draft || draft.status !== 'draft' || !revisionId || !session?.user.id) return;
    if (submitInFlightRef.current) return;
    if (
      Object.values(dirtyFieldsRef.current).some(Boolean)
      || cacheConflict
      || editCacheConflict.kind === 'conflict'
      || needsRefresh
    ) {
      setSubmitError('Save or resolve all unsaved edits and reload any stale server state before confirming submission.');
      return;
    }
    if (!interviewComplete) {
      setSubmitError('Complete the server-selected interview questions before submitting.');
      return;
    }
    if (
      !pendingSubmission
      && (readinessVersion !== draft.version || submitIssues.length > 0)
    ) {
      setSubmitError('Check server readiness for the latest saved revision before confirming submission.');
      return;
    }
    if (pendingSubmission && pendingSubmission.expectedVersion !== draft.version) {
      setSubmitError('This confirmation belongs to an older revision. Reload the report and confirm again.');
      return;
    }

    submitInFlightRef.current = true;
    setSubmitting(true);
    setSubmitError(null);
    setSubmitIssues([]);
    try {
      let confirmation = pendingSubmission;
      if (!confirmation) {
        if (Platform.OS === 'web') {
          throw new Error('Confirm submission on an iOS or Android device using its local authentication.');
        }
        const securityLevel = await LocalAuthentication.getEnrolledLevelAsync();
        if (securityLevel === LocalAuthentication.SecurityLevel.NONE) {
          throw new Error('Set up device biometrics or a device passcode before confirming this report.');
        }
        const authMethod = securityLevel === LocalAuthentication.SecurityLevel.SECRET
          ? 'device_passcode'
          : 'biometric';
        const authentication = await LocalAuthentication.authenticateAsync({
          promptMessage: 'Confirm and submit this incident report',
          cancelLabel: 'Cancel',
          disableDeviceFallback: authMethod === 'biometric',
        });
        if (!authentication.success) {
          throw new Error(`Device confirmation was not completed (${authentication.error}). The report is still a draft.`);
        }
        confirmation = {
          signatureReference: createSignatureReference(),
          expectedVersion: draft.version,
          authMethod,
          deviceDescription: `${Platform.OS} ${String(Platform.Version)} device`,
          createdAt: new Date().toISOString(),
        };
        await writePendingSubmission(session.user.id, revisionId, confirmation);
        setPendingSubmission(confirmation);
      }

      const result = await submitIncident({
        p_incident_revision_id: revisionId,
        p_expected_version: confirmation.expectedVersion,
        p_signature_reference: confirmation.signatureReference,
        p_auth_method: confirmation.authMethod,
        p_device_description: confirmation.deviceDescription,
      });
      if (result.kind === 'blocked') {
        await clearPendingSubmission(session.user.id, revisionId);
        setPendingSubmission(null);
        setSubmitIssues(result.issues);
        setReadinessVersion(result.version);
        setReadinessMessage('The server found requirements that must be completed before device confirmation.');
        setSubmitError('The server found requirements that must be completed before submission.');
        return;
      }
      const submittedDraft = await loadIncidentDraft(revisionId);
      await clearPendingSubmission(session.user.id, revisionId);
      setPendingSubmission(null);
      setSubmitError(null);
      setSubmitIssues([]);
      setReadinessVersion(null);
      setReadinessMessage(null);
      setDraft(submittedDraft);
      setSaveMessage(`Submitted · awaiting review · reference ${result.reportReference}`);
    } catch (error) {
      const message = errorMessage(error, 'Could not submit the incident report.');
      setSubmitError(message);
      if (message.includes('changed on the server')) {
        setNeedsRefresh(true);
      }
    } finally {
      submitInFlightRef.current = false;
      setSubmitting(false);
    }
  };

  const reloadServerForm = async () => {
    if (!draft || !revisionId || !session?.user.id) {
      return;
    }
    try {
      await persistCurrentEdits(draft.version);
    } catch (error) {
      setErrorText(errorMessage(error, 'Could not preserve local edits before reloading.'));
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
      setLocalMessage('Server form reloaded. Unsaved edits were preserved for review before saving against the current revision.');
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
        <Button
          mode="text"
          icon="arrow-left"
          accessibilityLabel={backLabel}
          onPress={handleBack}
        >
          {backLabel}
        </Button>
      </SafeAreaView>
    );
  }

  const readOnly = draft.status === 'submitted';
  const controlsDisabled = readOnly
    || savingFieldId !== null
    || needsRefresh
    || cacheConflict !== null
    || editCacheConflict.kind === 'conflict'
    || readinessLoading
    || submitting
    || photoBusy
    || creatingGroup !== null
    || deletingGroup !== null;
  const questionMapping = nextQuestion
    ? findPinnedQuestionMapping(nextQuestion, draft.forms)
    : null;
  const questionField = questionMapping?.field ?? null;
  const questionUsesFallback = /fallback|rule/i.test(nextQuestion?.selectionSource ?? '');
  const historyAnswer = historyAnswerId
    ? draft.answers.find((answer) => answerIdentity(answer) === historyAnswerId) ?? null
    : null;
  const historyForm = historyAnswer
    ? draft.forms.find((form) => form.formKey === historyAnswer.formKey) ?? null
    : null;
  const historyField = historyAnswer
    ? findAnswerField(
      draft,
      historyAnswer.formKey,
      historyAnswer.fieldKey,
      historyAnswer.groupInstanceId,
    )
    : null;
  const historyValueId = historyAnswer
    ? answerValueId(historyAnswer.formKey, historyAnswer.fieldKey, historyAnswer.groupInstanceId)
    : null;
  const detailsDirty = dirtyFields[occurredAtFieldId] === true || dirtyFields[locationFieldId] === true;
  const returnToPreviousAnswer = () => {
    const previousAnswer = draft.answers.at(-1);
    if (!previousAnswer) return;
    setHistoryAnswerId(answerIdentity(previousAnswer));
    setTimeout(() => scrollRef.current?.scrollTo({ y: historyOffsetRef.current, animated: true }), 0);
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.stickyHeader}>
          <View style={styles.headerContent}>
            <Button
              mode="text"
              icon="arrow-left"
              accessibilityLabel={backLabel}
              onPress={handleBack}
              style={styles.backButton}
            >
              {backLabel}
            </Button>
            <Text variant="labelLarge" style={styles.revisionLabel}>
              {readOnly ? 'Submitted' : 'Draft'} · revision {draft.version}
            </Text>
          </View>
        </View>
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
        {readOnly ? (
          <Card>
            <Card.Content style={styles.cardContent}>
              <Text variant="titleLarge">Submitted · awaiting review</Text>
              <Text variant="bodyMedium">This report has been submitted and is read-only.</Text>
              {draft.reportReference ? (
                <Text variant="titleMedium">{`Report reference ${draft.reportReference}`}</Text>
              ) : (
                <HelperText type="error" visible>
                  The submitted report reference is unavailable. Retry loading the server report.
                </HelperText>
              )}
              <Text variant="bodySmall">Driver confirmation was recorded on the server. No biometric data is uploaded.</Text>
            </Card.Content>
          </Card>
        ) : null}
        {editCacheConflict.kind === 'conflict' ? (
          <Card>
            <Card.Content style={styles.cardContent}>
              <Text variant="titleMedium">
                {draft.status === 'submitted' ? 'Unsaved device edits' : 'This report changed on the server'}
              </Text>
              <Text variant="bodySmall">
                {draft.status === 'submitted'
                  ? 'These edits were never submitted and cannot change the submitted report.'
                  : `Local edits were saved against revision ${editCacheConflict.expectedVersion}; the server is now at revision ${editCacheConflict.currentVersion}. Compare both copies before saving.`}
              </Text>
              {editCacheConflict.dirtyFieldIds.map((fieldId) => {
                const parts = parseAnswerFieldId(fieldId);
                const form = parts
                  ? draft.forms.find((candidate) => candidate.formKey === parts[0])
                  : null;
                const field = parts
                  ? findAnswerField(draft, parts[0], parts[1], parts[2] ?? null)
                  : null;
                return (
                  <View key={`edit-conflict:${fieldId}`} style={styles.field}>
                    <Text variant="labelLarge">
                      {field
                        ? `${formTitle(form as IncidentForm)} · ${getFieldPrompt(field)}`
                        : fieldId === occurredAtFieldId
                          ? 'Occurred time'
                          : fieldId === locationFieldId
                            ? 'Incident location'
                            : fieldId}
                    </Text>
                    <Text variant="bodySmall">{`Server: ${displayConflictValue(field, savedValuesRef.current[fieldId])}`}</Text>
                    <Text variant="bodySmall">{`This device: ${displayConflictValue(field, editCacheConflict.values[fieldId])}`}</Text>
                  </View>
                );
              })}
              {draft.status === 'draft' ? (
                <Button mode="contained" onPress={() => void keepUnsavedEdits()}>
                  Keep my unsaved edits
                </Button>
              ) : null}
              <Button mode="outlined" onPress={() => void useServerEdits()}>
                {draft.status === 'submitted' ? 'Discard unsaved edits' : 'Use current server values'}
              </Button>
            </Card.Content>
          </Card>
        ) : null}
        <Card>
          <Card.Content style={styles.cardContent}>
            <Text variant="titleMedium">Confirm incident details</Text>
            <Text variant="bodySmall">
              Confirm the local date and time, then enter a place or add your current location. GPS is optional.
            </Text>
            <DateTimeFieldEditor
              label="Occurred at (local date and time)"
              type="datetime"
              value={typeof fieldValues[occurredAtFieldId] === 'string'
                ? fieldValues[occurredAtFieldId] as string
                : ''}
              onChange={(value) => {
                updateLocalFieldValue(occurredAtFieldId, value);
                setFieldErrors((current) => ({ ...current, [occurredAtFieldId]: '' }));
                markFieldDirty(
                  occurredAtFieldId,
                  !draft.occurredAt
                    || new Date(draft.occurredAt).getTime() !== new Date(value).getTime(),
                );
                setDetailMessage(null);
              }}
              disabled={controlsDisabled}
            />
            {fieldErrors[occurredAtFieldId] ? (
              <HelperText type="error" visible>{fieldErrors[occurredAtFieldId]}</HelperText>
            ) : null}
            <TextInput
              mode="outlined"
              label="Incident location"
              accessibilityLabel="Incident location"
              value={typeof fieldValues[locationFieldId] === 'string'
                ? fieldValues[locationFieldId] as string
                : ''}
              onChangeText={(value) => {
                updateLocalFieldValue(locationFieldId, value);
                setGpsLocation(null);
                setLocationError(null);
                markFieldDirty(
                  locationFieldId,
                  gpsLocation !== null || (formatLocation(draft.location) ?? '') !== value.trim(),
                );
                setDetailMessage(null);
              }}
              disabled={controlsDisabled}
              placeholder="Enter a place, address, or highway marker"
            />
            {!readOnly ? (
              <Button
                mode="outlined"
                icon="crosshairs-gps"
                onPress={() => void useCurrentLocation()}
                disabled={controlsDisabled || locationLoading}
                loading={locationLoading}
              >
                Use current location
              </Button>
            ) : null}
            {locationError ? <HelperText type="error" visible>{locationError}</HelperText> : null}
            <Text variant="bodySmall">
              {gpsLocation
                ? 'Current GPS location is selected but has not been saved.'
                : draft.location
                  ? `Saved location: ${formatLocation(draft.location) ?? 'Location details available'}`
                  : 'No location is saved yet.'}
            </Text>
            {!readOnly ? (
              <Button
                mode="contained"
                onPress={() => void saveIncidentDetailsEdits()}
                disabled={!detailsDirty || controlsDisabled || locationLoading}
                loading={savingFieldId === 'incident-details'}
              >
                Save and confirm details
              </Button>
            ) : null}
            {detailMessage ? <HelperText type="info" visible>{detailMessage}</HelperText> : null}
          </Card.Content>
        </Card>
        {!readOnly ? (
          <Card>
            <Card.Content style={styles.cardContent}>
              <Text variant="titleMedium">Incident interview</Text>
              <Text variant="bodySmall">
                Text answers are sent to the server turn processor and saved only after it accepts the turn. Voice recording and provider-backed transcription are deferred and unavailable here.
              </Text>
              {questionLoading ? (
                <ActivityIndicator accessibilityLabel="Selecting next question" />
              ) : null}
              {interviewComplete ? (
                <HelperText type="info" visible>
                  Interview complete. The server reports that no eligible questions remain.
                </HelperText>
              ) : null}
              {questionError ? <HelperText type="error" visible>{questionError}</HelperText> : null}
              {nextQuestion ? (
                <>
                  {questionUsesFallback ? (
                    <HelperText type="info" visible>
                      The question planner used the server’s deterministic rule-order fallback.
                    </HelperText>
                  ) : null}
                  {questionField && questionMapping ? (
                    <>
                      <IncidentFieldEditor
                        field={questionField}
                        value={questionAnswer}
                        onChange={(value) => {
                          setQuestionAnswer(value);
                          setQuestionError(null);
                        }}
                        disabled={controlsDisabled || questionLoading || submittingTurn}
                        readOnly={questionField.configurationError !== null}
                        promptOverride={nextQuestion.prompt}
                      />
                      <Button
                        mode="contained"
                        onPress={() => void submitInterviewAnswer()}
                        disabled={
                          controlsDisabled
                          || questionLoading
                          || submittingTurn
                          || questionField.configurationError !== null
                        }
                        loading={submittingTurn}
                      >
                        Submit text answer
                      </Button>
                      <Text variant="labelMedium">Or save a response status</Text>
                      <View style={styles.choiceRow}>
                        {nextQuestion.answerStates.map((answerState) => {
                          const label = answerStateActions[answerState];
                          return label ? (
                            <Button
                              key={answerState}
                              mode="outlined"
                              onPress={() => void saveInterviewAnswerState(answerState)}
                              disabled={controlsDisabled || questionLoading || submittingTurn}
                            >
                              {label}
                            </Button>
                          ) : null;
                        })}
                      </View>
                      {nextQuestion.required ? (
                        <HelperText type="info" visible>
                          A saved non-confirmed status advances the interview but remains a blocker for this required or safety-critical answer.
                        </HelperText>
                      ) : null}
                    </>
                  ) : (
                    <>
                      <Text variant="titleSmall">{nextQuestion.prompt}</Text>
                      {nextQuestion.options.map((option) => (
                        <Text key={option.value} variant="bodyMedium">• {option.label}</Text>
                      ))}
                      <HelperText type="error" visible>
                        This graph node has no unique pinned-field mapping. It cannot be answered or skipped until a definition maps it; no answer row will be written.
                      </HelperText>
                      {nextQuestion.required ? (
                        <HelperText type="error" visible>
                          This required or safety-critical question remains a submission blocker.
                        </HelperText>
                      ) : null}
                    </>
                  )}
                </>
              ) : null}
              {turnMessage ? <HelperText type="info" visible>{turnMessage}</HelperText> : null}
              {draft.answers.length ? (
                <Button mode="outlined" onPress={returnToPreviousAnswer} disabled={questionLoading || submittingTurn}>
                  Back to previous answer
                </Button>
              ) : null}
              <Button
                mode="outlined"
                onPress={() => void loadNextQuestion()}
                disabled={questionLoading || submittingTurn}
              >
                Refresh question
              </Button>
            </Card.Content>
          </Card>
        ) : null}
        <Card onLayout={(event) => {
          historyOffsetRef.current = event.nativeEvent.layout.y;
        }}>
          <Card.Content style={styles.cardContent}>
            <Text variant="titleMedium">Interview history · edit a previous answer</Text>
            <Text variant="bodySmall">
              Select a saved response to correct it. The server re-evaluates form activation and the next eligible question after every saved correction.
            </Text>
            {!draft.answers.length ? (
              <Text variant="bodyMedium">No interview answers have been saved yet.</Text>
            ) : null}
            {draft.answers.map((answer) => {
              const identity = answerIdentity(answer);
              const form = draft.forms.find((candidate) => candidate.formKey === answer.formKey);
              const field = findAnswerField(draft, answer.formKey, answer.fieldKey, answer.groupInstanceId);
              return (
                <View key={identity} style={styles.historyRow}>
                  <View style={styles.historyText}>
                    <Text variant="labelLarge">
                      {`${form ? formTitle(form) : answer.formKey} · ${field ? getFieldPrompt(field) : answer.fieldKey}`}
                    </Text>
                    <Text variant="bodySmall">
                      {`${answerStateLabel(answer.answerState)} · ${field ? displayAnswer(field, answer.value) : 'Saved response'}`}
                    </Text>
                  </View>
                  {!readOnly ? (
                    <Button
                      compact
                      mode={historyAnswerId === identity ? 'contained' : 'outlined'}
                      onPress={() => setHistoryAnswerId(historyAnswerId === identity ? null : identity)}
                    >
                      {historyAnswerId === identity ? 'Close' : 'Edit'}
                    </Button>
                  ) : null}
                </View>
              );
            })}
            {historyAnswer && historyForm && historyField && historyValueId ? (
              <View style={styles.historyEditor}>
                <Text variant="titleSmall">
                  {`${formTitle(historyForm)} · ${getFieldPrompt(historyField)}`}
                </Text>
                <IncidentFieldEditor
                  field={historyField}
                  value={fieldValues[historyValueId] ?? initialFieldValue(historyField, historyAnswer.value)}
                  onChange={(value) => changeAnswerValue(
                    historyForm,
                    historyField,
                    value,
                    historyAnswer.groupInstanceId,
                  )}
                  disabled={controlsDisabled || !historyForm.definition}
                  readOnly={historyField.configurationError !== null}
                  onBlur={() => validateEditedField(
                    historyForm,
                    historyField,
                    historyAnswer.groupInstanceId,
                  )}
                />
                {fieldErrors[historyValueId] ? (
                  <HelperText type="error" visible>{fieldErrors[historyValueId]}</HelperText>
                ) : null}
                {historyForm.activationStatus === 'triggered' ? (
                  dirtyFields[historyValueId] ? (
                    <Button
                      mode="contained"
                      onPress={() => void saveField(
                        historyForm,
                        historyField,
                        historyAnswer.groupInstanceId,
                      )}
                      disabled={controlsDisabled}
                      loading={savingFieldId === historyValueId}
                    >
                      Save correction
                    </Button>
                  ) : null
                ) : (
                  <HelperText type="info" visible>
                    This form is no longer triggered by confirmed answers. Its previous response is retained for review; update the triggering answer first.
                  </HelperText>
                )}
              </View>
            ) : null}
          </Card.Content>
        </Card>
        <Card>
          <Card.Content style={styles.cardContent}>
            <Text variant="titleMedium">Incident photos and evidence</Text>
            <Text variant="bodySmall">
              Capture clear photos of the scene, vehicle or property damage, or injury when applicable. Uploads are private to this report; server requirements determine whether a photo is required.
            </Text>
            {!readOnly ? (
              <Button
                mode="contained"
                onPress={() => void captureIncidentPhoto()}
                disabled={photoBusy || controlsDisabled}
                loading={photoBusy}
              >
                Capture incident photo
              </Button>
            ) : null}
            {photoBusy ? <ProgressBar indeterminate /> : null}
            {photoError ? <HelperText type="error" visible>{photoError}</HelperText> : null}
            {!draft.evidence.length ? (
              <Text variant="bodyMedium">No incident evidence has been uploaded.</Text>
            ) : null}
            {draft.evidence.map((evidence) => {
              const local = photoUploads[evidence.id];
              const status = local?.status ?? evidence.uploadStatus;
              return (
                <View key={evidence.id} style={styles.evidenceRow}>
                  <View style={styles.evidenceDetails}>
                    <Text variant="labelLarge">
                      {evidence.description?.trim() || 'Incident photo'}
                    </Text>
                    <Text variant="bodySmall">
                      {`${evidence.mediaType} · ${Math.ceil(evidence.sizeBytes / 1024)} KB · ${status}`}
                    </Text>
                    {status === 'uploading' ? <ProgressBar indeterminate /> : null}
                    {evidence.signedUrl ? (
                      <Image
                        source={{ uri: evidence.signedUrl }}
                        accessibilityLabel="Uploaded incident evidence"
                        resizeMode="cover"
                        style={styles.evidenceImage}
                      />
                    ) : evidence.previewError ? (
                      <HelperText type="error" visible>{evidence.previewError}</HelperText>
                    ) : evidence.uploadStatus === 'uploaded' ? (
                      <Text variant="bodySmall">Private preview unavailable. The uploaded evidence remains attached to this report.</Text>
                    ) : null}
                  </View>
                  {!readOnly && status !== 'uploaded' ? (
                    local ? (
                      <Button
                        compact
                        mode="outlined"
                        onPress={() => void retryPhotoUpload(evidence)}
                        disabled={photoBusy || controlsDisabled}
                      >
                        Retry upload
                      </Button>
                    ) : (
                      <Text variant="bodySmall">
                        This device no longer has the original image. Capture a replacement.
                      </Text>
                    )
                  ) : null}
                </View>
              );
            })}
          </Card.Content>
        </Card>
        <Card>
          <Card.Content style={styles.cardContent}>
            <Text variant="titleMedium">Report preview</Text>
            <Text variant="bodySmall">
              Preview saved details and answers at any time. Unfilled fields are omitted, and the server remains the source of submission requirements.
            </Text>
            <Button
              mode="outlined"
              icon={previewVisible ? 'eye-off-outline' : 'eye-outline'}
              accessibilityState={{ expanded: previewVisible }}
              onPress={() => setPreviewVisible((visible) => !visible)}
            >
              {previewVisible ? 'Hide report preview' : 'Preview saved answers'}
            </Button>
            {previewVisible ? (
              <View style={styles.previewContainer}>
                <Text variant="titleSmall">Incident details</Text>
                <View style={styles.previewAnswer}>
                  <Text variant="labelLarge">Occurred at</Text>
                  <Text variant="bodyMedium">
                    {formatDateControlValue(draft.occurredAt, 'datetime') ?? 'Not provided'}
                  </Text>
                </View>
                <View style={styles.previewAnswer}>
                  <Text variant="labelLarge">Location</Text>
                  <Text variant="bodyMedium">{formatLocation(draft.location) ?? 'Not provided'}</Text>
                </View>
                {draft.forms
                  .filter((form) => form.activationStatus === 'triggered')
                  .map((form) => {
                    const formAnswers = draft.answers.filter((answer) => answer.formKey === form.formKey);
                    const expanded = expandedPreviewForms[form.formKey] ?? false;
                    return (
                      <List.Accordion
                        key={`preview:${form.formKey}`}
                        title={formTitle(form)}
                        description={`${formAnswers.length} saved answers`}
                        expanded={expanded}
                        onPress={() => setExpandedPreviewForms((current) => ({
                          ...current,
                          [form.formKey]: !expanded,
                        }))}
                        left={(props) => <List.Icon {...props} icon="file-document-outline" />}
                        style={styles.previewAccordion}
                      >
                        {formAnswers.length ? formAnswers.map((answer) => {
                          const field = findAnswerField(
                            draft,
                            answer.formKey,
                            answer.fieldKey,
                            answer.groupInstanceId,
                          );
                          return (
                            <View key={answerIdentity(answer)} style={styles.previewAnswer}>
                              <Text variant="labelLarge">
                                {field ? getFieldPrompt(field) : answer.fieldKey}
                              </Text>
                              <Text variant="bodyMedium">
                                {field ? displayAnswer(field, answer.value) : 'Saved response'}
                              </Text>
                              <Text variant="bodySmall">
                                {`${answerStateLabel(answer.answerState)} · ${answer.source}`}
                              </Text>
                            </View>
                          );
                        }) : (
                          <HelperText type="info" visible>No form answers have been saved.</HelperText>
                        )}
                        {!readOnly ? (
                          <Button
                            mode="outlined"
                            icon="pencil-outline"
                            onPress={() => {
                              setExpandedForms((current) => ({ ...current, [form.formKey]: true }));
                              scrollRef.current?.scrollTo({
                                y: formOffsetsRef.current[form.formKey] ?? 0,
                                animated: true,
                              });
                            }}
                          >
                            {`Edit ${formTitle(form)}`}
                          </Button>
                        ) : null}
                      </List.Accordion>
                    );
                  })}
              </View>
            ) : null}
          </Card.Content>
        </Card>
        {(interviewComplete || readOnly) ? (
          <Card>
            <Card.Content style={styles.cardContent}>
              <Text variant="titleLarge">{readOnly ? 'Submitted report' : 'Review & submit'}</Text>
              <Text variant="bodySmall">
                Check server readiness for this revision before device confirmation. Submission validates again and will not proceed while anything is incomplete or unsaved.
              </Text>
              <Text variant="labelLarge">Applicable forms</Text>
              {draft.forms.filter((form) => form.activationStatus === 'triggered').length ? (
                draft.forms
                  .filter((form) => form.activationStatus === 'triggered')
                  .map((form) => (
                    <Chip key={`review:${form.formKey}`} compact>
                      {`${formTitle(form)} · pinned v${form.version}`}
                    </Chip>
                  ))
              ) : (
                <HelperText type="error" visible>
                  No form is currently triggered by confirmed answers. The server will reject incomplete submissions.
                </HelperText>
              )}
              <Text variant="labelLarge">Evidence review</Text>
              <Text variant="bodyMedium">
                {`${draft.evidence.filter((item) => item.uploadStatus === 'uploaded').length} uploaded · ${draft.evidence.filter((item) => item.uploadStatus !== 'uploaded').length} pending or failed`}
              </Text>
              {submitIssues.length ? (
                <View style={styles.field}>
                  <Text variant="labelLarge">Server-reported missing requirements</Text>
                  {submitIssues.map((issue, index) => (
                    <View
                      key={`${issue.formKey}:${issue.fieldKey}:${issue.groupInstanceId}:${index}`}
                      style={styles.issue}
                    >
                      <Text variant="labelLarge">{issueLabel(issue, draft)}</Text>
                      <HelperText type="error" visible>
                        {issue.message ?? 'Complete this server-required item before submitting.'}
                      </HelperText>
                      {issue.expectedMediaType ? (
                        <Text variant="bodySmall">
                          {`${issue.uploadedCount ?? 0} of ${issue.requiredCount ?? 1} ${issue.expectedMediaType} evidence items uploaded`}
                        </Text>
                      ) : null}
                      {issue.expectedType ? (
                        <Text variant="bodySmall">{`Expected response: ${issue.expectedType}`}</Text>
                      ) : null}
                      {issue.answerState ? (
                        <Text variant="bodySmall">{`Current answer status: ${issue.answerState}`}</Text>
                      ) : null}
                      {issue.provenance?.source ? (
                        <Text variant="bodySmall">{`Answer source: ${issue.provenance.source}`}</Text>
                      ) : null}
                      {issue.provenance?.confidence !== null
                        && issue.provenance?.confidence !== undefined ? (
                          <Text variant="bodySmall">{`Recorded confidence: ${Math.round(issue.provenance.confidence * 100)}%`}</Text>
                        ) : null}
                      {issueActionLabel(issue.action) ? (
                        <Chip compact>{issueActionLabel(issue.action)}</Chip>
                      ) : null}
                    </View>
                  ))}
                </View>
              ) : null}
              {submitError ? <HelperText type="error" visible>{submitError}</HelperText> : null}
              {readinessMessage ? <HelperText type="info" visible>{readinessMessage}</HelperText> : null}
              {readinessVersion !== null && readinessVersion !== draft.version ? (
                <HelperText type="info" visible>
                  This readiness result is for an older revision. Check again after saving the latest changes.
                </HelperText>
              ) : null}
              {!readOnly ? (
                <>
                  {pendingSubmission ? (
                    <HelperText type="info" visible>
                      A prior submission may have reached the server. Retrying reuses the saved confirmation reference to avoid a duplicate report.
                    </HelperText>
                  ) : null}
                  {!pendingSubmission ? (
                    <Button
                      mode="outlined"
                      onPress={() => void checkSubmissionReadiness()}
                      disabled={
                        readinessLoading
                        || submitting
                        || needsRefresh
                        || Object.values(dirtyFieldsRef.current).some(Boolean)
                        || cacheConflict !== null
                        || editCacheConflict.kind === 'conflict'
                      }
                      loading={readinessLoading}
                    >
                      Check server readiness
                    </Button>
                  ) : null}
                  <Button
                    mode="contained"
                    onPress={() => void submitReport()}
                    disabled={
                      submitting
                      || !interviewComplete
                      || needsRefresh
                      || readinessLoading
                      || Object.values(dirtyFieldsRef.current).some(Boolean)
                      || cacheConflict !== null
                      || editCacheConflict.kind === 'conflict'
                      || (
                        !pendingSubmission
                        && (readinessVersion !== draft.version || submitIssues.length > 0)
                      )
                    }
                    loading={submitting}
                  >
                    {pendingSubmission ? 'Retry submission' : 'Confirm on this device & submit'}
                  </Button>
                </>
              ) : (
                <Text variant="titleMedium">Submitted · awaiting review</Text>
              )}
            </Card.Content>
          </Card>
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
                If an answer was rejected as stale, the server did not save it. Reload to compare the current server values with preserved device edits before deciding which copy to keep.
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
          const scalarFields = fields.filter((field) => field.groupKey === null);
          const formAnswers = draft.answers.filter((answer) => answer.formKey === form.formKey);
          const formUnsavedCount = Object.entries(dirtyFields).filter(([fieldId, dirty]) => {
            return dirty && parseAnswerFieldId(fieldId)?.[0] === form.formKey;
          }).length;
          const expanded = expandedForms[form.formKey] ?? false;
          const sections = new Map<string, FormFieldDefinition[]>();
          for (const field of scalarFields) {
            const section = field.section?.trim() || 'Other details';
            const sectionFields = sections.get(section) ?? [];
            sectionFields.push(field);
            sections.set(section, sectionFields);
          }
          const formIssueCount = submitIssues.filter((issue) => issue.formKey === form.formKey).length;
          return (
            <Card
              key={`${form.formKey}:${form.version}`}
              onLayout={(event) => {
                formOffsetsRef.current[form.formKey] = event.nativeEvent.layout.y;
              }}
            >
              <Card.Content style={styles.cardContent}>
                <View style={styles.formHeader}>
                  <View style={styles.formTitle}>
                    <Text variant="titleMedium">{formTitle(form)}</Text>
                    <Text variant="bodySmall">
                      {`Pinned v${form.version} · ${formAnswers.length} saved${formUnsavedCount ? ` · ${formUnsavedCount} unsaved` : ''}`}
                    </Text>
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
                {formIssueCount ? (
                  <HelperText type="error" visible>
                    {`${formIssueCount} server requirement${formIssueCount === 1 ? '' : 's'} need attention.`}
                  </HelperText>
                ) : null}
                {!isActive ? (
                  <Text variant="bodySmall">
                    Not triggered by confirmed answers. Related incident answers may activate this form.
                  </Text>
                ) : (
                  <Button
                    mode={expanded ? 'contained-tonal' : 'outlined'}
                    icon={expanded ? 'chevron-up' : 'chevron-down'}
                    accessibilityState={{ expanded }}
                    onPress={() => setExpandedForms((current) => ({
                      ...current,
                      [form.formKey]: !expanded,
                    }))}
                  >
                    {expanded ? 'Hide form fields' : 'Show form fields'}
                  </Button>
                )}
                {expanded ? (
                  <View style={styles.formSections}>
                    {[...sections].map(([section, sectionFields]) => {
                      const sectionId = JSON.stringify([form.formKey, section]);
                      const sectionExpanded = expandedSections[sectionId] ?? false;
                      const sectionSavedCount = sectionFields.filter((field) => formAnswers.some(
                        (answer) => answer.fieldKey === field.key && answer.groupInstanceId === null,
                      )).length;
                      const sectionUnsavedCount = sectionFields.filter(
                        (field) => dirtyFields[answerValueId(form.formKey, field.key, null)],
                      ).length;
                      const sectionIssueCount = submitIssues.filter(
                        (issue) => issue.formKey === form.formKey
                          && sectionFields.some((field) => issue.fieldKey === field.key),
                      ).length;
                      return (
                        <List.Accordion
                          key={sectionId}
                          title={section}
                          description={`${sectionFields.length} fields · ${sectionSavedCount} saved${sectionUnsavedCount ? ` · ${sectionUnsavedCount} unsaved` : ''}${sectionIssueCount ? ` · ${sectionIssueCount} needs attention` : ''}`}
                          expanded={sectionExpanded}
                          onPress={() => setExpandedSections((current) => ({
                            ...current,
                            [sectionId]: !sectionExpanded,
                          }))}
                          left={(props) => (
                            <List.Icon
                              {...props}
                              icon={sectionExpanded ? 'folder-open-outline' : 'folder-outline'}
                            />
                          )}
                          style={styles.sectionAccordion}
                        >
                          {sectionFields.map((field) => {
                            const fieldId = answerValueId(form.formKey, field.key, null);
                            const savedAnswer = formAnswers.find(
                              (answer) => answer.fieldKey === field.key
                                && answer.groupInstanceId === null,
                            );
                            const value = fieldValues[fieldId] ?? initialFieldValue(field, null);
                            return (
                              <View key={fieldId} style={styles.field}>
                                <IncidentFieldEditor
                                  field={field}
                                  value={value}
                                  onChange={(next) => changeAnswerValue(form, field, next, null)}
                                  disabled={controlsDisabled || !isActive}
                                  readOnly={readOnly || !isActive}
                                  onBlur={() => validateEditedField(form, field, null)}
                                />
                                {savedAnswer ? (
                                  <Text variant="bodySmall">{`Source: ${savedAnswer.source}`}</Text>
                                ) : null}
                                {savedAnswer && savedAnswer.answerState !== 'confirmed' ? (
                                  <>
                                    <Chip compact>
                                      {`Saved status: ${answerStateLabel(savedAnswer.answerState)}`}
                                    </Chip>
                                    {field.required || field.key === 'injuries' ? (
                                      <HelperText type="error" visible>
                                        This required or safety-critical answer is not confirmed and will block submission.
                                      </HelperText>
                                    ) : null}
                                  </>
                                ) : null}
                                {fieldErrors[fieldId] ? (
                                  <HelperText type="error" visible accessibilityLiveRegion="polite">
                                    {fieldErrors[fieldId]}
                                  </HelperText>
                                ) : null}
                                {!readOnly && isActive && !field.configurationError && dirtyFields[fieldId] ? (
                                  <Button
                                    mode="contained"
                                    onPress={() => void saveField(form, field, null)}
                                    disabled={
                                      controlsDisabled
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
                        </List.Accordion>
                      );
                    })}
                    {form.definition?.groups.map((group) => {
                      const groupId = JSON.stringify([form.formKey, group.key]);
                      const groupExpanded = expandedGroups[groupId] ?? false;
                      const instances = draft.groups
                        .filter((entry) => entry.formKey === form.formKey && entry.groupKey === group.key)
                        .sort((left, right) => left.position - right.position);
                      const groupFields = fields.filter((field) => field.groupKey === group.key);
                      const groupUnsavedCount = Object.entries(dirtyFields).filter(([fieldId, dirty]) => {
                        const identity = parseAnswerFieldId(fieldId);
                        return dirty
                          && identity?.[0] === form.formKey
                          && groupFields.some((field) => field.key === identity[1])
                          && instances.some((instance) => instance.id === identity[2]);
                      }).length;
                      return (
                        <View key={groupId} style={styles.groupSection}>
                          <View style={styles.groupHeader}>
                            <Pressable
                              accessibilityRole="button"
                              accessibilityLabel={`${group.label}, ${instances.length} items${groupUnsavedCount ? `, ${groupUnsavedCount} unsaved changes` : ''}`}
                              accessibilityState={{ expanded: groupExpanded }}
                              onPress={() => setExpandedGroups((current) => ({
                                ...current,
                                [groupId]: !groupExpanded,
                              }))}
                              style={styles.groupToggle}
                            >
                              <View style={styles.formTitle}>
                                <Text variant="titleSmall">
                                  {`${group.label}${group.required ? ' · Required group' : ''}`}
                                </Text>
                                <Text variant="bodySmall">
                                  {instances.length
                                    ? `${instances.length} item${instances.length === 1 ? '' : 's'}${groupUnsavedCount ? ` · ${groupUnsavedCount} unsaved` : ''}`
                                    : group.required ? 'Required · no items added' : 'Optional · no items added'}
                                </Text>
                              </View>
                              <List.Icon icon={groupExpanded ? 'chevron-up' : 'chevron-down'} />
                            </Pressable>
                            {!readOnly && isActive ? (
                              <Button
                                compact
                                mode="outlined"
                                icon="plus"
                                onPress={() => {
                                  setExpandedGroups((current) => ({ ...current, [groupId]: true }));
                                  void addRepeatedGroup(form, group.key);
                                }}
                                disabled={controlsDisabled || creatingGroup === `${form.formKey}:${group.key}`}
                                loading={creatingGroup === `${form.formKey}:${group.key}`}
                              >
                                Add
                              </Button>
                            ) : null}
                          </View>
                          {groupExpanded ? (
                            instances.length ? instances.map((instance, index) => {
                              const hasUnsavedValues = Object.entries(dirtyFields).some(([fieldId, dirty]) => {
                                const identity = parseAnswerFieldId(fieldId);
                                return dirty && identity?.[2] === instance.id;
                              });
                              return (
                                <View key={instance.id} style={styles.groupInstance}>
                                  <View style={styles.formHeader}>
                                    <Text variant="labelLarge">{`${group.label} ${index + 1}`}</Text>
                                    {!readOnly ? (
                                      <Button
                                        compact
                                        mode="outlined"
                                        onPress={() => confirmRemoveRepeatedGroup(instance, group.label)}
                                        disabled={
                                          controlsDisabled
                                          || !isActive
                                          || deletingGroup === instance.id
                                          || (group.required && instances.length === 1)
                                          || hasUnsavedValues
                                        }
                                        loading={deletingGroup === instance.id}
                                      >
                                        Remove
                                      </Button>
                                    ) : null}
                                  </View>
                                  {hasUnsavedValues ? (
                                    <HelperText type="info" visible>
                                      Save or discard unsaved fields before removing this item.
                                    </HelperText>
                                  ) : null}
                                  {groupFields.map((field) => {
                                    const fieldId = answerValueId(form.formKey, field.key, instance.id);
                                    const savedAnswer = draft.answers.find(
                                      (answer) => answer.formKey === form.formKey
                                        && answer.fieldKey === field.key
                                        && answer.groupInstanceId === instance.id,
                                    );
                                    const value = fieldValues[fieldId]
                                      ?? initialFieldValue(field, savedAnswer?.value ?? null);
                                    return (
                                      <View key={fieldId} style={styles.field}>
                                        <IncidentFieldEditor
                                          field={field}
                                          value={value}
                                          onChange={(next) => changeAnswerValue(form, field, next, instance.id)}
                                          disabled={controlsDisabled || !isActive}
                                          readOnly={readOnly || !isActive}
                                          onBlur={() => validateEditedField(form, field, instance.id)}
                                        />
                                        {savedAnswer ? (
                                          <Text variant="bodySmall">
                                            {`Source: ${savedAnswer.source} · ${answerStateLabel(savedAnswer.answerState)}`}
                                          </Text>
                                        ) : null}
                                        {fieldErrors[fieldId] ? (
                                          <HelperText type="error" visible accessibilityLiveRegion="polite">
                                            {fieldErrors[fieldId]}
                                          </HelperText>
                                        ) : null}
                                        {!readOnly && isActive && !field.configurationError && dirtyFields[fieldId] ? (
                                          <Button
                                            mode="contained"
                                            onPress={() => void saveField(form, field, instance.id)}
                                            disabled={controlsDisabled}
                                            loading={savingFieldId === fieldId}
                                          >
                                            Save item
                                          </Button>
                                        ) : null}
                                      </View>
                                    );
                                  })}
                                </View>
                              );
                            }) : (
                              <HelperText type={group.required ? 'error' : 'info'} visible>
                                {group.required ? 'At least one repeated item is required.' : 'No repeated items added.'}
                              </HelperText>
                            )
                          ) : null}
                        </View>
                      );
                    })}
                  </View>
                ) : null}
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
        <Button
          mode="outlined"
          icon="arrow-left"
          accessibilityLabel={backLabel}
          onPress={handleBack}
        >
          {backLabel}
        </Button>
      </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: palette.background,
  },
  flex: {
    flex: 1,
  },
  content: {
    alignSelf: 'center',
    gap: 16,
    padding: 20,
    width: '100%',
    maxWidth: 760,
  },
  stickyHeader: {
    backgroundColor: palette.surface,
    borderBottomColor: palette.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 20,
  },
  headerContent: {
    alignItems: 'center',
    alignSelf: 'center',
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
    maxWidth: 760,
    minHeight: 56,
    width: '100%',
  },
  revisionLabel: {
    color: palette.mutedText,
  },
  backButton: {
    marginLeft: -8,
  },
  cardContent: {
    gap: 16,
    padding: 20,
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
  formSections: {
    gap: 8,
  },
  sectionAccordion: {
    backgroundColor: palette.surfaceVariant,
    borderRadius: 12,
    overflow: 'hidden',
  },
  groupHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  groupToggle: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    minHeight: 56,
  },
  historyRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'space-between',
  },
  historyText: {
    flex: 1,
    gap: 4,
  },
  historyEditor: {
    borderTopColor: palette.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 12,
    paddingTop: 12,
  },
  evidenceRow: {
    borderTopColor: palette.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 8,
    paddingTop: 12,
  },
  evidenceDetails: {
    gap: 8,
  },
  issue: {
    borderTopColor: palette.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 4,
    paddingTop: 8,
  },
  evidenceImage: {
    alignSelf: 'flex-start',
    borderRadius: 12,
    height: 180,
    width: 240,
  },
  groupSection: {
    borderTopColor: palette.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 12,
    paddingTop: 12,
  },
  groupInstance: {
    backgroundColor: palette.surfaceVariant,
    borderColor: palette.border,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 12,
    padding: 12,
  },
  field: {
    gap: 10,
    paddingVertical: 4,
  },
  fieldControl: {
    gap: 10,
  },
  dateTimeControls: {
    flexDirection: 'row',
    gap: 8,
  },
  dateTimeButton: {
    borderRadius: 12,
    flex: 1,
    minHeight: 48,
  },
  dateTimeButtonContent: {
    minHeight: 48,
    paddingHorizontal: 8,
  },
  dateTimeButtonLabel: {
    flexShrink: 1,
    textAlign: 'left',
  },
  multiSelectOptions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  multiSelectOption: {
    alignItems: 'center',
    backgroundColor: palette.surface,
    borderColor: palette.outline,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    flexBasis: '47%',
    flexDirection: 'row',
    flexGrow: 1,
    gap: 4,
    minHeight: 48,
    minWidth: 112,
    paddingHorizontal: 8,
  },
  multiSelectOptionSelected: {
    backgroundColor: palette.primaryContainer,
    borderColor: palette.primary,
  },
  multiSelectOptionDisabled: {
    opacity: 0.6,
  },
  multiSelectOptionPressed: {
    opacity: 0.75,
  },
  multiSelectOptionLabel: {
    flex: 1,
    flexShrink: 1,
  },
  previewContainer: {
    borderTopColor: palette.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 8,
    paddingTop: 12,
  },
  previewAccordion: {
    backgroundColor: palette.surfaceVariant,
    borderRadius: 12,
    overflow: 'hidden',
  },
  previewAnswer: {
    borderBottomColor: palette.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 4,
    paddingVertical: 8,
  },
  choiceRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  dropdownButton: {
    alignSelf: 'stretch',
    borderRadius: 14,
  },
  dropdownButtonContent: {
    flexDirection: 'row-reverse',
    minHeight: 52,
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  dropdownButtonLabel: {
    flex: 1,
    textAlign: 'left',
  },
  dropdownMenu: {
    borderRadius: 14,
  },
  longText: {
    minHeight: 160,
    textAlignVertical: 'top',
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    padding: 24,
  },
});
