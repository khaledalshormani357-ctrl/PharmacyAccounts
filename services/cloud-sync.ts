// Cloud sync — Phase 1: manual, push-then-pull sync (see docs/CLOUD_SYNC.md).
//
// What this is: a manual sync engine. The user presses "مزامنة الآن" in
// Settings; the engine pushes the local outbox (services/erp-database.ts
// records every local mutation there) and then pulls remote rows newer
// than the last pull. No Realtime, no background sync.
//
// Identity: every local row carries `syncId` (remote `client_id`). The
// local numeric `id` never leaves the device. Conflicts resolve per whole
// row, last-write-wins on `updatedAt`, ties broken by the larger device id.
//
// The Supabase client is injected (options.client) instead of imported:
// the unit-test build has no @supabase/supabase-js, and the engine must
// stay testable with a fake client. The app passes
// getSharedSupabaseClient() from Settings; see app/settings.tsx.

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  SYNCABLE_COLLECTIONS,
  applyPulledChanges,
  clearSyncedOutbox,
  getAllLocalRows,
  getLocalRowBySyncId,
  getPendingSyncCount,
  getSyncDeviceId,
  getSyncOutboxSnapshot,
  noteOutboxFailure,
  withOutboxSuppressed,
} from './erp-database';

// ─── Narrow Supabase surface ────────────────────────────────────────
// Only the calls the engine makes. The real SupabaseClient is passed in
// from the app (cast at the boundary in app/settings.tsx); tests pass a
// fake implementing this interface.

export interface SyncQueryResult {
  data: unknown;
  error: { message: string } | null;
}

