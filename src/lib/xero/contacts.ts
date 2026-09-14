import { Contact, ContactPerson } from 'xero-node'
import { getAuthenticatedXeroClient, logXeroSync } from './client'
import { createAdminClient } from '../supabase/admin'
import * as Sentry from '@sentry/nextjs'
import { getXeroValidationMessage, XeroApiError } from './xero-errors'
import { logger } from '@/lib/logging/logger'

// Helper function to generate contact name following our naming convention
export function generateContactName(firstName: string, lastName: string, memberId?: number | null): string {
  if (memberId) {
    return `${firstName} ${lastName} - ${memberId}`
  } else {
    return `${firstName} ${lastName}`
  }
}

export interface UserContactData {
  id: string
  email: string
  first_name: string
  last_name: string
  phone?: string
  member_id?: number
}

// Create or update a contact in Xero
export async function syncUserToXeroContact(
  userId: string,
  tenantId: string,
  userData: UserContactData
): Promise<{ success: boolean; xeroContactId?: string; error?: string }> {
  try {
    const supabase = createAdminClient()
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
      // NEW STRATEGY: Search by exact contact name first (including member ID), then fall back to email
      let foundContacts: Contact[] = []
      let searchMethod = 'none'
      
      // Step 1: Search by exact contact name (including member ID if available)
      const expectedContactName = generateContactName(userData.first_name, userData.last_name, userData.member_id)

      try {
        const nameSearchResponse = await xeroApi.accountingApi.getContacts(
          tenantId,
          undefined,
          `Name="${expectedContactName}"`
        )

        if (nameSearchResponse.body.contacts && nameSearchResponse.body.contacts.length > 0) {
          foundContacts = nameSearchResponse.body.contacts
          searchMethod = 'exact-name'

          // Check if the found contact is archived
          const foundContact = foundContacts[0] // Should be only one with exact name
          const isArchived = foundContact.contactStatus === Contact.ContactStatusEnum.ARCHIVED

          if (isArchived) {
            logger.logXeroSync('contact-search-archived-match', `Found archived contact with exact name: "${foundContact.name}"`, { contactID: foundContact.contactID, expectedContactName }, 'debug')

            // Rename the archived contact to avoid conflicts
            if (foundContact.contactID) {
              try {
                const archivedContactName = `${expectedContactName} - Archived`

                await xeroApi.accountingApi.updateContact(tenantId, foundContact.contactID, {
                  contacts: [{
                    contactID: foundContact.contactID,
                    name: archivedContactName,
                    firstName: userData.first_name,
                    lastName: userData.last_name,
                    emailAddress: userData.email,
                    contactStatus: Contact.ContactStatusEnum.ARCHIVED // Keep it archived
                  }]
                })

                logger.logXeroSync('contact-archived-renamed', `Renamed archived contact to avoid conflicts: "${archivedContactName}"`, { contactID: foundContact.contactID }, 'info')

                // Don't use this contact - we'll create a new one
                xeroContactId = undefined
                isUpdate = false

              } catch (renameError) {
                logger.logXeroSync('contact-archived-rename-failed', 'Failed to rename archived contact', { contactID: foundContact.contactID, error: renameError instanceof Error ? renameError.message : String(renameError) }, 'warn')
                // If rename fails, we'll still create a new contact with timestamp
                xeroContactId = undefined
                isUpdate = false
              }
            }
          } else {
            // Contact is active - use it
            xeroContactId = foundContact.contactID
            isUpdate = true
            logger.logXeroSync('contact-search-exact-match', `Using active exact name match: ${foundContact.name}`, { contactID: foundContact.contactID }, 'debug')
          }
        }
      } catch (nameSearchError) {
        logger.logXeroSync('contact-name-search-failed', `Name search failed for "${expectedContactName}"`, { error: nameSearchError instanceof Error ? nameSearchError.message : String(nameSearchError) }, 'debug')
      }

      // Step 2: If no exact name match found, fall back to email search
      if (!xeroContactId) {
        try {
          const emailSearchResponse = await xeroApi.accountingApi.getContacts(
            tenantId,
            undefined,
            `EmailAddress="${userData.email}"`
          )

          if (emailSearchResponse.body.contacts && emailSearchResponse.body.contacts.length > 0) {
            foundContacts = emailSearchResponse.body.contacts
            searchMethod = 'email'

            if (foundContacts.length > 1) {
              // Multiple contacts found - log warning and attempt name matching
              logger.logXeroSync('contact-search-multiple-email-matches', `Multiple Xero contacts found for email ${userData.email}`, {
                email: userData.email,
                contactCount: foundContacts.length,
                contacts: foundContacts.map((contact: Contact) => ({
                  name: contact.name,
                  contactID: contact.contactID,
                  status: contact.contactStatus || Contact.ContactStatusEnum.ACTIVE
                }))
              }, 'warn')

              // Send Sentry warning for duplicate email monitoring
              Sentry.captureMessage(`Multiple Xero contacts found with same email during contact sync: ${userData.email}`, {
                level: 'warning',
                tags: {
                  component: 'xero-contact-sync',
                  operation: 'contact-search'
                },
                extra: {
                  email: userData.email,
                  contactCount: foundContacts.length,
                  contacts: foundContacts.map((contact: Contact) => ({
                    name: contact.name,
                    contactID: contact.contactID,
                    firstName: contact.firstName,
                    lastName: contact.lastName,
                    status: contact.contactStatus || Contact.ContactStatusEnum.ACTIVE
                  })),
                  userID: userData.id,
                  searchContext: 'email-fallback-search',
                  expectedContactName
                }
              })
              
              // Try to find exact name match first (should match our expected name)
              const exactNameMatch = foundContacts.find((contact: Contact) => 
                contact.name === expectedContactName
              )
              
              if (exactNameMatch && exactNameMatch.contactID) {
                xeroContactId = exactNameMatch.contactID
                logger.logXeroSync('contact-search-email-exact-name', `Found exact name match in email results: "${exactNameMatch.name}"`, { contactID: exactNameMatch.contactID }, 'debug')
              } else {
                // Try to find partial name match (first/last name without member ID)
                const partialNameMatch = foundContacts.find((contact: Contact) =>
                  contact.firstName === userData.first_name &&
                  contact.lastName === userData.last_name
                )

                if (partialNameMatch && partialNameMatch.contactID) {
                  xeroContactId = partialNameMatch.contactID
                  logger.logXeroSync('contact-search-email-partial-name', `Found partial name match: "${partialNameMatch.name}"`, { contactID: partialNameMatch.contactID }, 'debug')
                } else {
                  // Try to find any non-archived contact as last resort
                  const nonArchivedContact = foundContacts.find((contact: Contact) =>
                    contact.contactStatus !== Contact.ContactStatusEnum.ARCHIVED
                  )

                  if (nonArchivedContact && nonArchivedContact.contactID) {
                    xeroContactId = nonArchivedContact.contactID
                    logger.logXeroSync('contact-search-email-non-archived', `Found non-archived contact: "${nonArchivedContact.name}"`, { contactID: nonArchivedContact.contactID }, 'debug')
                  } else {
                    // Fall back to first contact but log the decision
                    xeroContactId = foundContacts[0].contactID
                    logger.logXeroSync('contact-search-email-no-match', `No suitable match found, using first contact: ${foundContacts[0].name || 'Unknown'}`, { contactID: foundContacts[0].contactID }, 'warn')
                  }
                }
              }
            } else {
              // Single contact found - use it
              xeroContactId = foundContacts[0].contactID
              logger.logXeroSync('contact-search-email-single-match', `Single contact found for ${userData.email}: "${foundContacts[0].name}"`, { contactID: foundContacts[0].contactID }, 'debug')
            }

            if (xeroContactId) {
              isUpdate = true
            }
          }
        } catch (emailSearchError) {
          logger.logXeroSync('contact-email-search-failed', 'Email search failed, will create new contact', { email: userData.email, error: emailSearchError instanceof Error ? emailSearchError.message : String(emailSearchError) }, 'debug')
        }
      }

      // Log the final search result
      if (xeroContactId) {
        logger.logXeroSync('contact-search-completed', 'Contact search completed', {
          searchMethod,
          foundContactId: xeroContactId,
          expectedName: expectedContactName,
          isUpdate
        }, 'debug')
      }
    }

    // Prepare contact data with member ID for uniqueness
    let contactName = `${userData.first_name} ${userData.last_name}`
    
    // Always append member ID if available for guaranteed uniqueness
    if (userData.member_id) {
                      contactName = generateContactName(userData.first_name, userData.last_name, userData.member_id)
    } else {
      // Fallback to old logic if member_id is not available (legacy users)
      if (!isUpdate && !xeroContactId) {
        try {
          const duplicateCheckResponse = await xeroApi.accountingApi.getContacts(
            tenantId,
            undefined,
            `Name="${contactName}"`
          )
          
          if (duplicateCheckResponse.body.contacts && duplicateCheckResponse.body.contacts.length > 0) {
            // There's already a contact with this name - make it unique by adding email
            const emailPart = userData.email.split('@')[0]
            contactName = `${userData.first_name} ${userData.last_name} (${emailPart})`
            logger.logXeroSync('contact-name-conflict', `Creating contact with unique name: ${contactName}`, {}, 'debug')
          }
        } catch {
          // If check fails, proceed with original name
          logger.logXeroSync('contact-duplicate-check-failed', 'Duplicate name check failed, proceeding with original name', {}, 'debug')
        }
      }
    }
    
    const contactData: Contact = {
      name: contactName,
      firstName: userData.first_name,
      lastName: userData.last_name,
      emailAddress: userData.email,
      contactStatus: Contact.ContactStatusEnum.ACTIVE, // Try to unarchive if archived
      contactPersons: userData.phone ? [{
        firstName: userData.first_name,
        lastName: userData.last_name,
        emailAddress: userData.email,
        phoneNumber: userData.phone
      } as ContactPerson] : undefined
    }

    let response
    if (isUpdate && xeroContactId) {
      // Update existing contact - also ensure it's not archived
      contactData.contactID = xeroContactId
      
      try {
        response = await xeroApi.accountingApi.updateContact(tenantId, xeroContactId, {
          contacts: [contactData]
        })
      } catch (updateError: unknown) {
        // Check if the error is due to archived contact
        const errorMessage = getXeroValidationMessage(updateError) || ''
        if (errorMessage.includes('archived') || errorMessage.includes('un-archived')) {
          logger.logXeroSync('contact-update-archived', `Contact ${xeroContactId} is archived, checking for other non-archived contacts with same email`, { contactID: xeroContactId, email: userData.email }, 'debug')

          // Before creating new contact, check if there's another non-archived contact with same email
          try {
            const emailSearchResponse = await xeroApi.accountingApi.getContacts(
              tenantId,
              undefined,
              `EmailAddress="${userData.email}"`
            )
            
            if (emailSearchResponse.body.contacts && emailSearchResponse.body.contacts.length > 0) {
              // Send Sentry warning if multiple contacts found during archived contact resolution
              if (emailSearchResponse.body.contacts.length > 1) {
                Sentry.captureMessage(`Multiple Xero contacts found during archived contact resolution: ${userData.email}`, {
                  level: 'warning',
                  tags: {
                    component: 'xero-contact-resolution',
                    operation: 'archived-contact-search'
                  },
                  extra: {
                    email: userData.email,
                    contactCount: emailSearchResponse.body.contacts.length,
                    contacts: emailSearchResponse.body.contacts.map((contact: Contact) => ({
                      name: contact.name,
                      contactID: contact.contactID,
                      status: contact.contactStatus || Contact.ContactStatusEnum.ACTIVE
                    })),
                    userID: userData.id,
                    archivedContactID: xeroContactId,
                    searchContext: 'archived-contact-resolution'
                  }
                })
              }
              
              // Look for any non-archived contact with same email
              const nonArchivedContact = emailSearchResponse.body.contacts.find((contact: Contact) => 
                contact.contactID !== xeroContactId && // Exclude the archived one we just tried
                contact.contactStatus !== Contact.ContactStatusEnum.ARCHIVED   // Find non-archived contacts
              )
              
              if (nonArchivedContact && nonArchivedContact.contactID) {
                logger.logXeroSync('contact-archived-resolution-match', `Found non-archived contact with same email: ${nonArchivedContact.name}`, { contactID: nonArchivedContact.contactID, email: userData.email }, 'debug')

                // Check if the contact name follows our naming convention
                const expectedNamePrefix = userData.member_id 
                                  ? generateContactName(userData.first_name, userData.last_name, userData.member_id)
                : generateContactName(userData.first_name, userData.last_name)
                
                let finalContactName = expectedNamePrefix
                
                if (!nonArchivedContact.name?.startsWith(expectedNamePrefix)) {
                  // Contact name doesn't follow our convention, update it but add timestamp for uniqueness
                  const timestamp = Date.now().toString().slice(-6)
                  finalContactName = userData.member_id 
                                    ? `${generateContactName(userData.first_name, userData.last_name, userData.member_id)} (${timestamp})`
                : `${generateContactName(userData.first_name, userData.last_name)} (${timestamp})`
                  
                  logger.logXeroSync('contact-name-convention-mismatch', `Contact name doesn't match our convention, updating to: ${finalContactName}`, { contactID: nonArchivedContact.contactID }, 'debug')
                }
                
                // Update the non-archived contact with correct naming convention
                contactData.contactID = nonArchivedContact.contactID
                contactData.name = finalContactName
                
                response = await xeroApi.accountingApi.updateContact(tenantId, nonArchivedContact.contactID, {
                  contacts: [contactData]
                })
                
                logger.logXeroSync('contact-archived-resolution-updated', `Successfully updated existing non-archived contact with name: ${finalContactName}`, { contactID: nonArchivedContact.contactID }, 'info')
                return { success: true, xeroContactId: nonArchivedContact.contactID }
              }
            }
          } catch {
            logger.logXeroSync('contact-archived-resolution-search-failed', 'Error searching for non-archived contacts with same email, proceeding to create new contact', { email: userData.email }, 'debug')
          }

          logger.logXeroSync('contact-archived-resolution-no-match', `No non-archived contacts found with email ${userData.email}, creating new contact`, { email: userData.email }, 'debug')
          
          // Create a new contact with unique name to avoid the archived contact
          if (userData.member_id) {
                            contactData.name = generateContactName(userData.first_name, userData.last_name, userData.member_id)
          } else {
            const emailPart = userData.email.split('@')[0]
            contactData.name = `${userData.first_name} ${userData.last_name} (${emailPart})`
          }
          
          // Check for name uniqueness and add timestamp if needed
          try {
            const nameCheckResponse = await xeroApi.accountingApi.getContacts(
              tenantId,
              undefined,
              `Name="${contactData.name}"`
            )
            
            if (nameCheckResponse.body.contacts && nameCheckResponse.body.contacts.length > 0) {
              const timestamp = Date.now().toString().slice(-6)
              if (userData.member_id) {
                contactData.name = `${generateContactName(userData.first_name, userData.last_name, userData.member_id)} (${timestamp})`
              } else {
                contactData.name = `${userData.first_name} ${userData.last_name} (${timestamp})`
              }
              logger.logXeroSync('contact-name-conflict-timestamped', `Name conflict detected, using timestamped name: ${contactData.name}`, {}, 'debug')
            }
          } catch {
            logger.logXeroSync('contact-name-uniqueness-check-failed', 'Name uniqueness check failed, proceeding with generated name', {}, 'debug')
          }
          
          // Remove contactID since we're creating new
          delete contactData.contactID
          
          response = await xeroApi.accountingApi.createContacts(tenantId, {
            contacts: [contactData]
          })
          
          // Reset update flag since we created new
          isUpdate = false
        } else {
          // Re-throw other errors
          throw updateError
        }
      }
    } else {
      // Create new contact
      response = await xeroApi.accountingApi.createContacts(tenantId, {
        contacts: [contactData]
      })
    }

    if (!response.body.contacts || response.body.contacts.length === 0) {
      await logXeroSync({
        tenant_id: tenantId,
        operation: 'contact_sync',
        record_type: 'user',
        record_id: userId,
        xero_id: undefined,
        success: false,
        error_message: 'No contact returned from Xero API'
      })
      return { success: false, error: 'No contact returned from Xero API' }
    }

    const xeroContact = response.body.contacts[0]
    xeroContactId = xeroContact.contactID

    if (!xeroContactId) {
      await logXeroSync({
        tenant_id: tenantId,
        operation: 'contact_sync',
        record_type: 'user',
        record_id: userId,
        xero_id: undefined,
        success: false,
        error_message: 'No contact ID returned from Xero API'
      })
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
    
    await logXeroSync({
      tenant_id: tenantId,
      operation: 'contact_sync',
      record_type: 'user',
      record_id: userId,
      xero_id: xeroContactId,
      success: true,
      details: logMessage
    })

    return { success: true, xeroContactId }

  } catch (error) {
    // Extract meaningful error message from Xero API response
    let errorMessage = 'Unknown error during contact sync'
    let errorCode = 'sync_failed'

    if (error instanceof Error) {
      errorMessage = error.message
    } else if (error && typeof error === 'object') {
      // Handle Xero API error structure
      const validationMessage = getXeroValidationMessage(error)
      const xeroError = error as XeroApiError

      if (xeroError.response?.body?.Elements?.[0]?.ValidationErrors?.[0]?.Message) {
        errorMessage = `Xero validation error: ${validationMessage}`
        errorCode = validationMessage!
      } else if (xeroError.response?.body?.Message) {
        errorMessage = `Xero API error: ${xeroError.response.body.Message}`
        errorCode = 'xero_api_error'
      } else if (xeroError.message) {
        errorMessage = xeroError.message
        errorCode = 'contact_sync_error'
      } else {
        errorMessage = `Contact sync error: ${JSON.stringify(xeroError).substring(0, 200)}...`
        errorCode = 'contact_sync_unknown'
      }
    }

    // Use warn (not error) here: Sentry is already reported explicitly below at
    // 'warning' severity, since contact sync failures are less critical than invoice
    // failures - logger.error would auto-report a second, conflicting-severity event.
    logger.logXeroSync('contact-sync-error', 'Error syncing contact to Xero', { userId, tenantId, errorCode, error: errorMessage }, 'warn')

    // Capture contact sync error in Sentry (less critical than invoice errors, but still important)
    Sentry.withScope((scope) => {
      scope.setTag('integration', 'xero')
      scope.setTag('operation', 'contact_sync')
      scope.setTag('error_code', errorCode)
      scope.setLevel('warning') // Contact sync failures are warnings, not critical errors
      scope.setContext('xero_contact_error', {
        user_id: userId,
        tenant_id: tenantId,
        user_email: userData.email,
        user_name: `${userData.first_name} ${userData.last_name}`,
        member_id: userData.member_id,
        error_code: errorCode,
        error_message: errorMessage
      })
      
      if (error instanceof Error) {
        Sentry.captureException(error)
      } else {
        Sentry.captureMessage(`Xero contact sync failure: ${errorMessage}`, 'warning')
      }
    })

    // Update sync status to failed
    const supabase = createAdminClient()
    await supabase
      .from('xero_contacts')
      .upsert({
        user_id: userId,
        tenant_id: tenantId,
        sync_status: 'failed',
        sync_error: errorMessage,
        updated_at: new Date().toISOString()
      })

    await logXeroSync({
      tenant_id: tenantId,
      operation: 'contact_sync',
      record_type: 'user',
      record_id: userId,
      xero_id: undefined,
      success: false,
      error_message: errorMessage
    })

    return { success: false, error: errorMessage }
  }
}

