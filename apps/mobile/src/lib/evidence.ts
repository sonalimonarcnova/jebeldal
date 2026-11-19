import { randomUUID } from 'expo-crypto';

import { supabase } from './supabase';

export const EVIDENCE_BUCKET = 'incident-evidence';

export type EvidenceMediaType = 'audio' | 'photo';

const MEDIA: Record<EvidenceMediaType, { ext: string; contentType: string }> = {
  audio: { ext: 'm4a', contentType: 'audio/mp4' },
  photo: { ext: 'jpg', contentType: 'image/jpeg' },
};

export type EvidenceErrorCode =
  | 'NOT_SIGNED_IN'
  | 'NO_PROFILE'
  | 'FILE_READ_FAILED'
  | 'ROW_FAILED'
  | 'UPLOAD_FAILED';

/** Thrown by uploadEvidence. Pass `evidenceId` back in to retry without creating a second row. */
export class EvidenceUploadError extends Error {
  readonly code: EvidenceErrorCode;
  readonly evidenceId: string | null;
  readonly retryable: boolean;
  constructor(code: EvidenceErrorCode, message: string, evidenceId: string | null, retryable: boolean) {
    super(message);
    this.name = 'EvidenceUploadError';
    this.code = code;
    this.evidenceId = evidenceId;
    this.retryable = retryable;
  }
}

export type UploadEvidenceInput = {
  revisionId: string;
  uri: string;
  mediaType: EvidenceMediaType;
  /** TODO(B1): stored once evidence.question_key exists (DB v2). Accepted now so callers don't change later. */
  questionKey?: string;
  /** Reuse on retry (from EvidenceUploadError.evidenceId) so the same row and storage path are used. */
  evidenceId?: string;
};

export type UploadedEvidence = { evidenceId: string; objectPath: string; sizeBytes: number };

type EvidenceRow = { id: string; object_path: string; upload_status: 'pending' | 'uploaded' | 'failed'; size_bytes: number | null };

async function markFailed(evidenceId: string) {
  await supabase.from('evidence').update({ upload_status: 'failed' }).eq('id', evidenceId);
}

/**
 * Evidence row first (pending) → upload to {org}/{revision}/{evidence}.{ext} → mark uploaded (docs/sprint-plan.md §3.4).
 * Idempotent per evidenceId: an existing row is reused, an already-uploaded one is returned as is.
 */
export async function uploadEvidence(input: UploadEvidenceInput): Promise<UploadedEvidence> {
  const { revisionId, uri, mediaType } = input;
  const evidenceId = input.evidenceId ?? randomUUID();
  const { ext, contentType } = MEDIA[mediaType];

  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;
  if (!user) throw new EvidenceUploadError('NOT_SIGNED_IN', 'Sign in again to upload.', null, false);

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('user_id', user.id)
    .maybeSingle<{ organization_id: string }>();
  if (profileError) throw new EvidenceUploadError('NO_PROFILE', 'Could not load your profile.', null, true);
  if (!profile) throw new EvidenceUploadError('NO_PROFILE', 'Your profile is not set up yet.', null, false);

  const objectPath = `${profile.organization_id}/${revisionId}/${evidenceId}.${ext}`;

  // 1. Row (reuse on retry).
  const { data: existing, error: selectError } = await supabase
    .from('evidence')
    .select('id, object_path, upload_status, size_bytes')
    .eq('id', evidenceId)
    .maybeSingle<EvidenceRow>();
  if (selectError) throw new EvidenceUploadError('ROW_FAILED', 'Could not save the recording.', evidenceId, true);
  if (existing?.upload_status === 'uploaded') {
    return { evidenceId, objectPath: existing.object_path, sizeBytes: existing.size_bytes ?? 0 };
  }
  if (!existing) {
    const { error: insertError } = await supabase.from('evidence').insert({
      id: evidenceId,
      organization_id: profile.organization_id,
      incident_revision_id: revisionId,
      object_path: objectPath,
      media_type: mediaType,
      upload_status: 'pending',
      uploaded_by: user.id,
      capture_time: new Date().toISOString(),
    });
    // 23505 = a previous attempt inserted the row but its response was lost; carry on with it.
    if (insertError && insertError.code !== '23505') {
      throw new EvidenceUploadError('ROW_FAILED', 'Could not save the recording.', evidenceId, true);
    }
  }

  // 2. File → storage.
  let body: ArrayBuffer;
  try {
    const response = await fetch(uri);
    body = await response.arrayBuffer();
  } catch {
    await markFailed(evidenceId);
    throw new EvidenceUploadError('FILE_READ_FAILED', 'Could not read the recording on this phone.', evidenceId, false);
  }

  const { error: uploadError } = await supabase.storage
    .from(EVIDENCE_BUCKET)
    .upload(objectPath, body, { contentType, upsert: true });
  if (uploadError) {
    await markFailed(evidenceId);
    throw new EvidenceUploadError('UPLOAD_FAILED', 'Upload failed. Check your connection and try again.', evidenceId, true);
  }

  // 3. Mark uploaded.
  const sizeBytes = body.byteLength;
  const { error: updateError } = await supabase
    .from('evidence')
    .update({ upload_status: 'uploaded', size_bytes: sizeBytes > 0 ? sizeBytes : null })
    .eq('id', evidenceId);
  if (updateError) {
    throw new EvidenceUploadError('ROW_FAILED', 'Upload finished but could not be confirmed. Try again.', evidenceId, true);
  }

  return { evidenceId, objectPath, sizeBytes };
}