export interface SyncQueryBuilder {
  select(columns?: string): SyncQueryBuilder;
  eq(column: string, value: unknown): SyncQueryBuilder;
  in(column: string, values: unknown[]): SyncQueryBuilder;
  gt(column: string, value: unknown): SyncQueryBuilder;
  order(column: string, options?: { ascending?: boolean }): SyncQueryBuilder;
  limit(count: number): SyncQueryBuilder;
  maybeSingle(): Promise<SyncQueryResult>;
  upsert(
    rows: Array<Record<string, unknown>>,
    options?: { onConflict?: string },
  ): Promise<SyncQueryResult>;
  update(values: Record<string, unknown>): SyncQueryBuilder;
  then<TResult1 = SyncQueryResult, TResult2 = never>(
    onfulfilled?: ((value: SyncQueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2>;
}

export interface SyncSupabaseClient {
  from(table: string): SyncQueryBuilder;
  auth: {
    getSession(): Promise<{ data: { session: { user: { id: string } } | null } }>;
  };
}

// ─── Errors ─────────────────────────────────────────────────────────

export type SyncErrorCode = 'not-configured' | 'not-signed-in' | 'no-pharmacy' | 'offline' | 'server';

export class CloudSyncError extends Error {
  readonly code: SyncErrorCode;

  constructor(code: SyncErrorCode, message: string) {
    super(message);
    this.name = 'CloudSyncError';
    this.code = code;
  }
}

const ARABIC_MESSAGES: Record<SyncErrorCode, string> = {
  'not-configured': 'المزامنة غير مهيأة على هذا الجهاز: أضف بيانات Supabase في الإعدادات ثم أعد المحاولة.',
  'not-signed-in': 'سجّل الدخول أولاً لتفعيل المزامنة السحابية.',
  'no-pharmacy': 'حسابك غير مرتبط بصيدلية بعد؛ اطلب من المسؤول ربط حسابك بصيدلية.',
  offline: 'تعذر الاتصال بالخادم. تحقق من الإنترنت ثم أعد المحاولة.',
  server: 'تعذرت المزامنة بسبب خطأ في الخادم. حاول لاحقاً.',
};

function isOfflineError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /network|fetch|timeout|econnrefused|enotfound|offline/i.test(message);
}

// ─── Collection <-> remote table ────────────────────────────────────
// Parents first, so a pull resolves foreign keys against rows that were
// just applied in the same sync.

export const COLLECTION_TABLES: Record<string, string> = {
  products: 'products',
  productUnits: 'product_units',
  batches: 'batches',
  customers: 'customers',
  suppliers: 'suppliers',
  sales: 'sales',
  saleItems: 'sale_items',
  saleBatchAllocations: 'sale_batch_allocations',
  salePayments: 'sale_payments',
  saleReturns: 'sale_returns',
  purchases: 'purchases',
  purchaseItems: 'purchase_items',
  purchaseReturns: 'purchase_returns',
  customerTransactions: 'customer_transactions',
  supplierTransactions: 'supplier_transactions',
  cashTransactions: 'cash_transactions',
  shifts: 'shifts',
  expenses: 'expenses',
  stockMovements: 'stock_movements',
  auditLogs: 'audit_logs',
};

export const SYNC_PUSH_BATCH_SIZE = 50;
export const SYNC_PULL_LIMIT = 1000;
const PULL_OVERLAP_MS = 5000;
const EPOCH = '1970-01-01T00:00:00.000Z';

// ─── Pure helpers (unit-testable, no Supabase) ──────────────────────

/** Parse every timestamp shape the app produces into epoch ms: ISO with
 * or without a zone, the legacy local 'YYYY-MM-DD HH:MM:SS' (UTC, as
 * produced from toISOString), and plain dates. Unparseable -> 0. */
export function parseSyncTimestamp(value: string | null | undefined): number {
  if (!value || typeof value !== 'string') return 0;
  let text = value.trim();
  if (!text) return 0;
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(text)) text = `${text.replace(' ', 'T')}Z`;
  const ms = Date.parse(text);
  return Number.isFinite(ms) ? ms : 0;
}

export interface ConflictSide {
  updatedAt?: string | null;
  deviceId?: string | null;
}

/** Last-write-wins on the whole row. An exact tie is broken by the
 * lexicographically larger device id (deterministic on every device).
 * Equal timestamps and equal devices mean the same write: keep local. */
export function resolveConflict(local: ConflictSide, remote: ConflictSide): 'local' | 'remote' {
  const localMs = parseSyncTimestamp(local.updatedAt);
  const remoteMs = parseSyncTimestamp(remote.updatedAt);
  if (remoteMs > localMs) return 'remote';
  if (localMs > remoteMs) return 'local';
  const localDevice = local.deviceId ?? '';
  const remoteDevice = remote.deviceId ?? '';
  if (remoteDevice !== localDevice) return remoteDevice > localDevice ? 'remote' : 'local';
  return 'local';
}

/** Local numeric foreign key -> the target collection it points at. */
const FK_TARGET: Record<string, string> = {
  product_id: 'products',
  sale_id: 'sales',
  sale_item_id: 'saleItems',
  purchase_id: 'purchases',
  purchase_item_id: 'purchaseItems',
  customer_id: 'customers',
  supplier_id: 'suppliers',
  batch_id: 'batches',
  shift_id: 'shifts',
  return_id: 'saleReturns',
};

/** Foreign keys that stay numeric on purpose: they point at local-only
 * data (users are never synced) or are polymorphic references
 * (reference_type + reference_id) that no single table can resolve. */
const NUMERIC_FK_KEPT = new Set(['user_id', 'cancelled_by', 'entity_id', 'reference_id']);

export interface MapContext {
  pharmacyId: string;
  deviceId: string;
  updatedBy?: string | null;
  resolveSyncId: (collection: string, localId: number) => string | null;
  /** Remote uuid (`id`) of a row known by client_id, for product_units. */
  resolveRemoteId?: (table: string, clientId: string) => string | null;
}

export interface PullMapContext {
  resolveLocalId: (collection: string, clientId: string) => number | null;
}

function mapForeignKeyToRemote(
  key: string,
  value: unknown,
  ctx: MapContext,
  parentCollection?: string,
): [string, unknown] | null {
  const target = key === 'return_id' && parentCollection
    ? parentCollection
    : FK_TARGET[key];
  if (!target) return null;
  const remoteKey = `${key.replace(/_id$/, '')}_client_id`;
  const localId = typeof value === 'number' ? value : null;
  const clientId = localId === null ? null : ctx.resolveSyncId(target, localId);
  return [remoteKey, clientId];
}

/** Map nested return-line items (jsonb) the same way as top-level rows. */
function mapNestedItemsToRemote(
  items: unknown,
  ctx: MapContext,
  parentCollection: string,
): unknown {
  if (!Array.isArray(items)) return items ?? [];
  return items.map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
    const mapped: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(item as Record<string, unknown>)) {
      if (key === 'id') continue;
      if (key === 'batch_allocations' && Array.isArray(value)) {
        mapped[key] = mapNestedItemsToRemote(value, ctx, parentCollection);
        continue;
      }
      const fk = mapForeignKeyToRemote(key, value, ctx, parentCollection);
      if (fk) {
        mapped[fk[0]] = fk[1];
      } else {
        mapped[key] = value;
      }
    }
    return mapped;
  });
}

