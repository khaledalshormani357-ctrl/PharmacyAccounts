import AsyncStorage from '@react-native-async-storage/async-storage';
import { getSharedSupabaseClient } from '@/template/core/client';
import type { DrugCatalogSearchable } from './drug-catalog-utils';

export interface DrugCatalogRecord extends DrugCatalogSearchable {
  generic_name: string | null;
  active_ingredient: string | null;
  strength: string | null;
  dosage_form: string | null;
  base_unit: string | null;
  selling_unit: string | null;
  pack_size: number | null;
  category_id: string | null;
  category_ar: string | null;
  category_en: string | null;
  manufacturer_id: string | null;
  manufacturer_name: string | null;
  country_of_origin: string | null;
  is_active: boolean;
}

export type DrugCatalogSource = 'empty' | 'cache' | 'remote';
export interface DrugCatalogLoad {
  records: DrugCatalogRecord[];
  source: DrugCatalogSource;
  syncedAt: number | null;
}

interface CatalogCache {
  schema_version: 1;
  synced_at: number;
  records: DrugCatalogRecord[];
}

const CACHE_KEY = '@pharmacyaccounts/drug-catalog/v1';
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const PAGE_SIZE = 500;
const SELECT_COLUMNS = [
  'source_id', 'source_code', 'trade_name_ar', 'trade_name_en', 'generic_name',
  'active_ingredient', 'strength', 'dosage_form', 'base_unit', 'selling_unit',
  'pack_size', 'category_id', 'category_ar', 'category_en', 'manufacturer_id',
  'manufacturer_name', 'country_of_origin', 'is_active',
].join(',');

let memoryRecords: DrugCatalogRecord[] | null = null;

async function readCache(): Promise<CatalogCache | null> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CatalogCache;
    if (parsed.schema_version !== 1 || !Array.isArray(parsed.records)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function getLocalDrugCatalog(): Promise<DrugCatalogLoad> {
  if (memoryRecords?.length) return { records: memoryRecords, source: 'cache', syncedAt: null };
  const cache = await readCache();
  if (cache?.records.length) {
    memoryRecords = cache.records;
    return { records: cache.records, source: 'cache', syncedAt: cache.synced_at || null };
  }
  memoryRecords = [];
  return { records: [], source: 'empty', syncedAt: null };
}

/**
 * Refresh from the shared, authenticated, read-only Supabase catalog. A null
 * result means offline, unauthenticated, or not yet seeded; callers retain the
 * local cache/bundled dataset and never write to the pharmacy inventory store.
 */
export async function refreshRemoteDrugCatalog(force = false): Promise<DrugCatalogLoad | null> {
  const cached = await readCache();
  if (!force && cached?.records.length && Date.now() - cached.synced_at < CACHE_TTL_MS) {
    memoryRecords = cached.records;
    return { records: cached.records, source: 'cache', syncedAt: cached.synced_at };
  }

  try {
    const client = getSharedSupabaseClient();
    const { data: sessionData, error: sessionError } = await client.auth.getSession();
    if (sessionError || !sessionData.session) return null;

    const records: DrugCatalogRecord[] = [];
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const { data, error } = await client
        .from('drug_catalog')
        .select(SELECT_COLUMNS)
        .eq('is_active', true)
        .order('source_code', { ascending: true })
        .range(offset, offset + PAGE_SIZE - 1);
      if (error) throw error;
      const page = (data || []) as unknown as DrugCatalogRecord[];
      if (!page.length) break;
      records.push(...page.map(record => ({
        ...record,
        pack_size: record.pack_size == null ? null : Number(record.pack_size),
      })));
      if (page.length < PAGE_SIZE) break;
      if (records.length > 10000) throw new Error('Catalog page limit exceeded');
    }

    // Never replace a usable local dataset with an empty or malformed response.
    if (!records.length || records.some(record => !record.source_id || !record.trade_name_ar)) return null;
    const syncedAt = Date.now();
    memoryRecords = records;
    const cachePayload: CatalogCache = { schema_version: 1, synced_at: syncedAt, records };
    try {
      await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(cachePayload));
    } catch {
      // Keep the in-memory remote result usable even if device storage is full.
    }
    return { records, source: 'remote', syncedAt };
  } catch {
    return null;
  }
}

export async function getDrugCatalogItem(sourceId: string): Promise<DrugCatalogRecord | null> {
  const local = await getLocalDrugCatalog();
  const found = local.records.find(record => record.source_id === sourceId);
  if (found) return found;
  const remote = await refreshRemoteDrugCatalog(true);
  return remote?.records.find(record => record.source_id === sourceId) || null;
}
