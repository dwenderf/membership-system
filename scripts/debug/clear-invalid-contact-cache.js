#!/usr/bin/env node

/**
 * Script to clear invalid cached Xero contacts
 * 
 * This script helps clear cached contact IDs that are pointing to archived contacts
 * Usage: node scripts/debug/clear-invalid-contact-cache.js
 */

import { createAdminClient } from '../../src/lib/supabase/server.js'

async function clearInvalidContactCache() {
  try {
    console.log('🧹 Clearing Invalid Xero Contact Cache')
    console.log('=====================================')
    console.log('')

    const supabase = createAdminClient()

    // Find the specific cached contact that's causing issues
    const { data: cachedContact, error: fetchError } = await supabase
      .from('xero_contacts')
      .select('*')
      .eq('xero_contact_id', 'f2d4371c-a474-4539-80e0-7c0cb63390b0')
      .single()

    if (fetchError) {
      console.log('❌ Error fetching cached contact:', fetchError.message)
      return
    }

    if (!cachedContact) {
      console.log('✅ No cached contact found with that ID')
      return
    }

    console.log('📋 Found cached contact:')
    console.log(`  User ID: ${cachedContact.user_id}`)
    console.log(`  Xero Contact ID: ${cachedContact.xero_contact_id}`)
    console.log(`  Sync Status: ${cachedContact.sync_status}`)
    console.log(`  Created: ${cachedContact.created_at}`)
    console.log('')

    // Clear the invalid cache by setting sync_status to 'pending'
    const { error: updateError } = await supabase
      .from('xero_contacts')
      .update({ sync_status: 'pending' })
      .eq('xero_contact_id', 'f2d4371c-a474-4539-80e0-7c0cb63390b0')

    if (updateError) {
      console.log('❌ Error updating cached contact:', updateError.message)
      return
    }

    console.log('✅ Successfully cleared invalid contact cache')
    console.log('   The next sync will create a new contact using the improved search strategy')
    console.log('')

    // Also check for any other potentially problematic cached contacts
    const { data: allCachedContacts, error: listError } = await supabase
      .from('xero_contacts')
      .select('user_id, xero_contact_id, sync_status, created_at')
      .eq('sync_status', 'synced')
      .order('created_at', { ascending: false })

    if (listError) {
      console.log('❌ Error listing cached contacts:', listError.message)
      return
    }

    console.log('📊 All cached contacts:')
    console.log(`  Total: ${allCachedContacts?.length || 0}`)
    allCachedContacts?.forEach((contact, index) => {
      console.log(`  ${index + 1}. User: ${contact.user_id}, Xero ID: ${contact.xero_contact_id}, Status: ${contact.sync_status}`)
    })

  } catch (error) {
    console.error('❌ Script failed:', error)
  }
}

clearInvalidContactCache() 