// Get or create Xero contact for a user
export async function getOrCreateXeroContact(
  userId: string,
  tenantId: string
): Promise<{ success: boolean; xeroContactId?: string; error?: string; apiCallMade?: boolean }> {
  try {
    const supabase = createAdminClient()

    // Get user data
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('id, email, first_name, last_name, phone, member_id')
      .eq('id', userId)
      .single()

    if (userError || !userData) {
      return { success: false, error: 'User not found' }
    }

    // OPTIMIZATION: Check if contact already exists locally with valid Xero ID
    const { data: existingContact } = await supabase
      .from('xero_contacts')
      .select('*')
      .eq('user_id', userId)
      .eq('tenant_id', tenantId)
      .single()

    if (existingContact && existingContact.sync_status === 'synced' && existingContact.xero_contact_id) {
      // SKIP EXPENSIVE VALIDATION: Assume contact is valid since it was synced during onboarding
      // Only validate if explicitly requested or if we suspect issues
      return { success: true, xeroContactId: existingContact.xero_contact_id, apiCallMade: false }
    }

    // Only sync if no local contact exists (shouldn't happen since contacts are synced during onboarding)
    logger.logXeroSync('contact-not-locally-synced', `No local contact found for user ${userId}, syncing to Xero (this should be rare)`, { userId, tenantId }, 'warn')
    const result = await syncUserToXeroContact(userId, tenantId, userData)
    return { ...result, apiCallMade: true }

  } catch (error) {
    logger.logXeroSync('get-or-create-contact-error', 'Error getting or creating Xero contact', { userId, tenantId, error: error instanceof Error ? error.message : String(error) }, 'error')
    return { success: false, error: 'Failed to get or create contact' }
  }
}

