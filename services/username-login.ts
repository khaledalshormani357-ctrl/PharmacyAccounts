import { getSharedSupabaseClient } from '@/template/core/client';
import { normalizeLoginIdentifier } from './username-login-utils';

export type UsernameSignInResult = { error?: string };

async function getEdgeErrorCode(error: unknown): Promise<string> {
  const candidate = error as { message?: string; context?: unknown };
  const context = candidate?.context as { clone?: () => { json?: () => Promise<unknown> }; json?: () => Promise<unknown> } | undefined;
  if (context) {
    try {
      const responseLike = typeof context.clone === 'function' ? context.clone() : context;
      if (typeof responseLike.json === 'function') {
        const payload = await responseLike.json() as { error?: unknown };
        if (typeof payload?.error === 'string') return payload.error;
      }
    } catch {
      // Continue with a generic transport error.
    }
  }
  const message = candidate?.message?.toLowerCase() ?? '';
  if (message.includes('function not found') || message.includes('404')) return 'function_not_deployed';
  if (message.includes('network') || message.includes('fetch') || message.includes('timeout')) return 'network_error';
  return 'invalid_credentials';
}

export async function signInWithUsername(username: string, password: string): Promise<UsernameSignInResult> {
  const loginIdentifier = normalizeLoginIdentifier(username);
  if (!loginIdentifier || !password) return { error: 'invalid_request' };

  try {
    const supabase = getSharedSupabaseClient();
    const { data, error } = await supabase.functions.invoke('username-login', {
      body: { username: loginIdentifier, password },
    });
    if (error) return { error: await getEdgeErrorCode(error) };
    if (!data || typeof data.access_token !== 'string' || typeof data.refresh_token !== 'string') {
      return { error: 'invalid_response' };
    }

    const { error: sessionError } = await supabase.auth.setSession({
      access_token: data.access_token,
      refresh_token: data.refresh_token,
    });
    if (sessionError) return { error: 'session_error' };
    return {};
  } catch {
    return { error: 'network_error' };
  }
}
