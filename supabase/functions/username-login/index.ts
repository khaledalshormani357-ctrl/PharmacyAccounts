import { createClient } from 'npm:@supabase/supabase-js@2';
import { isEmailLoginIdentifier, isValidLoginIdentifier, normalizeLoginIdentifier } from './login-utils.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Cache-Control': 'no-store',
};
const WINDOW_SECONDS = 900;
const USER_FAILURE_LIMIT = 12;
const IP_FAILURE_LIMIT = 80;

function response(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function getClientIp(request: Request): string | null {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  const cloudflare = request.headers.get('cf-connecting-ip')?.trim();
  const realIp = request.headers.get('x-real-ip')?.trim();
  return forwarded || cloudflare || realIp || null;
}

async function hmacHex(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value));
  return Array.from(new Uint8Array(signature), byte => byte.toString(16).padStart(2, '0')).join('');
}

async function findAuthUser(admin: ReturnType<typeof createClient>, identifier: string) {
  const { data: resolved, error: resolveError } = await admin.rpc('resolve_username_login', {
    p_username: identifier,
  });
  if (resolveError) throw new Error('username_lookup_failed');
  if (!Array.isArray(resolved) || resolved.length !== 1 || !resolved[0]?.user_id) return null;

  const { data, error } = await admin.auth.admin.getUserById(resolved[0].user_id as string);
  if (error || !data.user?.email) return null;
  if (isEmailLoginIdentifier(identifier) && normalizeLoginIdentifier(data.user.email) !== identifier) return null;
  return data.user;
}

async function recordFailure(admin: ReturnType<typeof createClient>, keys: string[]) {
  const { error } = await admin.rpc('record_username_login_failure', {
    p_key_hashes: keys,
    p_window_seconds: WINDOW_SECONDS,
  });
  if (error) throw new Error('rate_limit_record_failed');
}

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return response({ error: 'invalid_request' }, 405);

  let payload: { username?: unknown; password?: unknown };
  try {
    payload = await request.json();
  } catch {
    return response({ error: 'invalid_request' }, 400);
  }

  const rawIdentifier = typeof payload.username === 'string' ? payload.username : '';
  const identifier = normalizeLoginIdentifier(rawIdentifier);
  const password = typeof payload.password === 'string' ? payload.password : '';
  if (!isValidLoginIdentifier(identifier) || !password || password.length > 256) {
    return response({ error: 'invalid_request' }, 400);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return response({ error: 'service_unavailable' }, 503);
  }

  try {
    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const clientIp = getClientIp(request);
    const keyHashes = [await hmacHex(serviceRoleKey, `username:${identifier}`)];
    const limits = [USER_FAILURE_LIMIT];
    if (clientIp) {
      keyHashes.push(await hmacHex(serviceRoleKey, `ip:${clientIp}`));
      limits.push(IP_FAILURE_LIMIT);
    }

    const { data: permitted, error: limitError } = await admin.rpc('check_username_login_rate_limit', {
      p_key_hashes: keyHashes,
      p_limits: limits,
      p_window_seconds: WINDOW_SECONDS,
    });
    if (limitError) return response({ error: 'service_unavailable' }, 503);
    if (permitted !== true) return response({ error: 'rate_limited' }, 429);

    const user = await findAuthUser(admin, identifier);
    if (!user?.email) {
      await recordFailure(admin, keyHashes);
      return response({ error: 'invalid_credentials' }, 401);
    }

    const { data: profile, error: profileError } = await admin
      .from('pharmacy_profiles')
      .select('active')
      .eq('id', user.id)
      .maybeSingle();
    if (profileError) return response({ error: 'service_unavailable' }, 503);
    if (profile && profile.active === false) {
      await recordFailure(admin, keyHashes);
      return response({ error: 'invalid_credentials' }, 401);
    }

    const passwordClient = createClient(supabaseUrl, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: authData, error: authError } = await passwordClient.auth.signInWithPassword({
      email: user.email,
      password,
    });
    if (authError || !authData.session) {
      await recordFailure(admin, keyHashes);
      return response({ error: 'invalid_credentials' }, 401);
    }

    return response({
      access_token: authData.session.access_token,
      refresh_token: authData.session.refresh_token,
      expires_in: authData.session.expires_in,
      token_type: authData.session.token_type,
    });
  } catch {
    return response({ error: 'service_unavailable' }, 503);
  }
});