// Force sync contact when user name changes (called from profile update)
export async function syncContactOnNameChange(
  userId: string,
  tenantId: string,
  oldFirstName: string,
  oldLastName: string,
  newFirstName: string,
  newLastName: string
): Promise<{ success: boolean; xeroContactId?: string; error?: string }> {
  try {
    // Check if name actually changed
    if (oldFirstName === newFirstName && oldLastName === newLastName) {
      return { success: true }
    }

    const supabase = createAdminClient()

    // Get full user data
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('id, email, first_name, last_name, phone, member_id')
      .eq('id', userId)
      .single()

    if (userError || !userData) {
      return { success: false, error: 'User not found' }
    }

    logger.logXeroSync('contact-sync-name-change', `Forcing Xero contact sync due to name change: "${oldFirstName} ${oldLastName}" -> "${newFirstName} ${newLastName}"`, { userId, tenantId }, 'info')

    // Force sync to update the contact name in Xero
    return await syncUserToXeroContact(userId, tenantId, userData)

  } catch (error) {
    logger.logXeroSync('contact-sync-name-change-error', 'Error syncing contact on name change', { userId, tenantId, error: error instanceof Error ? error.message : String(error) }, 'error')
    return { success: false, error: 'Failed to sync contact on name change' }
  }
}

