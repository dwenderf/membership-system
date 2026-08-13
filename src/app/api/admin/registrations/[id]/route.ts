import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

// DELETE /api/admin/registrations/[id] - Delete a never-published registration
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const supabase = await createClient()

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: userProfile } = await supabase
      .from('users')
      .select('is_admin')
      .eq('id', user.id)
      .single()

    if (!userProfile?.is_admin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { data: registration, error: fetchError } = await supabase
      .from('registrations')
      .select('id, published_at')
      .eq('id', id)
      .single()

    if (fetchError || !registration) {
      return NextResponse.json({ error: 'Registration not found' }, { status: 404 })
    }

    if (registration.published_at) {
      return NextResponse.json({
        error: 'Cannot delete a registration that has been published. Close it instead by ending its registration window.'
      }, { status: 400 })
    }

    // Clean up access codes, which reference registrations without ON DELETE CASCADE.
    // Safe to remove outright: published_at is null, so these codes could never have been used.
    await supabase
      .from('access_codes')
      .delete()
      .eq('registration_id', id)

    const { error: deleteError } = await supabase
      .from('registrations')
      .delete()
      .eq('id', id)

    if (deleteError) {
      throw deleteError
    }

    return NextResponse.json({ message: 'Registration deleted successfully' })
  } catch (error) {
    console.error('Error deleting registration:', error)
    return NextResponse.json(
      { error: 'Failed to delete registration' },
      { status: 500 }
    )
  }
}
