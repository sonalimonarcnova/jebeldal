// Saving driver-accepted proposals with rpc save_incident_answer (optimistic versioning).
// Client-agnostic so it runs in the app (api.ts passes the app client) and in Node scripts/tests.
import { z } from 'zod';

export type ProposalToSave = {
  form_key: string;
  field_key: string;
  value: string | string[] | boolean;
};

/** Reasons save_incident_answer / incident reads can fail with, plus client-side ones. */
export type SaveErrorCode =
  | 'STALE_VERSION'
  | 'VALIDATION_FAILED'
  | 'FORM_DEFINITION_MISSING'
  | 'NOT_ALLOWED'
  | 'INCIDENT_NOT_DRAFT'
  | 'AUTH_REQUIRED'
  | 'NETWORK'
  | 'UNKNOWN';

export type SavedField = { form_key: string; field_key: string };

export type SaveProposalsResult =
  | { ok: true; data: { saved: SavedField[]; version: number } }
  | {
      ok: false;
      code: SaveErrorCode;
      retryable: boolean;
      message: string;
      /** fields saved before the failure (saving is sequential, so these are durable) */
      saved: SavedField[];
      failed: SavedField | null;
    };

type RpcError = { code?: string; message?: string };
type QueryResult = { data: unknown; error: RpcError | null };

/** The slice of a supabase-js client this module needs. */
export type SaveClient = {
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<QueryResult>;
  from: (table: string) => {
    select: (columns: string) => {
      eq: (column: string, value: string) => { maybeSingle: () => PromiseLike<QueryResult> };
    };
  };
};

const SAVE_MESSAGES: Record<SaveErrorCode, { retryable: boolean; message: string }> = {
  STALE_VERSION: { retryable: true, message: 'The report changed while saving. Try again.' },
  VALIDATION_FAILED: { retryable: false, message: 'An answer did not fit its question.' },
  FORM_DEFINITION_MISSING: { retryable: false, message: 'This form is not available for the report.' },
  NOT_ALLOWED: { retryable: false, message: 'You cannot change this report.' },
  INCIDENT_NOT_DRAFT: { retryable: false, message: 'This report was already submitted.' },
  AUTH_REQUIRED: { retryable: false, message: 'Sign in again to continue.' },
  NETWORK: { retryable: true, message: 'No connection. Check your signal and try again.' },
  UNKNOWN: { retryable: true, message: 'Something went wrong saving your answers. Try again.' },
};

/** Eng B's RPCs raise errcode P0001 with the reason in `message`; no code at all means the request never arrived. */
export function mapRpcError(error: RpcError): { code: SaveErrorCode; retryable: boolean; message: string } {
  if (!error.code) return { code: 'NETWORK', ...SAVE_MESSAGES.NETWORK };
  const reason = error.code === 'P0001' ? error.message : undefined;
  const code: SaveErrorCode = reason && reason in SAVE_MESSAGES ? (reason as SaveErrorCode) : 'UNKNOWN';
  return { code, ...SAVE_MESSAGES[code] };
}

const versionSchema = z.number().int().positive();

async function readRevisionVersion(client: SaveClient, revisionId: string): Promise<{ version: number } | { error: RpcError }> {
  const { data, error } = await client.from('incident_revisions').select('version').eq('id', revisionId).maybeSingle();
  if (error) return { error };
  const parsed = versionSchema.safeParse((data as { version?: unknown } | null)?.version);
  if (!parsed.success) return { error: { code: 'P0001', message: 'NOT_ALLOWED' } };
  return { version: parsed.data };
}

/**
 * Saves the driver-accepted proposals one by one with save_incident_answer (source 'driver_confirmed').
 * Reads the revision version first and threads each returned version into the next call. Turn and evidence RPCs
 * also bump the version, so a STALE_VERSION is retried once after re-reading it.
 */
export async function saveAcceptedProposalsWith(
  client: SaveClient,
  revisionId: string,
  proposals: ProposalToSave[],
): Promise<SaveProposalsResult> {
  const saved: SavedField[] = [];
  const first = await readRevisionVersion(client, revisionId);
  if ('error' in first) return { ok: false, ...mapRpcError(first.error), saved, failed: null };
  let version = first.version;

  for (const p of proposals) {
    const field = { form_key: p.form_key, field_key: p.field_key };
    const save = (expectedVersion: number) =>
      client.rpc('save_incident_answer', {
        p_incident_revision_id: revisionId,
        p_expected_version: expectedVersion,
        p_form_key: p.form_key,
        p_field_key: p.field_key,
        p_group_instance_id: null,
        p_value: p.value,
        p_answer_state: 'confirmed',
        p_source: 'driver_confirmed',
        p_evidence_id: null,
      });

    let { data, error } = await save(version);
    if (error && mapRpcError(error).code === 'STALE_VERSION') {
      const fresh = await readRevisionVersion(client, revisionId);
      if ('error' in fresh) return { ok: false, ...mapRpcError(fresh.error), saved, failed: field };
      ({ data, error } = await save(fresh.version));
    }
    if (error) return { ok: false, ...mapRpcError(error), saved, failed: field };

    const next = versionSchema.safeParse(data);
    if (!next.success) return { ok: false, code: 'UNKNOWN', ...SAVE_MESSAGES.UNKNOWN, saved, failed: field };
    version = next.data;
    saved.push(field);
  }
  return { ok: true, data: { saved, version } };
}
