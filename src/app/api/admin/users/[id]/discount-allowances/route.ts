import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { logger } from '@/lib/logging/logger'
import {
  resolveEffectiveDiscountLimitsBatch,
  calculateSeasonalDiscountUsageBatch
} from '@/lib/services/discount-limit-service'

/** Row shape of `user_discount_allowances` as selected below, with its joined category/season. */
interface DiscountAllowanceWithJoins {
  id: string
  user_id: string
  discount_category_id: string
  season_id: string
  discount_percentage: number | string | null
  max_discount_amount: number | null
  notes: string | null
  created_by: string | null
  updated_by: string | null
  created_at: string
  updated_at: string
  category: { id: string; name: string; requires_user_allowance: boolean | null } | { id: string; name: string; requires_user_allowance: boolean | null }[] | null
  season: { id: string; name: string; start_date: string; end_date: string } | null
}

/**
 * GET /api/admin/users/[id]/discount-allowances
 * List user's discount allowances for current and upcoming seasons
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const supabase = await createClient()

    // Check if user is admin
    const { data: { user: currentUser }, error: authError } = await supabase.auth.getUser()
    if (authError || !currentUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: adminCheck } = await supabase
      .from('users')
      .select('is_admin')
      .eq('id', currentUser.id)
      .single()

    if (!adminCheck?.is_admin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const nowIso = new Date().toISOString()

    // 1. Query active & upcoming seasons (end_date >= now)
    const { data: activeSeasons, error: seasonsError } = await supabase
      .from('seasons')
      .select('id, name, start_date, end_date')
      .gte('end_date', nowIso)
      .order('start_date', { ascending: true })

    if (seasonsError) {
      return NextResponse.json({ error: 'Failed to fetch seasons' }, { status: 500 })
    }

    const activeSeasonIds = (activeSeasons || []).map(s => s.id)

    // 2. Query user's discount allowances for active/upcoming seasons
    let rawAllowances: DiscountAllowanceWithJoins[] = []
    if (activeSeasonIds.length > 0) {
      const { data: allowancesData, error: allowancesError } = await supabase
        .from('user_discount_allowances')
        .select(`
          id,
          user_id,
          discount_category_id,
          season_id,
          discount_percentage,
          max_discount_amount,
          notes,
          created_by,
          updated_by,
          created_at,
          updated_at,
          category:discount_categories(id, name, requires_user_allowance),
          season:seasons(id, name, start_date, end_date)
        `)
        .eq('user_id', id)
        .in('season_id', activeSeasonIds)

      if (allowancesError) {
        return NextResponse.json({ error: 'Failed to fetch discount allowances' }, { status: 500 })
      }
      // The `category`/`season` joins are single objects at runtime; the untyped
      // client can't infer relation cardinality and types them as arrays.
      rawAllowances = (allowancesData || []) as unknown as DiscountAllowanceWithJoins[]
    }

    // 3. Batch resolve usage & effective limits for each active season
    const formattedAllowances = []
    for (const season of activeSeasons || []) {
      const seasonAllowances = rawAllowances.filter(a => a.season_id === season.id)
      if (seasonAllowances.length === 0) continue

      const effectiveLimitsMap = await resolveEffectiveDiscountLimitsBatch(supabase, [id], season.id)
      const usageMap = await calculateSeasonalDiscountUsageBatch(supabase, [id], season.id)

      for (const allowance of seasonAllowances) {
        const category = Array.isArray(allowance.category) ? allowance.category[0] : allowance.category
        const categoryId = allowance.discount_category_id
        const key = `${id}:${categoryId}`

        const effectiveLimit = effectiveLimitsMap.get(key)
        const totalUsed = usageMap.get(key) || 0

        const maxAllowed = effectiveLimit?.maxAllowed ?? allowance.max_discount_amount
        const isEligible = effectiveLimit?.isEligible ?? (allowance.max_discount_amount !== 0)
        const remaining = (isEligible && maxAllowed !== null) ? Math.max(0, maxAllowed - totalUsed) : (isEligible ? null : 0)

        formattedAllowances.push({
          id: allowance.id,
          userId: allowance.user_id,
          seasonId: allowance.season_id,
          seasonName: allowance.season?.name || season.name,
          categoryId: allowance.discount_category_id,
          categoryName: category?.name || 'Category',
          discountPercentage: allowance.discount_percentage,
          maxDiscountAmount: allowance.max_discount_amount,
          notes: allowance.notes,
          createdBy: allowance.created_by,
          updatedBy: allowance.updated_by,
          createdAt: allowance.created_at,
          updatedAt: allowance.updated_at,
          totalUsed,
          remaining,
          effectiveMaxAllowed: maxAllowed,
          isEligible,
          isRevoked: allowance.max_discount_amount === 0 || !isEligible
        })
      }
    }

    // 4. Query all categories to compute available season/category combinations
    const { data: allCategories } = await supabase
      .from('discount_categories')
      .select('id, name')
      .order('name', { ascending: true })

    const assignedSet = new Set(rawAllowances.map(a => `${a.season_id}:${a.discount_category_id}`))
    const availableOptions = []

    for (const season of activeSeasons || []) {
      for (const category of allCategories || []) {
        const comboKey = `${season.id}:${category.id}`
        if (!assignedSet.has(comboKey)) {
          availableOptions.push({
            seasonId: season.id,
            seasonName: season.name,
            categoryId: category.id,
            categoryName: category.name
          })
        }
      }
    }

    return NextResponse.json({
      allowances: formattedAllowances,
      availableOptions
    })
  } catch (error) {
    logger.logAdminAction(
      'get-discount-allowances-error',
      'Error getting discount allowances',
      {
        error: error instanceof Error ? error.message : String(error)
      },
      'error'
    )
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * PUT /api/admin/users/[id]/discount-allowances
 * Upsert a user's discount allowance for a season/category combination
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const supabase = await createClient()
    const adminSupabase = createAdminClient()

    // Check if user is admin
    const { data: { user: currentUser }, error: authError } = await supabase.auth.getUser()
    if (authError || !currentUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: adminCheck } = await supabase
      .from('users')
      .select('is_admin')
      .eq('id', currentUser.id)
      .single()

    if (!adminCheck?.is_admin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json()
    const { seasonId, categoryId, discountPercentage, maxDiscountAmount, notes } = body

    if (!seasonId || !categoryId) {
      return NextResponse.json({ error: 'seasonId and categoryId are required' }, { status: 400 })
    }

    // 1. Validate percentage: required, 1-100
    if (
      discountPercentage === undefined ||
      discountPercentage === null ||
      typeof discountPercentage !== 'number' ||
      isNaN(discountPercentage) ||
      discountPercentage < 1 ||
      discountPercentage > 100
    ) {
      return NextResponse.json({ error: 'discountPercentage must be a number between 1 and 100' }, { status: 400 })
    }

    // 2. Validate maxDiscountAmount: null (uncapped) or >= 0 (cents)
    if (
      maxDiscountAmount !== null &&
      maxDiscountAmount !== undefined &&
      (typeof maxDiscountAmount !== 'number' || isNaN(maxDiscountAmount) || maxDiscountAmount < 0)
    ) {
      return NextResponse.json({ error: 'maxDiscountAmount must be null or a non-negative integer in cents' }, { status: 400 })
    }

    // 3. Validate season scope: end_date >= now
    const { data: season, error: seasonError } = await supabase
      .from('seasons')
      .select('id, name, end_date')
      .eq('id', seasonId)
      .single()

    if (seasonError || !season) {
      return NextResponse.json({ error: 'Season not found' }, { status: 404 })
    }

    if (new Date(season.end_date) < new Date()) {
      return NextResponse.json({ error: 'Writes to past seasons are not allowed' }, { status: 400 })
    }

    // 4. Fetch existing row for admin audit log before value
    const { data: existingRow } = await supabase
      .from('user_discount_allowances')
      .select('*')
      .eq('user_id', id)
      .eq('season_id', seasonId)
      .eq('discount_category_id', categoryId)
      .maybeSingle()

    const nowIso = new Date().toISOString()
    const payload = {
      user_id: id,
      season_id: seasonId,
      discount_category_id: categoryId,
      discount_percentage: discountPercentage,
      max_discount_amount: maxDiscountAmount ?? null,
      notes: notes ?? null,
      created_by: existingRow ? existingRow.created_by : currentUser.id,
      updated_by: currentUser.id,
      updated_at: nowIso
    }

    // 5. Upsert row
    const { data: updatedAllowance, error: upsertError } = await adminSupabase
      .from('user_discount_allowances')
      .upsert(payload, {
        onConflict: 'user_id,season_id,discount_category_id'
      })
      .select(`
        *,
        category:discount_categories(id, name),
        season:seasons(id, name)
      `)
      .single()

    if (upsertError) {
      logger.logAdminAction(
        'update-discount-allowance-error',
        'Error upserting discount allowance',
        {
          userId: id,
          seasonId,
          categoryId,
          error: upsertError.message
        },
        'error'
      )
      return NextResponse.json({ error: 'Failed to update discount allowance' }, { status: 500 })
    }

    // 6. Log admin action with before & after values
    logger.logAdminAction(
      'discount-allowance-updated',
      `Discount allowance ${existingRow ? 'updated' : 'created'} for user`,
      {
        targetUserId: id,
        adminUserId: currentUser.id,
        seasonId,
        categoryId,
        before: existingRow || null,
        after: updatedAllowance
      },
      'info'
    )

    return NextResponse.json({
      success: true,
      allowance: updatedAllowance
    })
  } catch (error) {
    logger.logAdminAction(
      'update-discount-allowance-exception',
      'Exception updating discount allowance',
      {
        error: error instanceof Error ? error.message : String(error)
      },
      'error'
    )
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
