import { createClient } from '@supabase/supabase-js';
import { SUPABASE_KEY, SUPABASE_URL, USERNAME_EMAIL_DOMAIN } from './config';

export const isConfigured = Boolean(SUPABASE_URL && SUPABASE_KEY);

export const supabase = createClient(SUPABASE_URL || 'http://localhost:54321', SUPABASE_KEY || 'not-configured', {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: 'troskovi.auth' },
});

export function usernameToEmail(username: string): string {
  return `${username.trim().toLowerCase()}@${USERNAME_EMAIL_DOMAIN}`;
}

export function isNetworkError(e: unknown): boolean {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return true;
  const msg = String((e as { message?: string })?.message ?? e);
  return /failed to fetch|load failed|networkerror|network request failed|fetch failed|timed? ?out/i.test(msg);
}

/** Turns Supabase / Postgres errors into something a person can read. */
export function errorMessage(e: unknown): string {
  const msg = String((e as { message?: string })?.message ?? e ?? 'Something went wrong');
  if (isNetworkError(e)) return 'No connection – check your internet and try again';
  if (/invalid login credentials/i.test(msg)) return 'Wrong username or password';
  if (/user is banned/i.test(msg)) return 'This account is disabled';
  if (/row-level security|permission denied/i.test(msg)) return "You don't have permission to do that";
  return msg;
}
