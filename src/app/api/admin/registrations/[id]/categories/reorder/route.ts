import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: registrationId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  // Check admin
  const { data: userData } = await supabase
    .from('users')
    .select('is_admin')
    .eq('id', user.id)
    .single()
  if (!userData?.is_admin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  // Use admin client for updates
  const { createAdminClient } = await import('@/lib/supabase/admin')
  const adminClient = await createAdminClient()
  const body = await req.json()
  const order = body.order as Array<{ id: string; sort_order: number }>
  if (!Array.isArray(order)) {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  }
  // Batch update sort_order for registration_categories
  const updates = await Promise.all(order.map(async ({ id, sort_order }) => {
    const { error } = await adminClient
      .from('registration_categories')
      .update({ sort_order })
      .eq('id', id)
      .eq('registration_id', registrationId)
    return error
  }))
  if (updates.some(e => e)) {
    return NextResponse.json({ error: 'Failed to update some categories' }, { status: 500 })
  }
  return NextResponse.json({ success: true })
}
