import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

interface DiscountValidationResult {
  isValid: boolean
  discountCode?: {
    id: string
    code: string
    percentage: number
    category: {
      id: string
      name: string
      accounting_code: string
      max_discount_per_user_per_season: number | null
    }
  }
  discountAmount?: number // In cents
  error?: string
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    
    // Get the authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { code, registrationId, amount } = body
    
    if (!code || !registrationId || !amount) {
      return NextResponse.json({ 
        error: 'Missing required fields: code, registrationId, amount' 
      }, { status: 400 })
    }

    // Get the registration to determine the season
    const { data: registration, error: regError } = await supabase
      .from('registrations')
      .select('season_id')
      .eq('id', registrationId)
      .single()

    if (regError || !registration) {
      return NextResponse.json({ error: 'Registration not found' }, { status: 404 })
    }

    // Find the discount code with its category
    const { data: discountCode, error: codeError } = await supabase
      .from('discount_codes')
      .select(`
        id,
        code,
        percentage,
        is_active,
        valid_from,
        valid_until,
        discount_categories (
          id,
          name,
          accounting_code,
          max_discount_per_user_per_season,
          is_active
        )
      `)
      .eq('code', code.toUpperCase().trim())
      .eq('is_active', true)
      .single()

    if (codeError || !discountCode) {
      const result: DiscountValidationResult = {
        isValid: false,
        error: 'Invalid discount code'
      }
      return NextResponse.json(result)
    }

    // Check if category is active
    if (!discountCode.discount_categories?.is_active) {
      const result: DiscountValidationResult = {
        isValid: false,
        error: 'Discount code category is not active'
      }
      return NextResponse.json(result)
    }

    // Check date validity
    const now = new Date()
    if (discountCode.valid_from && new Date(discountCode.valid_from) > now) {
      const result: DiscountValidationResult = {
        isValid: false,
        error: 'Discount code is not yet valid'
      }
      return NextResponse.json(result)
    }

    if (discountCode.valid_until && new Date(discountCode.valid_until) < now) {
      const result: DiscountValidationResult = {
        isValid: false,
        error: 'Discount code has expired'
      }
      return NextResponse.json(result)
    }

    // Calculate discount amount
    const discountAmount = Math.round((amount * discountCode.percentage) / 100)

    // Check category usage limits if applicable
    if (discountCode.discount_categories?.max_discount_per_user_per_season) {
      const { data: usageData, error: usageError } = await supabase
        .from('discount_usage')
        .select('amount_saved')
        .eq('user_id', user.id)
        .eq('discount_category_id', discountCode.discount_categories.id)
        .eq('season_id', registration.season_id)

      if (usageError) {
        console.error('Error checking discount usage:', usageError)
        return NextResponse.json({ error: 'Error validating discount limits' }, { status: 500 })
      }

      const totalUsed = usageData?.reduce((sum, usage) => sum + usage.amount_saved, 0) || 0
      const maxAllowed = discountCode.discount_categories.max_discount_per_user_per_season
      
      if (totalUsed + discountAmount > maxAllowed) {
        const remaining = Math.max(0, maxAllowed - totalUsed)
        const result: DiscountValidationResult = {
          isValid: false,
          error: `Discount would exceed category limit. You have $${(remaining / 100).toFixed(2)} remaining for ${discountCode.discount_categories.name} this season.`
        }
        return NextResponse.json(result)
      }
    }

    // Valid discount code
    const result: DiscountValidationResult = {
      isValid: true,
      discountCode: {
        id: discountCode.id,
        code: discountCode.code,
        percentage: discountCode.percentage,
        category: {
          id: discountCode.discount_categories.id,
          name: discountCode.discount_categories.name,
          accounting_code: discountCode.discount_categories.accounting_code,
          max_discount_per_user_per_season: discountCode.discount_categories.max_discount_per_user_per_season
        }
      },
      discountAmount
    }

    return NextResponse.json(result)
    
  } catch (error) {
    console.error('Error validating discount code:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}