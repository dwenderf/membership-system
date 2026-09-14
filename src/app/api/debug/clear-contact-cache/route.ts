import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { logger } from '@/lib/logging/logger'

// One-off debug utility for clearing a specific known-bad cached Xero contact
// (hard-coded contact ID). Not part of any regular sync flow.
export async function POST() {
  try {
    const supabase = createAdminClient()

    // Find the specific cached contact that's causing issues
    const { data: cachedContact, error: fetchError } = await supabase
      .from('xero_contacts')
      .select('*')
      .eq('xero_contact_id', 'f2d4371c-a474-4539-80e0-7c0cb63390b0')
      .single()

    if (fetchError) {
      logger.logSystem('debug-clear-contact-cache-fetch-error', 'Error fetching cached contact', { error: fetchError.message }, 'error')
      return NextResponse.json({
        success: false,
        error: 'Error fetching cached contact',
        details: fetchError.message
      }, { status: 500 })
    }

    if (!cachedContact) {
      return NextResponse.json({
        success: true,
        message: 'No cached contact found with that ID'
      })
    }

    // Clear the invalid cache by setting sync_status to 'pending'
    const { error: updateError } = await supabase
      .from('xero_contacts')
      .update({ sync_status: 'pending' })
      .eq('xero_contact_id', 'f2d4371c-a474-4539-80e0-7c0cb63390b0')

    if (updateError) {
      logger.logSystem('debug-clear-contact-cache-update-error', 'Error updating cached contact', { error: updateError.message }, 'error')
      return NextResponse.json({
        success: false,
        error: 'Error updating cached contact',
        details: updateError.message
      }, { status: 500 })
    }

    // Also check for any other potentially problematic cached contacts
    const { data: allCachedContacts, error: listError } = await supabase
      .from('xero_contacts')
      .select('user_id, xero_contact_id, sync_status, created_at')
      .eq('sync_status', 'synced')
      .order('created_at', { ascending: false })

    if (listError) {
      logger.logSystem('debug-clear-contact-cache-list-error', 'Error listing cached contacts', { error: listError.message }, 'error')
      return NextResponse.json({
        success: false,
        error: 'Error listing cached contacts',
        details: listError.message
      }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      message: 'Successfully cleared invalid contact cache',
      clearedContact: {
        userId: cachedContact.user_id,
        xeroContactId: cachedContact.xero_contact_id,
        previousStatus: cachedContact.sync_status
      },
      allCachedContacts: allCachedContacts?.length || 0
    })

  } catch (error) {
    logger.logSystem('debug-clear-contact-cache-failed', 'Debug clear-contact-cache script failed', { error: error instanceof Error ? error.message : String(error) }, 'error')
    return NextResponse.json({
      success: false,
      error: 'Script failed',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 })
  }
}