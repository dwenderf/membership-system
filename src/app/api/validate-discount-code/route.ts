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
  isPartialDiscount?: boolean // True when discount was capped by season limit
  partialDiscountMessage?: string // Explanation of partial discount
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

    // Debug logging
    console.log('Discount code found:', {
      id: discountCode.id,
      code: discountCode.code,
      is_active: discountCode.is_active,
      discount_categories: discountCode.discount_categories
    })

    // Check if category is active
    const discountCategory = discountCode.discount_categories?.[0]
    console.log('Category check:', {
      discount_categories_length: discountCode.discount_categories?.length,
      discountCategory,
      category_is_active: discountCategory?.is_active
    })
    
    if (!discountCategory?.is_active) {
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
    let discountAmount = Math.round((amount * discountCode.percentage) / 100)

    // Check category usage limits if applicable
    let isPartialDiscount = false
    let partialDiscountMessage = ''
    
    const category = discountCategory
    
    if (category?.max_discount_per_user_per_season) {
      const { data: usageData, error: usageError } = await supabase
        .from('discount_usage')
        .select('amount_saved')
        .eq('user_id', user.id)
        .eq('discount_category_id', category.id)
        .eq('season_id', registration.season_id)

      if (usageError) {
        console.error('Error checking discount usage:', usageError)
        return NextResponse.json({ error: 'Error validating discount limits' }, { status: 500 })
      }

      const totalUsed = usageData?.reduce((sum, usage) => sum + usage.amount_saved, 0) || 0
      const maxAllowed = category.max_discount_per_user_per_season
      const remaining = Math.max(0, maxAllowed - totalUsed)
      
      if (totalUsed >= maxAllowed) {
        // User has already reached their limit
        const result: DiscountValidationResult = {
          isValid: false,
          error: `You have already reached your $${(maxAllowed / 100).toFixed(2)} season limit for ${category.name}. No additional discount can be applied.`
        }
        return NextResponse.json(result)
      }
      
      if (totalUsed + discountAmount > maxAllowed) {
        // Apply partial discount up to the remaining limit
        discountAmount = remaining
        isPartialDiscount = true
        partialDiscountMessage = `Applied $${(discountAmount / 100).toFixed(2)} discount (${discountCode.code}). You've reached your $${(maxAllowed / 100).toFixed(2)} season limit for ${category.name}.`
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
          id: category.id,
          name: category.name,
          accounting_code: category.accounting_code,
          max_discount_per_user_per_season: category.max_discount_per_user_per_season
        }
      },
      discountAmount,
      isPartialDiscount,
      partialDiscountMessage: isPartialDiscount ? partialDiscountMessage : undefined
    }

    return NextResponse.json(result)
    
  } catch (error) {
    console.error('Error validating discount code:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}