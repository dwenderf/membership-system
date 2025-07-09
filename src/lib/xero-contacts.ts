import { Contact, ContactPerson } from 'xero-node'
import { getAuthenticatedXeroClient, logXeroSync } from './xero-client'
import { createClient } from './supabase/server'

export interface UserContactData {
  id: string
  email: string
  first_name: string
  last_name: string
  phone?: string
}

// Create or update a contact in Xero
export async function syncUserToXeroContact(
  userId: string,
  tenantId: string,
  userData: UserContactData
): Promise<{ success: boolean; xeroContactId?: string; error?: string }> {
  try {
    const supabase = await createClient()
    const xeroApi = await getAuthenticatedXeroClient(tenantId)

    if (!xeroApi) {
      return { success: false, error: 'Unable to authenticate with Xero' }
    }

    // Check if contact already exists in our tracking
    const { data: existingContact } = await supabase
      .from('xero_contacts')
      .select('*')
      .eq('user_id', userId)
      .eq('tenant_id', tenantId)
      .single()

    let xeroContactId: string | undefined
    let isUpdate = false

    if (existingContact && existingContact.xero_contact_id) {
      // Try to update existing contact
      xeroContactId = existingContact.xero_contact_id
      isUpdate = true
    } else {
      // Search for existing contact by email in Xero
      try {
        const searchResponse = await xeroApi.getContacts(
          tenantId,
          undefined,
          `EmailAddress="${userData.email}"`
        )

        if (searchResponse.body.contacts && searchResponse.body.contacts.length > 0) {
          const foundContacts = searchResponse.body.contacts
          
          if (foundContacts.length > 1) {
            // Multiple contacts found - log warning and attempt name matching
            console.warn(`⚠️ Multiple Xero contacts found for email ${userData.email} (${foundContacts.length} contacts)`)
            
            // Try to find exact name match first
            const exactNameMatch = foundContacts.find(contact => 
              contact.firstName === userData.first_name && 
              contact.lastName === userData.last_name
            )
            
            if (exactNameMatch && exactNameMatch.contactID) {
              xeroContactId = exactNameMatch.contactID
              console.log(`✅ Found exact name match for ${userData.first_name} ${userData.last_name}`)
            } else {
              // Try partial name matching as fallback
              const partialMatch = foundContacts.find(contact => {
                const contactFullName = `${contact.firstName || ''} ${contact.lastName || ''}`.trim().toLowerCase()
                const userFullName = `${userData.first_name} ${userData.last_name}`.toLowerCase()
                return contactFullName === userFullName
              })
              
              if (partialMatch && partialMatch.contactID) {
                xeroContactId = partialMatch.contactID
                console.log(`✅ Found partial name match for ${userData.first_name} ${userData.last_name}`)
              } else {
                // Fall back to first contact but log the decision
                xeroContactId = foundContacts[0].contactID
                console.warn(`⚠️ No name match found, using first contact: ${foundContacts[0].name || 'Unknown'} (ID: ${foundContacts[0].contactID})`)
              }
            }
          } else {
            // Single contact found - use it
            xeroContactId = foundContacts[0].contactID
            console.log(`✅ Single contact found for ${userData.email}`)
          }
          
          if (xeroContactId) {
            isUpdate = true
          }
        }
      } catch (searchError) {
        // If search fails, we'll create a new contact
        console.log('Contact search failed, will create new contact')
      }
    }

    // Prepare contact data
    const contactData: Contact = {
      name: `${userData.first_name} ${userData.last_name}`,
      firstName: userData.first_name,
      lastName: userData.last_name,
      emailAddress: userData.email,
      contactPersons: userData.phone ? [{
        firstName: userData.first_name,
        lastName: userData.last_name,
        emailAddress: userData.email,
        phoneNumber: userData.phone
      } as ContactPerson] : undefined
    }

    let response
    if (isUpdate && xeroContactId) {
      // Update existing contact
      contactData.contactID = xeroContactId
      response = await xeroApi.updateContact(tenantId, xeroContactId, {
        contacts: [contactData]
      })
    } else {
      // Create new contact
      response = await xeroApi.createContacts(tenantId, {
        contacts: [contactData]
      })
    }

    if (!response.body.contacts || response.body.contacts.length === 0) {
      await logXeroSync(
        tenantId,
        'contact_sync',
        'user',
        userId,
        null,
        'error',
        'no_contact_returned',
        'No contact returned from Xero API'
      )
      return { success: false, error: 'No contact returned from Xero API' }
    }

    const xeroContact = response.body.contacts[0]
    xeroContactId = xeroContact.contactID

    if (!xeroContactId) {
      await logXeroSync(
        tenantId,
        'contact_sync',
        'user',
        userId,
        null,
        'error',
        'no_contact_id',
        'No contact ID returned from Xero API'
      )
      return { success: false, error: 'No contact ID returned from Xero API' }
    }

    // Update or create our tracking record
    if (existingContact) {
      await supabase
        .from('xero_contacts')
        .update({
          xero_contact_id: xeroContactId,
          contact_number: xeroContact.contactNumber,
          sync_status: 'synced',
          last_synced_at: new Date().toISOString(),
          sync_error: null,
          updated_at: new Date().toISOString()
        })
        .eq('user_id', userId)
        .eq('tenant_id', tenantId)
    } else {
      await supabase
        .from('xero_contacts')
        .insert({
          user_id: userId,
          tenant_id: tenantId,
          xero_contact_id: xeroContactId,
          contact_number: xeroContact.contactNumber,
          sync_status: 'synced',
          last_synced_at: new Date().toISOString()
        })
    }

    // Enhanced logging for contact sync
    const logMessage = isUpdate 
      ? `Contact updated successfully (ID: ${xeroContactId})`
      : `Contact created successfully (ID: ${xeroContactId})`
    
    await logXeroSync(
      tenantId,
      'contact_sync',
      'user',
      userId,
      xeroContactId,
      'success',
      undefined,
      logMessage
    )

    return { success: true, xeroContactId }

  } catch (error) {
    console.error('Error syncing contact to Xero:', error)
    
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    const errorCode = (error as any)?.response?.body?.Elements?.[0]?.ValidationErrors?.[0]?.Message || 'sync_failed'

    // Update sync status to failed
    const supabase = await createClient()
    await supabase
      .from('xero_contacts')
      .upsert({
        user_id: userId,
        tenant_id: tenantId,
        sync_status: 'failed',
        sync_error: errorMessage,
        updated_at: new Date().toISOString()
      })

    await logXeroSync(
      tenantId,
      'contact_sync',
      'user',
      userId,
      null,
      'error',
      errorCode,
      errorMessage
    )

    return { success: false, error: errorMessage }
  }
}