/**
 * Sync email change to Xero contact
 * Non-blocking: logs errors but doesn't throw
 */
export async function syncEmailChangeToXero(
  userId: string,
  oldEmail: string,
  newEmail: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const supabase = createAdminClient()

    // Get full user data
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('id, email, first_name, last_name, phone, member_id')
      .eq('id', userId)
      .single()

    if (userError || !userData) {
      return { success: false, error: 'User not found' }
    }

    // Get active Xero tenant
    const { getActiveTenant } = await import('./client')
    const activeTenant = await getActiveTenant()

    if (!activeTenant) {
      return { success: false, error: 'No active Xero tenant' }
    }

    logger.logXeroSync('contact-sync-email-change', `Forcing Xero contact sync due to email change: "${oldEmail}" -> "${newEmail}"`, { userId, tenantId: activeTenant.tenant_id }, 'info')

    // Force sync to update the contact email in Xero
    const syncResult = await syncUserToXeroContact(userId, activeTenant.tenant_id, userData)

    if (syncResult.success) {
      return { success: true }
    } else {
      logger.logXeroSync('contact-sync-email-change-failed', `Xero contact email update failed: ${syncResult.error}`, { userId }, 'warn')
      return { success: false, error: syncResult.error }
    }

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'

    // Use warn (not error): Sentry is already reported explicitly below.
    logger.logXeroSync('contact-sync-email-change-error', 'Error syncing email change to Xero', { userId, error: errorMessage }, 'warn')

    // Log error to Sentry but don't throw
    if (typeof window === 'undefined') {
      Sentry.captureException(error, {
        tags: { context: 'xero_email_sync' },
        extra: { userId, oldEmail, newEmail }
      })
    }

    return { success: false, error: errorMessage }
  }
}

