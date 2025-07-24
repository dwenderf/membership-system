import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { getAuthenticatedXeroClient, getActiveTenant } from '@/lib/xero/client'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const email = searchParams.get('email')
    const memberId = searchParams.get('memberId')

    if (!email) {
      return NextResponse.json({ 
        error: 'Email parameter is required',
        usage: 'GET /api/debug-xero-contacts?email=david@example.com&memberId=1002'
      }, { status: 400 })
    }

    console.log('🔍 Xero Contact Search Debug')
    console.log('============================')
    console.log(`Email: ${email}`)
    console.log(`Member ID: ${memberId || 'Not provided'}`)
    console.log('')

    // Get active tenant
    const activeTenant = await getActiveTenant()
    if (!activeTenant) {
      return NextResponse.json({ error: 'No active Xero tenant found' }, { status: 404 })
    }

    console.log(`🏢 Using tenant: ${activeTenant.tenant_name} (${activeTenant.tenant_id})`)
    console.log('')

    // Get authenticated Xero client
    const xeroApi = await getAuthenticatedXeroClient(activeTenant.tenant_id)
    if (!xeroApi) {
      return NextResponse.json({ error: 'Unable to authenticate with Xero' }, { status: 500 })
    }

    const results = {
      email,
      memberId,
      tenant: activeTenant.tenant_name,
      nameSearch: null,
      emailSearch: null,
      analysis: null
    }

    // Step 1: Search by exact contact name first (if member ID provided)
    if (memberId) {
      const expectedContactName = `David Wender - ${memberId}`
      console.log(`🔍 Step 1: Searching for exact contact name: "${expectedContactName}"`)
      
      try {
        const nameSearchResponse = await xeroApi.accountingApi.getContacts(
          activeTenant.tenant_id,
          undefined,
          `Name="${expectedContactName}"`
        )
        
        if (nameSearchResponse.body.contacts && nameSearchResponse.body.contacts.length > 0) {
          console.log(`✅ Found ${nameSearchResponse.body.contacts.length} contact(s) with exact name:`)
          
          results.nameSearch = {
            found: true,
            count: nameSearchResponse.body.contacts.length,
            contacts: nameSearchResponse.body.contacts.map(contact => ({
              name: contact.name,
              contactID: contact.contactID,
              status: contact.contactStatus || 'ACTIVE',
              email: contact.emailAddress,
              firstName: contact.firstName,
              lastName: contact.lastName,
              isArchived: contact.contactStatus === 'ARCHIVED'
            }))
          }
          
          nameSearchResponse.body.contacts.forEach((contact, index) => {
            console.log(`  ${index + 1}. Name: "${contact.name}"`)
            console.log(`     ID: ${contact.contactID}`)
            console.log(`     Status: ${contact.contactStatus || 'ACTIVE'}`)
            console.log(`     Email: ${contact.emailAddress || 'None'}`)
            console.log(`     First Name: ${contact.firstName || 'None'}`)
            console.log(`     Last Name: ${contact.lastName || 'None'}`)
            
            if (contact.contactStatus === 'ARCHIVED') {
              console.log(`     ⚠️  ARCHIVED - Would be renamed to "${contact.name} - Archived"`)
            }
            console.log('')
          })
        } else {
          console.log(`❌ No contacts found with exact name: "${expectedContactName}"`)
          results.nameSearch = { found: false, count: 0, contacts: [] }
        }
      } catch (nameSearchError) {
        console.log(`❌ Name search failed:`, nameSearchError.message)
        results.nameSearch = { found: false, error: nameSearchError.message }
      }
    }

    // Step 2: Search by email
    console.log(`🔍 Step 2: Searching by email: "${email}"`)
    
    try {
      const emailSearchResponse = await xeroApi.accountingApi.getContacts(
        activeTenant.tenant_id,
        undefined,
        `EmailAddress="${email}"`
      )

      if (emailSearchResponse.body.contacts && emailSearchResponse.body.contacts.length > 0) {
        console.log(`✅ Found ${emailSearchResponse.body.contacts.length} contact(s) with email:`)
        
        results.emailSearch = {
          found: true,
          count: emailSearchResponse.body.contacts.length,
          contacts: emailSearchResponse.body.contacts.map(contact => ({
            name: contact.name,
            contactID: contact.contactID,
            status: contact.contactStatus || 'ACTIVE',
            email: contact.emailAddress,
            firstName: contact.firstName,
            lastName: contact.lastName,
            isArchived: contact.contactStatus === 'ARCHIVED'
          }))
        }
        
        emailSearchResponse.body.contacts.forEach((contact, index) => {
          console.log(`  ${index + 1}. Name: "${contact.name}"`)
          console.log(`     ID: ${contact.contactID}`)
          console.log(`     Status: ${contact.contactStatus || 'ACTIVE'}`)
          console.log(`     Email: ${contact.emailAddress || 'None'}`)
          console.log(`     First Name: ${contact.firstName || 'None'}`)
          console.log(`     Last Name: ${contact.lastName || 'None'}`)
          console.log('')
        })

        // Analyze the results
        const archivedContacts = emailSearchResponse.body.contacts.filter(c => c.contactStatus === 'ARCHIVED')
        const activeContacts = emailSearchResponse.body.contacts.filter(c => c.contactStatus !== 'ARCHIVED')
        
        results.analysis = {
          total: emailSearchResponse.body.contacts.length,
          active: activeContacts.length,
          archived: archivedContacts.length
        }
        
        console.log('📊 Analysis:')
        console.log(`  Total contacts: ${emailSearchResponse.body.contacts.length}`)
        console.log(`  Active contacts: ${activeContacts.length}`)
        console.log(`  Archived contacts: ${archivedContacts.length}`)
        console.log('')

        if (memberId) {
          const expectedName = `David Wender - ${memberId}`
          const exactMatch = emailSearchResponse.body.contacts.find(c => c.name === expectedName)
          
          if (exactMatch) {
            console.log(`🎯 Exact name match found: "${exactMatch.name}" (${exactMatch.contactID})`)
            console.log(`   Status: ${exactMatch.contactStatus || 'ACTIVE'}`)
            if (exactMatch.contactStatus === 'ARCHIVED') {
              console.log('   ⚠️  WARNING: This contact is archived!')
            }
            results.analysis.exactMatch = {
              found: true,
              contactID: exactMatch.contactID,
              status: exactMatch.contactStatus || 'ACTIVE',
              isArchived: exactMatch.contactStatus === 'ARCHIVED'
            }
          } else {
            console.log(`❌ No exact name match found for: "${expectedName}"`)
            results.analysis.exactMatch = { found: false }
          }
        }
      } else {
        console.log(`❌ No contacts found with email: "${email}"`)
        results.emailSearch = { found: false, count: 0, contacts: [] }
        results.analysis = { total: 0, active: 0, archived: 0 }
      }
    } catch (emailSearchError) {
      console.log(`❌ Email search failed:`, emailSearchError.message)
      results.emailSearch = { found: false, error: emailSearchError.message }
    }

    return NextResponse.json(results)

  } catch (error) {
    console.error('❌ Debug script failed:', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 })
  }
} 