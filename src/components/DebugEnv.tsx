'use client'

export default function DebugEnv() {
  return (
    <div className="bg-gray-100 p-4 m-4 rounded border">
      <h3 className="font-bold mb-2">Environment Debug Info:</h3>
      <ul className="space-y-1 text-sm">
        <li>NODE_ENV: {process.env.NODE_ENV || 'undefined'}</li>
        <li>VERCEL_ENV: {process.env.VERCEL_ENV || 'undefined'}</li>
        <li>VERCEL: {process.env.VERCEL || 'undefined'}</li>
        <li>VERCEL_URL: {process.env.VERCEL_URL || 'undefined'}</li>
      </ul>
    </div>
  )
}