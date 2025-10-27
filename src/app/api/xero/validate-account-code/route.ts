import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { getActiveTenant } from '@/lib/xero/client'

/**
 * Validate Accounting Code
 * GET /api/xero/validate-account-code?code={code}
 *
 * Validates an accounting code against cached Xero chart of accounts
 * Returns account details if valid
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const code = searchParams.get('code')

    if (!code) {
      return NextResponse.json(
        { valid: false, error: 'Code parameter is required' },
        { status: 400 }
      )
    }

    // Get active tenant
    const activeTenant = await getActiveTenant()
    if (!activeTenant) {
      return NextResponse.json(
        { valid: false, error: 'No active Xero connection' },
        { status: 200 } // Return 200 with valid: false for better UX
      )
    }

    const supabase = createAdminClient()

    // Query for the account code (case-insensitive)
    const { data: account, error } = await supabase
      .from('xero_accounts')
      .select('code, name, type, status, description')
      .eq('tenant_id', activeTenant.tenant_id)
      .ilike('code', code) // Case-insensitive match
      .eq('status', 'ACTIVE') // Only validate ACTIVE accounts
      .single()

    if (error || !account) {
      return NextResponse.json({
        valid: false,
        error: 'Invalid accounting code. Please select from the list.'
      })
    }

    return NextResponse.json({
      valid: true,
      account: {
        code: account.code,
        name: account.name,
        type: account.type,
        status: account.status,
        description: account.description
      }
    })

  } catch (error) {
    console.error('Error validating account code:', error)

    return NextResponse.json(
      {
        valid: false,
        error: 'Error validating account code'
      },
      { status: 500 }
    )
  }
}
