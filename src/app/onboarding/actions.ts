'use server'

import { createClient } from '@/lib/supabase/server'
import { getOrCreateXeroContact } from '@/lib/xero/contacts'
import { getActiveTenant } from '@/lib/xero/client'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'

export async function completeOnboarding(formData: FormData) {
  try {
    const supabase = await createClient()
    
    // Get authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      throw new Error('User not authenticated')
    }

    // Extract form data
    const firstName = formData.get('firstName') as string
    const lastName = formData.get('lastName') as string
    const isGoalie = formData.get('isGoalie') === 'true'
    const isLgbtq = formData.get('isLgbtq') === 'true' ? true : 
                   formData.get('isLgbtq') === 'false' ? false : null
    const wantsMembership = formData.get('wantsMembership') === 'true'

    // Validate required fields
    if (!firstName?.trim() || !lastName?.trim()) {
      throw new Error('First name and last name are required')
    }

    // Check if user record exists
    const { data: existingUser } = await supabase
      .from('users')
      .select('id')
      .eq('id', user.id)
      .single()

    // Prepare user data
    const userData = {
      id: user.id,
      email: user.email!,
      first_name: firstName.trim(),
      last_name: lastName.trim(),
      is_goalie: isGoalie,
      is_lgbtq: isLgbtq,
      is_admin: false,
      onboarding_completed_at: new Date().toISOString(),
      terms_accepted_at: new Date().toISOString(),
      terms_version: 'v1.0',
    }

    if (existingUser) {
      // Update existing user
      const { error } = await supabase
        .from('users')
        .update({
          first_name: userData.first_name,
          last_name: userData.last_name,
          is_goalie: userData.is_goalie,
          is_lgbtq: userData.is_lgbtq,
          onboarding_completed_at: userData.onboarding_completed_at,
          terms_accepted_at: userData.terms_accepted_at,
          terms_version: userData.terms_version,
        })
        .eq('id', user.id)

      if (error) throw error
    } else {
      // Create new user
      const { error } = await supabase
        .from('users')
        .insert([userData])

      if (error) throw error
    }

    // Sync user to Xero
    try {
      console.log('🔄 Starting Xero sync for user:', user.email)
      
      const activeTenant = await getActiveTenant()
      if (activeTenant) {
        console.log(`🔗 Found active Xero tenant: ${activeTenant.tenant_id}`)
        
        const xeroResult = await getOrCreateXeroContact(user.id, activeTenant.tenant_id)
        
        if (xeroResult.success && xeroResult.xeroContactId) {
          console.log(`✅ User synced to Xero successfully: ${xeroResult.xeroContactId}`)
        } else {
          console.warn(`⚠️ Failed to sync user to Xero: ${xeroResult.error}`)
        }
      } else {
        console.log('ℹ️ No active Xero connection found, skipping user sync')
      }
    } catch (xeroError) {
      console.error('❌ Error during Xero sync:', xeroError)
      // Don't fail onboarding if Xero sync fails
    }

    // Redirect based on membership preference
    if (wantsMembership) {
      redirect('/user/browse-memberships?onboarding=true')
    } else {
      redirect('/dashboard')
    }

  } catch (error) {
    console.error('Error completing onboarding:', error)
    throw error
  }
} 