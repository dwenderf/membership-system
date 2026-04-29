import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { headers } from 'next/headers'

async function completeSignIn(formData: FormData) {
  'use server'
  const tokenHash = formData.get('token_hash') as string
  const type = (formData.get('type') as string) || 'magiclink'

  if (!tokenHash) {
    redirect('/auth/auth-code-error')
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.verifyOtp({
    token_hash: tokenHash,
    type: type as 'magiclink' | 'email',
  })

  if (error) {
    redirect('/auth/auth-code-error')
  }

  const headersList = await headers()
  const forwardedHost = headersList.get('x-forwarded-host')
  const host = headersList.get('host') ?? ''
  const isLocalEnv = process.env.NODE_ENV === 'development'

  let baseUrl = ''
  if (isLocalEnv) {
    baseUrl = `http://${host}`
  } else if (forwardedHost) {
    baseUrl = `https://${forwardedHost}`
  } else {
    baseUrl = `https://${host}`
  }

  redirect(`${baseUrl}/dashboard`)
}

export default async function MagicConfirmPage({
  searchParams,
}: {
  searchParams: Promise<{ token_hash?: string; type?: string }>
}) {
  const { token_hash, type } = await searchParams

  if (!token_hash) {
    redirect('/auth/auth-code-error')
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <div>
          <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
            Welcome to your My NYCPHA Account!
          </h2>
          <p className="mt-2 text-center text-sm text-gray-600">
            Your identity has been verified. Click below to continue.
          </p>
        </div>

        <div className="bg-white shadow rounded-lg p-6">
          <form action={completeSignIn}>
            <input type="hidden" name="token_hash" value={token_hash} />
            <input type="hidden" name="type" value={type ?? 'magiclink'} />
            <button
              type="submit"
              className="w-full flex justify-center py-3 px-4 border border-transparent rounded-md shadow-sm text-base font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
            >
              Open Dashboard
            </button>
          </form>

          <p className="mt-4 text-center text-xs text-gray-500">
            If you did not request this login, you can safely ignore this page.
          </p>
        </div>

        <div className="text-center">
          <img
            src="https://my.nycpha.org/images/NYCPHA_Wordmark_Horizontal_Black_Tide.png"
            alt="NYCPHA Logo"
            className="mx-auto max-w-full h-auto"
          />
        </div>
      </div>
    </div>
  )
}