function mapNestedItemsToLocal(
  items: unknown,
  ctx: PullMapContext,
  parentCollection: string,
): unknown {
  if (!Array.isArray(items)) return items ?? [];
  return items.map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
    const mapped: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(item as Record<string, unknown>)) {
      if (key === 'batch_allocations' && Array.isArray(value)) {
        mapped[key] = mapNestedItemsToLocal(value, ctx, parentCollection);
        continue;
      }
      if (key.endsWith('_client_id') && typeof value === 'string') {
        const base = key.slice(0, -'_client_id'.length);
        const localKey = `${base}_id`;
        const target = localKey === 'return_id' && parentCollection
          ? parentCollection
          : FK_TARGET[localKey];
        if (target) {
          const localId = ctx.resolveLocalId(target, value);
          if (localId !== null) mapped[localKey] = localId;
          continue;
        }
      }
      mapped[key] = value;
    }
    return mapped;
  });
}

/**
 * Local row -> remote row. Local business fields are already snake_case,
 * so they pass through unchanged; only the sync identity translates
 * (syncId -> client_id, updatedAt -> updated_at, syncDeviceId ->
 * device_id) and numeric foreign keys become *_client_id UUIDs.
 */
export function mapLocalRowToRemote(
  collection: string,
  row: Record<string, unknown>,
  ctx: MapContext,
): Record<string, unknown> {
  const remote: Record<string, unknown> = {
    client_id: (row['syncId'] as string | undefined) ?? null,
    pharmacy_id: ctx.pharmacyId,
    updated_at: (row['updatedAt'] as string | undefined)
      ?? (row['updated_at'] as string | undefined)
      ?? (row['created_at'] as string | undefined)
      ?? new Date().toISOString(),
    deleted_at: null,
    device_id: ctx.deviceId,
  };
  if (ctx.updatedBy) remote['updated_by'] = ctx.updatedBy;
  for (const [key, value] of Object.entries(row)) {
    if (key === 'id' || key === 'syncId' || key === 'updatedAt' || key === 'syncDeviceId' || key === 'updated_at') {
      continue;
    }
    if (key === 'items') {
      remote['items'] = mapNestedItemsToRemote(value, ctx, collection);
      continue;
    }
    const fk = mapForeignKeyToRemote(key, value, ctx);
    if (fk) {
      remote[fk[0]] = fk[1];
      continue;
    }
    if (NUMERIC_FK_KEPT.has(key)) {
      remote[key] = value;
      continue;
    }
    remote[key] = value;
  }
  // product_units.product_id references the remote products row (uuid);
  // the sync link is product_client_id, product_id is best-effort.
  if (collection === 'productUnits') {
    const productClientId = remote['product_client_id'];
    remote['product_id'] = typeof productClientId === 'string' && ctx.resolveRemoteId
      ? ctx.resolveRemoteId('products', productClientId)
      : null;
  }
  return remote;
}

/** Remote row -> local row (without a local numeric id; the store assigns
 * one on insert and keeps the existing one on replace). */
