import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { getActiveTenant } from '@/lib/xero/client'
import { getFrequentlyUsedAccountingCodes } from '@/lib/accounting-codes'
import { getLastSyncInfo } from '@/lib/xero/accounts-sync'

/**
 * Fetch Xero Accounts
 * GET /api/xero/accounts?search={query}&inUse={boolean}&type={accountType}
 *
 * Returns cached Xero chart of accounts with intelligent sorting:
 * 1. Frequently used codes first (sorted by usage count)
 * 2. Remaining codes sorted by code (alphanumeric)
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const search = searchParams.get('search') || ''
    const inUse = searchParams.get('inUse') === 'true'
    const type = searchParams.get('type') || ''

    // Get active tenant
    const activeTenant = await getActiveTenant()
    if (!activeTenant) {
      return NextResponse.json(
        { error: 'No active Xero connection' },
        { status: 404 }
      )
    }

    const supabase = createAdminClient()

    // Get frequently used codes (top 3 per type)
    const frequentlyUsed = await getFrequentlyUsedAccountingCodes()
    // Create a map of code -> type for frequently used codes
    const frequentCodesMap = new Map(frequentlyUsed.map(item => [item.code, item.type]))

    // Build query
    let query = supabase
      .from('xero_accounts')
      .select('code, name, type, description')
      .eq('tenant_id', activeTenant.tenant_id)
      .eq('status', 'ACTIVE')

    // Apply search filter
    if (search) {
      query = query.or(`code.ilike.%${search}%,name.ilike.%${search}%`)
    }

    // Apply type filter
    if (type) {
      query = query.eq('type', type)
    }

    const { data: accounts, error } = await query

    if (error) {
      console.error('Error fetching Xero accounts:', error)
      return NextResponse.json(
        { error: 'Failed to fetch accounts' },
        { status: 500 }
      )
    }

    // Get codes currently in use in the system
    let inUseCodesSet = new Set<string>()
    if (inUse || !search) { // Always calculate for marking in dropdown
      const { data: memberships } = await supabase
        .from('memberships')
        .select('accounting_code')
        .not('accounting_code', 'is', null)

      const { data: regCategories } = await supabase
        .from('registration_categories')
        .select('accounting_code')
        .not('accounting_code', 'is', null)

      const { data: discountCategories } = await supabase
        .from('discount_categories')
        .select('accounting_code')
        .not('accounting_code', 'is', null)

      const { data: systemCodes } = await supabase
        .from('system_accounting_codes')
        .select('accounting_code')
        .not('accounting_code', 'is', null)

      inUseCodesSet = new Set([
        ...(memberships || []).map(m => m.accounting_code),
        ...(regCategories || []).map(r => r.accounting_code),
        ...(discountCategories || []).map(d => d.accounting_code),
        ...(systemCodes || []).map(s => s.accounting_code)
      ])
    }

    // Add inUse flag to accounts
    const accountsWithUsage = (accounts || []).map(account => ({
      ...account,
      inUse: inUseCodesSet.has(account.code)
    }))

    // Filter by inUse if requested
    const filteredAccounts = inUse
      ? accountsWithUsage.filter(a => a.inUse)
      : accountsWithUsage

    // Sort: frequently used first (by usage count), then by code
    const sortedAccounts = filteredAccounts.sort((a, b) => {
      const aFrequent = frequentCodesMap.has(a.code)
      const bFrequent = frequentCodesMap.has(b.code)

      if (aFrequent && !bFrequent) return -1
      if (!aFrequent && bFrequent) return 1

      if (aFrequent && bFrequent) {
        // Both frequent - sort by usage count
        const aUsage = frequentlyUsed.find(f => f.code === a.code)?.count || 0
        const bUsage = frequentlyUsed.find(f => f.code === b.code)?.count || 0
        if (aUsage !== bUsage) return bUsage - aUsage
      }

      // Sort by code (alphanumeric)
      return a.code.localeCompare(b.code, undefined, { numeric: true })
    })

    // Get last sync info
    const syncInfo = await getLastSyncInfo(activeTenant.tenant_id)

    return NextResponse.json({
      accounts: sortedAccounts,
      frequentlyUsedByType: Object.fromEntries(frequentCodesMap), // Map of code -> type
      lastSyncedAt: syncInfo?.lastSyncedAt || null,
      totalCount: sortedAccounts.length
    })

  } catch (error) {
    console.error('Error fetching Xero accounts:', error)

    return NextResponse.json(
      { error: 'Error fetching accounts' },
      { status: 500 }
    )
  }
}
