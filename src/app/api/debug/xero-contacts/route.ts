import { NextRequest, NextResponse } from 'next/server'
import { Contact } from 'xero-node'
import { getAuthenticatedXeroClient, getActiveTenant } from '@/lib/xero/client'

interface ContactSummary {
  name?: string
  contactID?: string
  status: Contact.ContactStatusEnum | string
  email?: string
  firstName?: string
  lastName?: string
  isArchived: boolean
}

interface ContactIdSearchResult {
  found: boolean
  contact?: ContactSummary
  error?: string
}

interface NameOrEmailSearchResult {
  found: boolean
  count?: number
  contacts?: ContactSummary[]
  error?: string
}

interface ExactMatchResult {
  found: boolean
  contactID?: string
  status?: Contact.ContactStatusEnum | string
  isArchived?: boolean
}

interface AnalysisResult {
  total: number
  active: number
  archived: number
  exactMatch?: ExactMatchResult
}

interface DebugResults {
  email: string | null
  memberId: string | null
  contactId: string | null
  tenant: string
  nameSearch: NameOrEmailSearchResult | null
  emailSearch: NameOrEmailSearchResult | null
  contactIdSearch: ContactIdSearchResult | null
  analysis: AnalysisResult | null
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const email = searchParams.get('email')
    const memberId = searchParams.get('memberId')
    const contactId = searchParams.get('contactId') // New parameter for debugging specific contact

    if (!email && !contactId) {
      return NextResponse.json({
        error: 'Either email or contactId parameter is required',
        usage: 'GET /api/debug-xero-contacts?email=david@example.com&memberId=1002\nGET /api/debug-xero-contacts?contactId=f2d4371c-a474-4539-80e0-7c0cb63390b0'
      }, { status: 400 })
    }

    console.log('🔍 Xero Contact Search Debug')
    console.log('============================')
    if (email) console.log(`Email: ${email}`)
    if (memberId) console.log(`Member ID: ${memberId}`)
    if (contactId) console.log(`Contact ID: ${contactId}`)
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

    const results: DebugResults = {
      email,
      memberId,
      contactId,
      tenant: activeTenant.tenant_name,
      nameSearch: null,
      emailSearch: null,
      contactIdSearch: null,
      analysis: null
    }

    // Step 0: Search by specific contact ID (if provided)
    if (contactId) {
      console.log(`🔍 Step 0: Searching for specific contact ID: "${contactId}"`)

      try {
        const contactResponse = await xeroApi.accountingApi.getContact(
          activeTenant.tenant_id,
          contactId
        )

        if (contactResponse.body.contacts && contactResponse.body.contacts.length > 0) {
          const contact = contactResponse.body.contacts[0]
          console.log(`✅ Found contact with ID "${contactId}":`)
          console.log(`  Name: "${contact.name}"`)
          console.log(`  Status: ${contact.contactStatus || 'ACTIVE'}`)
          console.log(`  Email: ${contact.emailAddress || 'None'}`)
          console.log(`  First Name: ${contact.firstName || 'None'}`)
          console.log(`  Last Name: ${contact.lastName || 'None'}`)
          console.log('')

          results.contactIdSearch = {
            found: true,
            contact: {
              name: contact.name,
              contactID: contact.contactID,
              status: contact.contactStatus || Contact.ContactStatusEnum.ACTIVE,
              email: contact.emailAddress,
              firstName: contact.firstName,
              lastName: contact.lastName,
              isArchived: contact.contactStatus === Contact.ContactStatusEnum.ARCHIVED
            }
          }
        } else {
          console.log(`❌ No contact found with ID: "${contactId}"`)
          results.contactIdSearch = { found: false }
        }
      } catch (contactError) {
        const message = errorMessage(contactError)
        console.log(`❌ Contact ID search failed:`, message)
        results.contactIdSearch = { found: false, error: message }
      }
    }

