import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    
    // Check if user is admin
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('is_admin')
      .eq('id', user.id)
      .single()

    if (userError || !userData || !userData.is_admin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
    }

    // Get the required accounting codes
    const requiredCodes = ['donation_received_default', 'donation_given_default']
    const { data: codes, error } = await supabase
      .from('system_accounting_codes')
      .select('code_type, accounting_code')
      .in('code_type', requiredCodes)
    
    if (error) {
      console.error('Error fetching system accounting codes:', error)
      return NextResponse.json({ error: 'Failed to fetch accounting codes' }, { status: 500 })
    }
    
    const missingCodes: string[] = []
    
    for (const requiredCode of requiredCodes) {
      const code = codes?.find(c => c.code_type === requiredCode)
      if (!code || !code.accounting_code || code.accounting_code.trim() === '') {
        missingCodes.push(requiredCode)
      }
    }
    
    const isValid = missingCodes.length === 0
    
    // Create user-friendly error message
    let message = ''
    if (!isValid) {
      const codeNames = missingCodes.map(code => {
        switch (code) {
          case 'donation_received_default':
            return 'Donation Received'
          case 'donation_given_default':
            return 'Donation Given (Financial Assistance)'
          default:
            return code
        }
      })
      
      const codesText = codeNames.length === 1 
        ? `${codeNames[0]} accounting code` 
        : `${codeNames.join(', ')} accounting codes`
      
      message = `Required ${codesText} must be configured before creating registrations or memberships. Please set up these accounting codes first.`
    }
    
    return NextResponse.json({
      isValid,
      missingCodes,
      message,
      redirectUrl: isValid ? undefined : '/admin/accounting-codes'
    })
    
  } catch (error) {
    console.error('Error validating accounting codes:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}