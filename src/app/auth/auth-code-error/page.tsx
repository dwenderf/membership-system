import Link from 'next/link'

export default function AuthCodeErrorPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <div>
          <div className="mx-auto h-12 w-12 flex items-center justify-center rounded-full bg-red-100">
            <svg className="h-6 w-6 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
          </div>
          <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
            Authentication Error
          </h2>
          <p className="mt-2 text-center text-sm text-gray-600">
            There was a problem with your magic link
          </p>
        </div>
        
        <div className="bg-white shadow rounded-lg p-6">
          <div className="space-y-4">
            <div className="text-sm text-gray-700">
              <h3 className="font-medium text-gray-900 mb-2">What happened?</h3>
              <p className="mb-3">
                Your magic link couldn't be verified. This usually happens when:
              </p>
              <ul className="list-disc pl-5 space-y-1">
                <li>The link was opened in a different browser than where you requested it</li>
                <li>Too much time has passed since the link was sent</li>
                <li>The link has already been used</li>
              </ul>
            </div>
            
            <div className="border-t pt-4">
              <h3 className="font-medium text-gray-900 mb-2">How to fix this:</h3>
              <ol className="list-decimal pl-5 space-y-1 text-sm text-gray-700">
                <li>Go back to the login page</li>
                <li>Enter your email address again</li>
                <li>Check your email for a new magic link</li>
                <li>Open the link in the same browser where you requested it</li>
              </ol>
            </div>
          </div>
          
          <div className="mt-6 flex flex-col space-y-3">
            <Link
              href="/auth/login"
              className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500"
            >
              Try Again
            </Link>
            <Link
              href="/"
              className="w-full flex justify-center py-2 px-4 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500"
            >
              Go Home
            </Link>
          </div>
        </div>
        
        <div className="text-center">
          <p className="text-xs text-gray-500">
            Still having trouble? Contact support for assistance.
          </p>
        </div>
      </div>
    </div>
  )
}