export function mapRemoteRowToLocal(
  collection: string,
  row: Record<string, unknown>,
  ctx: PullMapContext,
): Record<string, unknown> {
  const local: Record<string, unknown> = {
    syncId: row['client_id'],
    updatedAt: row['updated_at'],
    syncDeviceId: (row['device_id'] as string | undefined) ?? null,
  };
  for (const [key, value] of Object.entries(row)) {
    if (
      key === 'id' || key === 'pharmacy_id' || key === 'client_id' || key === 'updated_at'
      || key === 'deleted_at' || key === 'device_id' || key === 'updated_by'
    ) {
      continue;
    }
    if (key === 'items') {
      local['items'] = mapNestedItemsToLocal(value, ctx, collection);
      continue;
    }
    if (key.endsWith('_client_id') && typeof value === 'string') {
      const base = key.slice(0, -'_client_id'.length);
      const localKey = `${base}_id`;
      const target = FK_TARGET[localKey];
      if (target) {
        const localId = ctx.resolveLocalId(target, value);
        if (localId !== null) local[localKey] = localId;
        continue;
      }
      // Unknown *_client_id (e.g. product_client_id on product_units is
      // handled below via the generic rule too): fall through to keep it
      // out of the local row unless it maps to a known local key.
      if (collection === 'productUnits' && key === 'product_client_id') {
        const localId = ctx.resolveLocalId('products', value);
        if (localId !== null) local['product_id'] = localId;
      }
      continue;
    }
    if (key === 'product_id' && collection === 'productUnits') {
      // Remote uuid of the product row: the local link comes from
      // product_client_id instead; ignore the uuid itself.
      continue;
    }
    local[key] = value;
  }
  return local;
}

/** Pure description of one pull query, for tests and logging. */
export function buildPullQuery(table: string, since: string): { table: string; gt: string } {
  return { table, gt: since };
}

// ─── Sync state (AsyncStorage) ────────────────────────────────────────

export const SYNC_STATE_KEY = '@pharmacy_accounts/sync/v1';

export interface SyncState {
  deviceId: string;
  lastPullAt: Record<string, string>;
  lastPushAt: string | null;
  lastSyncAt: string | null;
  lastError: string | null;
}

async function loadSyncState(deviceId: string): Promise<SyncState> {
  try {
    const raw = await AsyncStorage.getItem(SYNC_STATE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<SyncState>;
      return {
        deviceId: typeof parsed.deviceId === 'string' ? parsed.deviceId : deviceId,
        lastPullAt: parsed.lastPullAt && typeof parsed.lastPullAt === 'object' ? parsed.lastPullAt : {},
        lastPushAt: typeof parsed.lastPushAt === 'string' ? parsed.lastPushAt : null,
        lastSyncAt: typeof parsed.lastSyncAt === 'string' ? parsed.lastSyncAt : null,
        lastError: typeof parsed.lastError === 'string' ? parsed.lastError : null,
      };
    }
  } catch {
    // Corrupt state starts fresh; the next pull uses the epoch and
    // re-applies everything idempotently by client_id.
  }
  return { deviceId, lastPullAt: {}, lastPushAt: null, lastSyncAt: null, lastError: null };
}

async function saveSyncState(state: SyncState): Promise<void> {
  try {
    await AsyncStorage.setItem(SYNC_STATE_KEY, JSON.stringify(state));
  } catch {
    // Sync state is advisory; the data itself was already pushed/pulled.
  }
}

// ─── Status (for Settings) ────────────────────────────────────────────

export interface SyncStatus {
  configured: boolean;
  signedIn: boolean;
  hasPharmacy: boolean | null;
  pending: number;
  lastSyncAt: string | null;
  lastError: string | null;
  deviceId: string;
}

