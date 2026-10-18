import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import { getSharedSupabaseClient } from '../template/core/client';

const OUTBOX_KEY = '@pharmacy_accounts/supabase-sync-outbox/v1';
const MAX_ATTEMPTS = 8;

export type SyncEntityType =
  | 'product' | 'product_unit' | 'batch' | 'stock_movement'
  | 'sale' | 'sale_item' | 'sale_payment' | 'sale_return'
  | 'purchase' | 'purchase_item' | 'purchase_return'
  | 'customer' | 'supplier' | 'cash_transaction' | 'shift'
  | 'expense' | 'audit_log';

export interface SyncOutboxEvent {
  event_id: string;
  client_id: string;
  entity_type: SyncEntityType;
  entity_id: string;
  operation: 'upsert' | 'delete';
  schema_version: number;
  payload: Record<string, unknown>;
  client_created_at: string;
  attempts: number;
  last_error?: string;
}

export interface SyncFlushResult {
  sent: number;
  failed: number;
  skipped: boolean;
  reason?: string;
}

function createUuid(): string {
  // Persisted event IDs stay stable across retries; Expo Crypto supplies UUIDs.
  return Crypto.randomUUID();
}

// Serialize every read-modify-write operation. Serializing only setItem() is not
// enough: two concurrent enqueue calls could both read the same queue and one
// would overwrite the other's event.
let queueMutation: Promise<void> = Promise.resolve();

async function withQueueLock<T>(work: () => Promise<T>): Promise<T> {
  let release!: () => void;
  const previous = queueMutation;
  queueMutation = new Promise<void>((resolve) => { release = resolve; });
  await previous.catch(() => undefined);
  try {
    return await work();
  } finally {
    release();
  }
}

async function readQueue(): Promise<SyncOutboxEvent[]> {
  const raw = await AsyncStorage.getItem(OUTBOX_KEY);
  if (!raw) return [];
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error('Sync outbox data is invalid');
  return parsed as SyncOutboxEvent[];
}

async function writeQueue(events: SyncOutboxEvent[]): Promise<void> {
  await AsyncStorage.setItem(OUTBOX_KEY, JSON.stringify(events));
}

/**
 * Queue an event for transport. Call this only after the corresponding business
 * mutation is durably committed. This utility is not yet wired into ERP mutations.
 * Never queue passwords, auth tokens, or service-role credentials in payload.
 */
export async function enqueueSyncEvent(input: {
  client_id: string;
  entity_type: SyncEntityType;
  entity_id: string | number;
  operation: 'upsert' | 'delete';
  payload?: Record<string, unknown>;
}): Promise<string> {
  if (!input.client_id.trim()) throw new Error('A stable device/client ID is required');
  if (!String(input.entity_id).trim()) throw new Error('Entity ID is required');

  const event: SyncOutboxEvent = {
    event_id: createUuid(),
    client_id: input.client_id,
    entity_type: input.entity_type,
    entity_id: String(input.entity_id),
    operation: input.operation,
    schema_version: 1,
    payload: input.payload ?? {},
    client_created_at: new Date().toISOString(),
    attempts: 0,
  };
  await withQueueLock(async () => {
    const queue = await readQueue();
    queue.push(event);
    await writeQueue(queue);
  });
  return event.event_id;
}

/**
 * Uploads queued transport events only. This does NOT apply the event payload
 * to operational tables and therefore must not be presented as completed ERP sync.
 * Requires a signed-in user with an active pharmacy_profiles row and the migration
 * 006 proposal applied in a disposable/staging database.
 */
let flushInFlight: Promise<SyncFlushResult> | null = null;

/** Avoid duplicate overlapping flushes from app foreground/reconnect triggers. */
export async function flushSyncOutbox(limit = 25): Promise<SyncFlushResult> {
  if (flushInFlight) return flushInFlight;
  const currentFlush = flushSyncOutboxOnce(limit);
  flushInFlight = currentFlush;
  try {
    return await currentFlush;
  } finally {
    if (flushInFlight === currentFlush) flushInFlight = null;
  }
}

async function flushSyncOutboxOnce(limit: number): Promise<SyncFlushResult> {
  const client = getSharedSupabaseClient();
  const { data: authData, error: authError } = await client.auth.getUser();
  const user = authData?.user;
  if (authError || !user) return { sent: 0, failed: 0, skipped: true, reason: 'AUTH_REQUIRED' };

  const { data: profile, error: profileError } = await client
    .from('pharmacy_profiles')
    .select('pharmacy_id, active')
    .eq('id', user.id)
    .maybeSingle();

  if (profileError || !profile?.pharmacy_id || profile.active !== true) {
    return { sent: 0, failed: 0, skipped: true, reason: 'ACTIVE_PHARMACY_PROFILE_REQUIRED' };
  }

  const queue = await readQueue();
  const pending = queue.filter((event) => event.attempts < MAX_ATTEMPTS).slice(0, Math.max(1, limit));
  let sent = 0;
  let failed = 0;
  const sentIds = new Set<string>();
  const errors = new Map<string, string>();

  for (const event of pending) {
    const { error } = await client.from('pharmacy_sync_events').upsert({
      pharmacy_id: profile.pharmacy_id,
      event_id: event.event_id,
      client_id: event.client_id,
      entity_type: event.entity_type,
      entity_id: event.entity_id,
      operation: event.operation,
      schema_version: event.schema_version,
      payload: event.payload,
      actor_id: user.id,
      client_created_at: event.client_created_at,
    }, { onConflict: 'pharmacy_id,event_id', ignoreDuplicates: true });

    if (error) {
      failed += 1;
      errors.set(event.event_id, error.message.slice(0, 500));
    } else {
      sent += 1;
      sentIds.add(event.event_id);
    }
  }

  // Merge acknowledgements into the latest queue under the same lock used by
  // enqueue. Never replace it with the earlier snapshot: events queued while the
  // network requests were in flight must survive this flush.
  await withQueueLock(async () => {
    const latestQueue = await readQueue();
    const remaining = latestQueue
      .filter((event) => !sentIds.has(event.event_id))
      .map((event) => {
        const error = errors.get(event.event_id);
        if (!error) return event;
        return { ...event, attempts: event.attempts + 1, last_error: error };
      });
    await writeQueue(remaining);
  });

  return { sent, failed, skipped: false };
}

/** Returns safe queue metadata only; payloads are intentionally omitted. */
export async function getSyncOutboxStatus(): Promise<{ pending: number; exhausted: number }> {
  const queue = await readQueue();
  return {
    pending: queue.filter((event) => event.attempts < MAX_ATTEMPTS).length,
    exhausted: queue.filter((event) => event.attempts >= MAX_ATTEMPTS).length,
  };
}
