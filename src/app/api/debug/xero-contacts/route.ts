import { NextRequest, NextResponse } from 'next/server'
import { Contact } from 'xero-node'
import { getAuthenticatedXeroClient, getActiveTenant } from '@/lib/xero/client'
import { logger } from '@/lib/logging/logger'

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

    logger.logXeroSync('debug-contact-search-start', 'Xero Contact Search Debug', { email, memberId, contactId }, 'debug')

    // Get active tenant
    const activeTenant = await getActiveTenant()
    if (!activeTenant) {
      return NextResponse.json({ error: 'No active Xero tenant found' }, { status: 404 })
    }

    logger.logXeroSync('debug-contact-search-tenant', 'Using tenant', { tenantName: activeTenant.tenant_name, tenantId: activeTenant.tenant_id }, 'debug')

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
      try {
        const contactResponse = await xeroApi.accountingApi.getContact(
          activeTenant.tenant_id,
          contactId
        )

        if (contactResponse.body.contacts && contactResponse.body.contacts.length > 0) {
          const contact = contactResponse.body.contacts[0]

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
          logger.logXeroSync('debug-contact-id-search-found', 'Found contact by ID', { contactId, contact: results.contactIdSearch.contact }, 'debug')
        } else {
          logger.logXeroSync('debug-contact-id-search-not-found', 'No contact found with ID', { contactId }, 'debug')
          results.contactIdSearch = { found: false }
        }
      } catch (contactError) {
        const message = errorMessage(contactError)
        logger.logXeroSync('debug-contact-id-search-failed', 'Contact ID search failed', { contactId, error: message }, 'warn')
        results.contactIdSearch = { found: false, error: message }
      }
    }

    // Step 1: Search by exact contact name first (if member ID provided)
    if (memberId) {
      // Clean the memberId to remove any extra quotes or encoding
      const cleanMemberId = memberId.replace(/"/g, '')
      const expectedContactName = `David Wender - ${cleanMemberId}`

      try {
        const nameSearchResponse = await xeroApi.accountingApi.getContacts(
          activeTenant.tenant_id,
          undefined,
          `Name="${expectedContactName}"`
        )

        if (nameSearchResponse.body.contacts && nameSearchResponse.body.contacts.length > 0) {
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

          logger.logXeroSync('debug-name-search-found', 'Found contact(s) with exact name', {
            expectedContactName,
            count: results.nameSearch.count,
            contacts: results.nameSearch.contacts
          }, 'debug')
        } else {
          logger.logXeroSync('debug-name-search-not-found', 'No contacts found with exact name', { expectedContactName }, 'debug')
          results.nameSearch = { found: false, count: 0, contacts: [] }
        }
      } catch (nameSearchError) {
        const message = errorMessage(nameSearchError)
        logger.logXeroSync('debug-name-search-failed', 'Name search failed', { expectedContactName, error: message }, 'warn')
        results.nameSearch = { found: false, error: message }
      }
    }

    // Step 2: Search by email (only if email provided)
    if (email) {
      try {
        const emailSearchResponse = await xeroApi.accountingApi.getContacts(
          activeTenant.tenant_id,
          undefined,
          `EmailAddress="${email}"`
        )

        if (emailSearchResponse.body.contacts && emailSearchResponse.body.contacts.length > 0) {
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

          logger.logXeroSync('debug-email-search-found', 'Found contact(s) with email', {
            email,
            count: results.emailSearch.count,
            contacts: results.emailSearch.contacts
          }, 'debug')

          // Analyze the results
          const archivedContacts = emailSearchResponse.body.contacts.filter(c => c.contactStatus === Contact.ContactStatusEnum.ARCHIVED)
          const activeContacts = emailSearchResponse.body.contacts.filter(c => c.contactStatus !== Contact.ContactStatusEnum.ARCHIVED)

          const analysis: AnalysisResult = {
            total: emailSearchResponse.body.contacts.length,
            active: activeContacts.length,
            archived: archivedContacts.length
          }

          if (memberId) {
            const cleanMemberId = memberId.replace(/"/g, '')
            const expectedName = `David Wender - ${cleanMemberId}`
            const exactMatch = emailSearchResponse.body.contacts.find(c => c.name === expectedName)

            if (exactMatch) {
              analysis.exactMatch = {
                found: true,
                contactID: exactMatch.contactID,
                status: exactMatch.contactStatus || Contact.ContactStatusEnum.ACTIVE,
                isArchived: exactMatch.contactStatus === Contact.ContactStatusEnum.ARCHIVED
              }
            } else {
              analysis.exactMatch = { found: false }
            }
          }

          logger.logXeroSync('debug-email-search-analysis', 'Analyzed email search results', { email, analysis }, 'debug')

          results.analysis = analysis
        } else {
          logger.logXeroSync('debug-email-search-not-found', 'No contacts found with email', { email }, 'debug')
          results.emailSearch = { found: false, count: 0, contacts: [] }
          results.analysis = { total: 0, active: 0, archived: 0 }
        }
      } catch (emailSearchError) {
        const message = errorMessage(emailSearchError)
        logger.logXeroSync('debug-email-search-failed', 'Email search failed', { email, error: message }, 'warn')
        results.emailSearch = { found: false, error: message }
      }
    }

    return NextResponse.json(results)

  } catch (error) {
    logger.logXeroSync('debug-xero-contacts-failed', 'Debug script failed', { error: error instanceof Error ? error.message : String(error) }, 'error')
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 })
  }
}