export async function getSyncStatus(options?: { client?: SyncSupabaseClient }): Promise<SyncStatus> {
  const deviceId = getSyncDeviceId();
  const state = await loadSyncState(deviceId);
  const base: SyncStatus = {
    configured: false,
    signedIn: false,
    hasPharmacy: null,
    pending: getPendingSyncCount(),
    lastSyncAt: state.lastSyncAt,
    lastError: state.lastError,
    deviceId,
  };
  const client = options?.client;
  if (!client) return base;
  base.configured = true;
  try {
    const { data } = await client.auth.getSession();
    const user = data?.session?.user ?? null;
    if (!user) return base;
    base.signedIn = true;
    const profile = await client
      .from('pharmacy_profiles')
      .select('pharmacy_id')
      .eq('id', user.id)
      .maybeSingle();
    base.hasPharmacy = !profile.error && !!((profile.data as { pharmacy_id?: string } | null)?.pharmacy_id);
  } catch {
    // Network/auth errors leave hasPharmacy unknown; syncNow reports them.
  }
  return base;
}

// ─── Engine ───────────────────────────────────────────────────────────

export interface SyncResult {
  pushed: number;
  pulled: number;
  conflictsResolved: number;
  deletedApplied: number;
  errors: string[];
  syncedAt: string;
}

export interface SyncOptions {
  client?: SyncSupabaseClient;
}

async function resolvePharmacyId(
  client: SyncSupabaseClient,
): Promise<{ userId: string; pharmacyId: string }> {
  let sessionUser: { id: string } | null;
  try {
    const { data } = await client.auth.getSession();
    sessionUser = data?.session?.user ?? null;
  } catch (error) {
    if (isOfflineError(error)) throw new CloudSyncError('offline', ARABIC_MESSAGES.offline);
    throw new CloudSyncError('server', ARABIC_MESSAGES.server);
  }
  if (!sessionUser) {
    throw new CloudSyncError('not-signed-in', ARABIC_MESSAGES['not-signed-in']);
  }
  let profile: SyncQueryResult;
  try {
    profile = await client
      .from('pharmacy_profiles')
      .select('pharmacy_id')
      .eq('id', sessionUser.id)
      .maybeSingle();
  } catch (error) {
    if (isOfflineError(error)) throw new CloudSyncError('offline', ARABIC_MESSAGES.offline);
    throw new CloudSyncError('server', ARABIC_MESSAGES.server);
  }
  if (profile.error) throw new CloudSyncError('server', ARABIC_MESSAGES.server);
  const pharmacyId = (profile.data as { pharmacy_id?: unknown } | null)?.pharmacy_id;
  if (typeof pharmacyId !== 'string' || !pharmacyId) {
    throw new CloudSyncError('no-pharmacy', ARABIC_MESSAGES['no-pharmacy']);
  }
  return { userId: sessionUser.id, pharmacyId };
}

function localIdResolver(): (collection: string, localId: number) => string | null {
  const cache = new Map<string, Map<number, string>>();
  return (collection, localId) => {
    let byId = cache.get(collection);
    if (!byId) {
      byId = new Map<number, string>();
      for (const row of getAllLocalRows(collection)) {
        if (typeof row['id'] === 'number' && typeof row['syncId'] === 'string') {
          byId.set(row['id'], row['syncId']);
        }
      }
      cache.set(collection, byId);
    }
    return byId.get(localId) ?? null;
  };
}

/**
 * Manual sync: push the outbox first, then pull newer remote rows.
 * If the whole push fails, the pull is skipped so remote rows never
 * overwrite local changes that have not been uploaded yet.
 */