    // Step 1: Search by exact contact name first (if member ID provided)
    if (memberId) {
      // Clean the memberId to remove any extra quotes or encoding
      const cleanMemberId = memberId.replace(/"/g, '')
      const expectedContactName = `David Wender - ${cleanMemberId}`
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
              status: contact.contactStatus || Contact.ContactStatusEnum.ACTIVE,
              email: contact.emailAddress,
              firstName: contact.firstName,
              lastName: contact.lastName,
              isArchived: contact.contactStatus === Contact.ContactStatusEnum.ARCHIVED
            }))
          }

          nameSearchResponse.body.contacts.forEach((contact, index) => {
            console.log(`  ${index + 1}. Name: "${contact.name}"`)
            console.log(`     ID: ${contact.contactID}`)
            console.log(`     Status: ${contact.contactStatus || 'ACTIVE'}`)
            console.log(`     Email: ${contact.emailAddress || 'None'}`)
            console.log(`     First Name: ${contact.firstName || 'None'}`)
            console.log(`     Last Name: ${contact.lastName || 'None'}`)

            if (contact.contactStatus === Contact.ContactStatusEnum.ARCHIVED) {
              console.log(`     ⚠️  ARCHIVED - Would be renamed to "${contact.name} - Archived"`)
            }
            console.log('')
          })
        } else {
          console.log(`❌ No contacts found with exact name: "${expectedContactName}"`)
          results.nameSearch = { found: false, count: 0, contacts: [] }
        }
      } catch (nameSearchError) {
        const message = errorMessage(nameSearchError)
        console.log(`❌ Name search failed:`, message)
        results.nameSearch = { found: false, error: message }
      }
    }

    // Step 2: Search by email (only if email provided)
    if (email) {
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
              status: contact.contactStatus || Contact.ContactStatusEnum.ACTIVE,
              email: contact.emailAddress,
              firstName: contact.firstName,
              lastName: contact.lastName,
              isArchived: contact.contactStatus === Contact.ContactStatusEnum.ARCHIVED
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
          const archivedContacts = emailSearchResponse.body.contacts.filter(c => c.contactStatus === Contact.ContactStatusEnum.ARCHIVED)
          const activeContacts = emailSearchResponse.body.contacts.filter(c => c.contactStatus !== Contact.ContactStatusEnum.ARCHIVED)

          const analysis: AnalysisResult = {
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
            const cleanMemberId = memberId.replace(/"/g, '')
            const expectedName = `David Wender - ${cleanMemberId}`
            const exactMatch = emailSearchResponse.body.contacts.find(c => c.name === expectedName)

            if (exactMatch) {
              console.log(`🎯 Exact name match found: "${exactMatch.name}" (${exactMatch.contactID})`)
              console.log(`   Status: ${exactMatch.contactStatus || 'ACTIVE'}`)
              if (exactMatch.contactStatus === Contact.ContactStatusEnum.ARCHIVED) {
                console.log('   ⚠️  WARNING: This contact is archived!')
              }
              analysis.exactMatch = {
                found: true,
                contactID: exactMatch.contactID,
                status: exactMatch.contactStatus || Contact.ContactStatusEnum.ACTIVE,
                isArchived: exactMatch.contactStatus === Contact.ContactStatusEnum.ARCHIVED
              }
            } else {
              console.log(`❌ No exact name match found for: "${expectedName}"`)
              analysis.exactMatch = { found: false }
            }
          }

          results.analysis = analysis
        } else {
          console.log(`❌ No contacts found with email: "${email}"`)
          results.emailSearch = { found: false, count: 0, contacts: [] }
          results.analysis = { total: 0, active: 0, archived: 0 }
        }
      } catch (emailSearchError) {
        const message = errorMessage(emailSearchError)
        console.log(`❌ Email search failed:`, message)
        results.emailSearch = { found: false, error: message }
      }
    }

    return NextResponse.json(results)

  } catch (error) {
    console.error('❌ Debug script failed:', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 })
  }
}