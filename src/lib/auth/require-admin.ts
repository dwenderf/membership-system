import { NextResponse } from 'next/server'
import type { User } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'

export type RequireAdminResult =
  | { ok: true; user: User }
  | { ok: false; response: NextResponse }

/**
 * Server-side admin guard for API routes.
 *
 * Checks the caller's Supabase session and their `users.is_admin` flag.
 * Returns `{ ok: true, user }` for an admin, otherwise a 401 (no session) or
 * 403 (signed in, not an admin) response to return as-is:
 *
 *   const auth = await requireAdmin()
 *   if (!auth.ok) return auth.response
 *
 * The proxy (src/proxy.ts) applies the same check to /api/admin/*, but each
 * admin route should still call this: the proxy is defense in depth, and
 * routes outside /api/admin are not covered by it.
 */
export async function requireAdmin(): Promise<RequireAdminResult> {
  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()

  if (error || !user) {
    return { ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }

  const { data: profile } = await supabase
    .from('users')
    .select('is_admin')
    .eq('id', user.id)
    .single()

  if (!profile?.is_admin) {
    return { ok: false, response: NextResponse.json({ error: 'Admin access required' }, { status: 403 }) }
  }

  return { ok: true, user }
}
