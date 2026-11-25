// Public Supabase connection values for the app.
//
// Precedence: a local `.env` (EXPO_PUBLIC_SUPABASE_URL /
// EXPO_PUBLIC_SUPABASE_ANON_KEY) wins when present, so local development is
// unchanged. Otherwise the values baked into `app.json` under
// `expo.extra.supabase` are used. That fallback is what makes CI builds
// work: GitHub Actions has no `.env` file and no repository secrets for
// these values, so a build from `main` used to ship with no Supabase
// configuration at all, which silently disabled login, cloud sync and the
// drug catalog import.
//
// Only the publishable key belongs here. It is public by design: Supabase
// ships it inside every client build and it grants nothing beyond what Row
// Level Security allows. Never put the service_role or any secret key here.
import Constants from 'expo-constants';

export interface SupabasePublicConfig {
  url: string;
  anonKey: string;
}

function readExtraConfig(): Partial<SupabasePublicConfig> {
  try {
    const supabase = Constants.expoConfig?.extra?.supabase as
      | { url?: unknown; anonKey?: unknown }
      | undefined;
    if (!supabase || typeof supabase !== 'object') return {};
    const url = typeof supabase.url === 'string' ? supabase.url : undefined;
    const anonKey = typeof supabase.anonKey === 'string' ? supabase.anonKey : undefined;
    return { ...(url ? { url } : {}), ...(anonKey ? { anonKey } : {}) };
  } catch {
    return {};
  }
}

export function getSupabasePublicConfig(): SupabasePublicConfig | null {
  const extra = readExtraConfig();
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL || extra.url;
  const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || extra.anonKey;
  if (!url || !anonKey) return null;
  return { url, anonKey };
}
