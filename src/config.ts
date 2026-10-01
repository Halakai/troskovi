export const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? '';
export const SUPABASE_KEY = (import.meta.env.VITE_SUPABASE_KEY as string | undefined) ?? '';

// Usernames are stored in Supabase Auth as "<username>@<domain>".
// Must match public._email_for() in supabase/schema.sql.
export const USERNAME_EMAIL_DOMAIN = 'troskovi.invalid';

export const CURRENCY = 'EUR';
// Number format: 'en-IE' → €1,234.56   'hr-HR' / 'de-DE' → 1.234,56 €
export const LOCALE = 'en-IE';
