import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createHash, randomBytes } from 'crypto'

/**
 * Hash a code using SHA-256
 */
function hashCode(code: string): string {
  return createHash('sha256').update(code).digest('hex')
}

/**
 * Generate a secure random token for the cookie
 */
function generateSecureToken(): string {
  return randomBytes(32).toString('hex')
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()

    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const body = await request.json()
    const { code } = body

    if (!code || code.length !== 6) {
      return NextResponse.json(
        { error: 'Invalid code format' },
        { status: 400 }
      )
    }

    // Hash the provided code
    const codeHash = hashCode(code)

    // Get the most recent unused code for this user
    const { data: stored, error: fetchError } = await supabase
      .from('reauth_verification_codes')
      .select('*')
      .eq('user_id', user.id)
      .is('used_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (fetchError) {
      console.error('Error fetching verification code:', fetchError)
      return NextResponse.json(
        { error: 'Failed to verify code' },
        { status: 500 }
      )
    }

    if (!stored) {
      return NextResponse.json(
        { error: 'No verification code found. Please request a new code.' },
        { status: 400 }
      )
    }

    // Check if expired
    if (new Date(stored.expires_at) < new Date()) {
      // Delete expired code
      await supabase
        .from('reauth_verification_codes')
        .delete()
        .eq('id', stored.id)

      return NextResponse.json(
        { error: 'Verification code has expired. Please request a new code.' },
        { status: 400 }
      )
    }

    // Check if locked due to too many failed attempts
    if (stored.failed_attempts >= 5) {
      return NextResponse.json(
        { error: 'Too many failed attempts. Please request a new code.' },
        { status: 429 }
      )
    }

    // Verify code hash
    if (stored.code_hash !== codeHash) {
      // Increment failed attempts
      await supabase
        .from('reauth_verification_codes')
        .update({ failed_attempts: stored.failed_attempts + 1 })
        .eq('id', stored.id)

      const attemptsLeft = 5 - stored.failed_attempts - 1
      return NextResponse.json(
        {
          error: `Invalid verification code. ${attemptsLeft} ${attemptsLeft === 1 ? 'attempt' : 'attempts'} remaining.`
        },
        { status: 400 }
      )
    }

    // Code is valid - mark as used
    await supabase
      .from('reauth_verification_codes')
      .update({ used_at: new Date().toISOString() })
      .eq('id', stored.id)

    // Generate a secure token for the cookie (includes user ID for validation)
    const secureToken = generateSecureToken()
    const cookieValue = `${user.id}:${secureToken}`

    // Set a cookie that's valid for 5 minutes to indicate user is re-authenticated
    const cookieStore = await cookies()
    cookieStore.set('reauth_verified', cookieValue, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 5 * 60, // 5 minutes
      path: '/'
    })

    return NextResponse.json({
      success: true,
      message: 'Identity verified'
    })

  } catch (error) {
    console.error('Error verifying reauth code:', error)
    return NextResponse.json(
      { error: 'Failed to verify code' },
      { status: 500 }
    )
  }
}
