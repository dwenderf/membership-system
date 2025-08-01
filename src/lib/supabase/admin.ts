import { createClient as createSupabaseClient } from '@supabase/supabase-js'

// Admin client that bypasses RLS using service role key
// This can be used in both client and server components
export function createAdminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    }
  )
} 