type ContactSummary = Pick<Contact, 'contactID' | 'name' | 'firstName' | 'lastName' | 'emailAddress' | 'contactNumber'>

// Debug function to find duplicate contacts by email
export async function findDuplicateContactsByEmail(
  tenantId: string,
  email: string
): Promise<{ success: boolean; contacts?: ContactSummary[]; error?: string }> {
  try {
    const xeroApi = await getAuthenticatedXeroClient(tenantId)
    if (!xeroApi) {
      return { success: false, error: 'Unable to authenticate with Xero' }
    }

    const searchResponse = await xeroApi.accountingApi.getContacts(
      tenantId,
      undefined,
      `EmailAddress="${email}"`
    )

    if (searchResponse.body.contacts) {
      return { 
        success: true, 
        contacts: searchResponse.body.contacts.map((contact: Contact) => ({
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
    const supabase = createAdminClient()

    // Get users who have made payments but aren't synced to Xero
    const { data: usersNeedingSync, error: usersError } = await supabase
      .from('users')
      .select(`
        id, email, first_name, last_name, phone, member_id,
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
    logger.logXeroSync('bulk-contact-sync-error', 'Error in bulk contact sync', { tenantId, error: error instanceof Error ? error.message : String(error) }, 'error')
    return {
      success: false,
      synced: 0,
      failed: 0,
      errors: [error instanceof Error ? error.message : 'Unknown error']
    }
  }
}