export async function syncNow(options?: SyncOptions): Promise<SyncResult> {
  const client = options?.client;
  if (!client) {
    throw new CloudSyncError('not-configured', ARABIC_MESSAGES['not-configured']);
  }
  const { userId, pharmacyId } = await resolvePharmacyId(client);
  const deviceId = getSyncDeviceId();
  const state = await loadSyncState(deviceId);
  state.deviceId = deviceId;
  const syncedAt = new Date().toISOString();
  const errors: string[] = [];
  let pushed = 0;
  let pulled = 0;
  let conflictsResolved = 0;
  let deletedApplied = 0;

  const resolveSyncId = localIdResolver();
  let remoteProductIds: Map<string, string> | null = null;
  const resolveRemoteId = async (table: string, clientId: string): Promise<string | null> => {
    if (table !== 'products') return null;
    if (!remoteProductIds) {
      remoteProductIds = new Map<string, string>();
      try {
        const res = await client.from('products').select('id,client_id');
        const rows = Array.isArray(res.data) ? (res.data as Array<Record<string, unknown>>) : [];
        for (const row of rows) {
          if (typeof row['id'] === 'string' && typeof row['client_id'] === 'string') {
            remoteProductIds.set(row['client_id'], row['id']);
          }
        }
      } catch {
        // Best-effort: product_id stays null, product_client_id is the link.
      }
    }
    return remoteProductIds.get(clientId) ?? null;
  };

  // ── Push ──
  const outbox = getSyncOutboxSnapshot();
  const byCollection = new Map<string, typeof outbox>();
  for (const entry of outbox) {
    if (!SYNCABLE_COLLECTIONS.includes(entry.collection)) continue;
    if (!COLLECTION_TABLES[entry.collection]) continue;
    const list = byCollection.get(entry.collection) ?? [];
    list.push(entry);
    byCollection.set(entry.collection, list);
  }
  for (const [collection, entries] of byCollection) {
    const table = COLLECTION_TABLES[collection];
    for (let start = 0; start < entries.length; start += SYNC_PUSH_BATCH_SIZE) {
      const batch = entries.slice(start, start + SYNC_PUSH_BATCH_SIZE);
      const upserts = batch.filter(e => e.op === 'upsert');
      const deletes = batch.filter(e => e.op === 'delete');
      if (upserts.length > 0) {
        // Load the remote product-id map before mapping units, so their
        // product_id (uuid) is filled when the product is known.
        if (collection === 'productUnits') {
          await resolveRemoteId('products', '');
        }
        const mapped: Array<Record<string, unknown>> = [];
        const mappedSyncIds: string[] = [];
        const goneSyncIds: string[] = [];
        for (const entry of upserts) {
          const local = getLocalRowBySyncId(collection, entry.syncId ?? '');
          if (!local) {
            // Row vanished locally (e.g. replaced by a backup restore):
            // nothing left to push; drop the stale entry.
            goneSyncIds.push(entry.syncId ?? '');
            continue;
          }
          mapped.push(mapLocalRowToRemote(collection, local, {
            pharmacyId,
            deviceId,
            updatedBy: userId,
            resolveSyncId,
            resolveRemoteId: (t, c) => {
              // The products map is loaded before mapping units (see the
              // pre-load above); for other collections it stays null and
              // product_id stays null — product_client_id is the link.
              return remoteProductIds?.get(c) ?? null;
            },
          }));
          mappedSyncIds.push(entry.syncId ?? '');
        }
        if (goneSyncIds.length > 0) clearSyncedOutbox(goneSyncIds);
        if (mapped.length > 0) {
          let result: SyncQueryResult;
          try {
            result = await client.from(table).upsert(mapped, { onConflict: 'client_id' });
          } catch (error) {
            const message = error instanceof Error ? error.message : 'تعذر الاتصال بالخادم';
            errors.push(`دفع ${table}: ${message}`);
            noteOutboxFailure(mappedSyncIds, message);
            continue;
          }
          if (result.error) {
            errors.push(`دفع ${table}: ${result.error.message}`);
            noteOutboxFailure(mappedSyncIds, result.error.message);
            continue;
          }
          clearSyncedOutbox(mappedSyncIds);
          pushed += mapped.length;
        }
      }
      if (deletes.length > 0) {
        const syncIds = deletes.map(e => e.syncId ?? '').filter(Boolean);
        const stamp = new Date().toISOString();
        let result: SyncQueryResult;
        try {
          result = await client
            .from(table)
            .update({ deleted_at: stamp, updated_at: stamp, device_id: deviceId })
            .in('client_id', syncIds);
        } catch (error) {
          const message = error instanceof Error ? error.message : 'تعذر الاتصال بالخادم';
          errors.push(`حذف ${table}: ${message}`);
          noteOutboxFailure(syncIds, message);
          continue;
        }
        if (result.error) {
          errors.push(`حذف ${table}: ${result.error.message}`);
          noteOutboxFailure(syncIds, result.error.message);
          continue;
        }
        clearSyncedOutbox(syncIds);
        pushed += syncIds.length;
      }
    }
  }

  // A wholly failed push must not be followed by a pull: remote rows
  // would overwrite local changes that never reached the server.
  if (outbox.length > 0 && pushed === 0 && errors.length > 0) {
    state.lastError = errors[0] ?? null;
    await saveSyncState(state);
    return { pushed, pulled, conflictsResolved, deletedApplied, errors, syncedAt };
  }

  // ── Pull ──
  const pullCtx: PullMapContext = {
    resolveLocalId: (collection, clientId) => {
      const row = getLocalRowBySyncId(collection, clientId);
      return typeof row?.['id'] === 'number' ? (row['id'] as number) : null;
    },
  };
  for (const collection of Object.keys(COLLECTION_TABLES)) {
    const table = COLLECTION_TABLES[collection];
    const since = state.lastPullAt[table] ?? EPOCH;
    // A small overlap re-reads rows at the boundary, so a row pushed
    // with the same updated_at as the last pull is never skipped.
    const querySince = new Date(
      Math.max(0, parseSyncTimestamp(since) - PULL_OVERLAP_MS),
    ).toISOString();
    let result: SyncQueryResult;
    try {
      result = await client
        .from(table)
        .select('*')
        .gt('updated_at', querySince)
        .order('updated_at', { ascending: true })
        .limit(SYNC_PULL_LIMIT);
    } catch (error) {
      errors.push(`سحب ${table}: ${error instanceof Error ? error.message : 'تعذر الاتصال بالخادم'}`);
      continue;
    }
    if (result.error) {
      errors.push(`سحب ${table}: ${result.error.message}`);
      continue;
    }
    const rows = Array.isArray(result.data) ? (result.data as Array<Record<string, unknown>>) : [];
    const toUpsert: Array<Record<string, unknown>> = [];
    const toDelete: string[] = [];
    let maxMs = parseSyncTimestamp(since);
    for (const remote of rows) {
      const remoteMs = parseSyncTimestamp(remote['updated_at'] as string | undefined);
      if (remoteMs > maxMs) maxMs = remoteMs;
      const clientId = remote['client_id'];
      if (typeof clientId !== 'string' || !clientId) continue;
      if (remote['deleted_at']) {
        if (getLocalRowBySyncId(collection, clientId)) {
          toDelete.push(clientId);
          deletedApplied += 1;
        }
        continue;
      }
      const local = getLocalRowBySyncId(collection, clientId);
      if (!local) {
        toUpsert.push(mapRemoteRowToLocal(collection, remote, pullCtx));
        pulled += 1;
        continue;
      }
      const winner = resolveConflict(
        { updatedAt: (local['updatedAt'] as string | undefined) ?? null, deviceId: (local['syncDeviceId'] as string | undefined) ?? null },
        { updatedAt: (remote['updated_at'] as string | undefined) ?? null, deviceId: (remote['device_id'] as string | undefined) ?? null },
      );
      if (winner === 'remote') {
        toUpsert.push(mapRemoteRowToLocal(collection, remote, pullCtx));
        pulled += 1;
        conflictsResolved += 1;
      }
    }
    if (toUpsert.length > 0 || toDelete.length > 0) {
      withOutboxSuppressed(() => applyPulledChanges(collection, toUpsert, toDelete));
    }
    if (maxMs > parseSyncTimestamp(since)) {
      state.lastPullAt[table] = new Date(maxMs).toISOString();
    }
  }

  if (pushed > 0) state.lastPushAt = syncedAt;
  state.lastSyncAt = syncedAt;
  state.lastError = errors.length > 0 ? errors[0] : null;
  await saveSyncState(state);
  return { pushed, pulled, conflictsResolved, deletedApplied, errors, syncedAt };
}
