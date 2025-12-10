import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = await createClient()

  try {
    // Check admin authorization
    const { data: { user: authUser } } = await supabase.auth.getUser()

    if (!authUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: currentUser } = await supabase
      .from('users')
      .select('is_admin')
      .eq('id', authUser.id)
      .single()

    if (!currentUser?.is_admin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Get discount codes used for this user registration
    const { data: discountUsage, error } = await supabase
      .from('discount_usage')
      .select(`
        discount_code_id,
        discount_codes!inner (
          id,
          code,
          percentage,
          discount_category_id
        )
      `)
      .eq('user_registration_id', params.id)

    if (error) {
      console.error('Error fetching discount codes:', error)
      return NextResponse.json({ discountCodes: [] })
    }

    const discountCodes = (discountUsage || []).map((usage: any) => ({
      id: usage.discount_codes.id,
      code: usage.discount_codes.code,
      percentage: usage.discount_codes.percentage,
      category_id: usage.discount_codes.discount_category_id
    }))

    return NextResponse.json({ discountCodes })
  } catch (error) {
    console.error('Error in discount codes endpoint:', error)
    return NextResponse.json({ discountCodes: [] })
  }
}