// Get or create Xero contact for a user
export async function getOrCreateXeroContact(
  userId: string,
  tenantId: string
): Promise<{ success: boolean; xeroContactId?: string; error?: string }> {
  try {
    const supabase = await createClient()

    // Get user data
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('id, email, first_name, last_name, phone')
      .eq('id', userId)
      .single()

    if (userError || !userData) {
      return { success: false, error: 'User not found' }
    }

    // Check if contact already exists and is synced
    const { data: existingContact } = await supabase
      .from('xero_contacts')
      .select('*')
      .eq('user_id', userId)
      .eq('tenant_id', tenantId)
      .single()

    if (existingContact && existingContact.sync_status === 'synced' && existingContact.xero_contact_id) {
      return { success: true, xeroContactId: existingContact.xero_contact_id }
    }

    // Sync the contact
    return await syncUserToXeroContact(userId, tenantId, userData)

  } catch (error) {
    console.error('Error getting or creating Xero contact:', error)
    return { success: false, error: 'Failed to get or create contact' }
  }
}

// Debug function to find duplicate contacts by email
export async function findDuplicateContactsByEmail(
  tenantId: string,
  email: string
): Promise<{ success: boolean; contacts?: any[]; error?: string }> {
  try {
    const xeroApi = await getAuthenticatedXeroClient(tenantId)
    if (!xeroApi) {
      return { success: false, error: 'Unable to authenticate with Xero' }
    }

    const searchResponse = await xeroApi.getContacts(
      tenantId,
      undefined,
      `EmailAddress="${email}"`
    )

    if (searchResponse.body.contacts) {
      return { 
        success: true, 
        contacts: searchResponse.body.contacts.map(contact => ({
          contactID: contact.contactID,
          name: contact.name,
          firstName: contact.firstName,
          lastName: contact.lastName,
          emailAddress: contact.emailAddress,
          contactNumber: contact.contactNumber
        }))
      }
    }

    return { success: true, contacts: [] }
  } catch (error) {
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }
  }
}

// Bulk sync contacts for users who have made payments but aren't synced
export async function bulkSyncMissingContacts(tenantId: string): Promise<{
  success: boolean
  synced: number
  failed: number
  errors: string[]
}> {
  try {
    const supabase = await createClient()

    // Get users who have made payments but aren't synced to Xero
    const { data: usersNeedingSync, error: usersError } = await supabase
      .from('users')
      .select(`
        id, email, first_name, last_name, phone,
        payments!inner(id)
      `)
      .not('payments.id', 'is', null)
      .not('id', 'in', `(
        SELECT user_id FROM xero_contacts 
        WHERE tenant_id = '${tenantId}' 
        AND sync_status = 'synced'
      )`)

    if (usersError) {
      return { success: false, synced: 0, failed: 0, errors: [usersError.message] }
    }

    if (!usersNeedingSync || usersNeedingSync.length === 0) {
      return { success: true, synced: 0, failed: 0, errors: [] }
    }

    let syncedCount = 0
    let failedCount = 0
    const errors: string[] = []

    // Sync each user (with rate limiting to avoid overwhelming Xero API)
    for (const user of usersNeedingSync) {
      try {
        const result = await syncUserToXeroContact(user.id, tenantId, user)
        if (result.success) {
          syncedCount++
        } else {
          failedCount++
          if (result.error) {
            errors.push(`${user.email}: ${result.error}`)
          }
        }

        // Rate limiting - wait 100ms between requests
        await new Promise(resolve => setTimeout(resolve, 100))

      } catch (error) {
        failedCount++
        const errorMessage = error instanceof Error ? error.message : 'Unknown error'
        errors.push(`${user.email}: ${errorMessage}`)
      }
    }

    return {
      success: true,
      synced: syncedCount,
      failed: failedCount,
      errors
    }

  } catch (error) {
    console.error('Error in bulk sync:', error)
    return {
      success: false,
      synced: 0,
      failed: 0,
      errors: [error instanceof Error ? error.message : 'Unknown error']
    }
  }
}