import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'

export async function POST(request: NextRequest) {
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
      return NextResponse.json({ 
        success: false, 
        error: 'Error fetching cached contact',
        details: fetchError.message 
      }, { status: 500 })
    }

    if (!cachedContact) {
      console.log('✅ No cached contact found with that ID')
      return NextResponse.json({ 
        success: true, 
        message: 'No cached contact found with that ID' 
      })
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
      return NextResponse.json({ 
        success: false, 
        error: 'Error updating cached contact',
        details: updateError.message 
      }, { status: 500 })
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
      return NextResponse.json({ 
        success: false, 
        error: 'Error listing cached contacts',
        details: listError.message 
      }, { status: 500 })
    }

    console.log('📊 All cached contacts:')
    console.log(`  Total: ${allCachedContacts?.length || 0}`)
    allCachedContacts?.forEach((contact, index) => {
      console.log(`  ${index + 1}. User: ${contact.user_id}, Xero ID: ${contact.xero_contact_id}, Status: ${contact.sync_status}`)
    })

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
    console.error('❌ Script failed:', error)
    return NextResponse.json({ 
      success: false, 
      error: 'Script failed',
      details: error instanceof Error ? error.message : 'Unknown error' 
    }, { status: 500 })
  }
} 