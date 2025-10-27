/**
 * Xero Chart of Accounts Sync Service
 *
 * Syncs Xero chart of accounts to local database for:
 * - Fast autocomplete/validation (no API calls per request)
 * - Offline functionality
 * - Rate limit management
 */

import { createAdminClient } from '@/lib/supabase/server'
import { getAuthenticatedXeroClient, getActiveTenant } from './client'
import { logger } from '@/lib/logging/logger'

export interface SyncResult {
  success: boolean
  totalAccounts: number
  added: number
  updated: number
  removed: number
  lastSyncedAt: string
  error?: string
}

/**
 * Sync Xero chart of accounts to local database
 * @param tenantId Optional Xero tenant ID. If not provided, uses active tenant.
 * @returns Sync result with statistics
 */
export async function syncXeroAccounts(tenantId?: string): Promise<SyncResult> {
  const supabase = createAdminClient()
  const syncStartTime = new Date().toISOString()

  try {
    // Get tenant ID if not provided
    if (!tenantId) {
      const activeTenant = await getActiveTenant()
      if (!activeTenant) {
        return {
          success: false,
          totalAccounts: 0,
          added: 0,
          updated: 0,
          removed: 0,
          lastSyncedAt: syncStartTime,
          error: 'No active Xero connection found'
        }
      }
      tenantId = activeTenant.tenant_id
    }

    logger.logXeroSync(
      'accounts-sync-start',
      'Starting Xero chart of accounts sync',
      { tenantId }
    )

    // Get authenticated Xero client
    const xeroClient = await getAuthenticatedXeroClient(tenantId)

    // Fetch chart of accounts from Xero
    const accountsResponse = await xeroClient.accountingApi.getAccounts(tenantId)
    const xeroAccounts = accountsResponse.body.accounts || []

    logger.logXeroSync(
      'accounts-fetched',
      `Fetched ${xeroAccounts.length} accounts from Xero`,
      { tenantId, count: xeroAccounts.length }
    )

    // Filter to only ACTIVE accounts
    const activeAccounts = xeroAccounts.filter(account =>
      account.status === 'ACTIVE' && account.code && account.name
    )

    logger.logXeroSync(
      'accounts-filtered',
      `Filtered to ${activeAccounts.length} ACTIVE accounts`,
      { tenantId, totalCount: xeroAccounts.length, activeCount: activeAccounts.length }
    )

    // Get existing accounts from database for this tenant
    const { data: existingAccounts } = await supabase
      .from('xero_accounts')
      .select('xero_account_id, code, name, type')
      .eq('tenant_id', tenantId)

    const existingAccountsMap = new Map(
      (existingAccounts || []).map(acc => [acc.xero_account_id, acc])
    )

    // Track sync statistics
    let added = 0
    let updated = 0

    // Upsert accounts
    for (const account of activeAccounts) {
      if (!account.accountID) continue

      const accountData = {
        tenant_id: tenantId,
        xero_account_id: account.accountID,
        code: account.code!,
        name: account.name!,
        type: account.type || 'UNKNOWN',
        status: account.status || 'ACTIVE',
        description: account.description || null,
        last_synced_at: syncStartTime,
        updated_at: syncStartTime
      }

      const existing = existingAccountsMap.get(account.accountID)

      if (existing) {
        // Check if update is needed
        const needsUpdate =
          existing.code !== accountData.code ||
          existing.name !== accountData.name ||
          existing.type !== accountData.type

        if (needsUpdate) {
          const { error } = await supabase
            .from('xero_accounts')
            .update(accountData)
            .eq('tenant_id', tenantId)
            .eq('xero_account_id', account.accountID)

          if (error) {
            logger.logXeroSync(
              'account-update-error',
              'Error updating account',
              { tenantId, accountId: account.accountID, error: error.message },
              'error'
            )
          } else {
            updated++
          }
        }
      } else {
        // Insert new account
        const { error } = await supabase
          .from('xero_accounts')
          .insert({
            ...accountData,
            created_at: syncStartTime
          })

        if (error) {
          logger.logXeroSync(
            'account-insert-error',
            'Error inserting account',
            { tenantId, accountId: account.accountID, error: error.message },
            'error'
          )
        } else {
          added++
        }
      }
    }

    // Remove accounts that no longer exist in Xero or are no longer ACTIVE
    const xeroAccountIds = new Set(
      activeAccounts.map(acc => acc.accountID).filter(Boolean) as string[]
    )

    const accountsToRemove = (existingAccounts || []).filter(
      acc => !xeroAccountIds.has(acc.xero_account_id)
    )

    let removed = 0
    if (accountsToRemove.length > 0) {
      const { error } = await supabase
        .from('xero_accounts')
        .delete()
        .eq('tenant_id', tenantId)
        .in('xero_account_id', accountsToRemove.map(acc => acc.xero_account_id))

      if (error) {
        logger.logXeroSync(
          'accounts-removal-error',
          'Error removing old accounts',
          { tenantId, count: accountsToRemove.length, error: error.message },
          'error'
        )
      } else {
        removed = accountsToRemove.length
      }
    }

    const result: SyncResult = {
      success: true,
      totalAccounts: activeAccounts.length,
      added,
      updated,
      removed,
      lastSyncedAt: syncStartTime
    }

    logger.logXeroSync(
      'accounts-sync-complete',
      'Successfully synced Xero chart of accounts',
      { tenantId, ...result }
    )

    return result

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)

    logger.logXeroSync(
      'accounts-sync-error',
      'Failed to sync Xero chart of accounts',
      { tenantId, error: errorMessage },
      'error'
    )

    return {
      success: false,
      totalAccounts: 0,
      added: 0,
      updated: 0,
      removed: 0,
      lastSyncedAt: syncStartTime,
      error: errorMessage
    }
  }
}

/**
 * Get last sync information for a tenant
 * @param tenantId Xero tenant ID
 * @returns Last sync timestamp and account count, or null if never synced
 */
export async function getLastSyncInfo(tenantId?: string): Promise<{
  lastSyncedAt: string
  accountCount: number
} | null> {
  const supabase = createAdminClient()

  try {
    // Get tenant ID if not provided
    if (!tenantId) {
      const activeTenant = await getActiveTenant()
      if (!activeTenant) return null
      tenantId = activeTenant.tenant_id
    }

    const { data, error } = await supabase
      .from('xero_accounts')
      .select('last_synced_at')
      .eq('tenant_id', tenantId)
      .order('last_synced_at', { ascending: false })
      .limit(1)

    if (error || !data || data.length === 0) {
      return null
    }

    const { count } = await supabase
      .from('xero_accounts')
      .select('*', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)

    return {
      lastSyncedAt: data[0].last_synced_at,
      accountCount: count || 0
    }
  } catch (error) {
    logger.logXeroSync(
      'last-sync-info-error',
      'Error getting last sync info',
      { tenantId, error: error instanceof Error ? error.message : String(error) },
      'error'
    )
    return null
  }
}
