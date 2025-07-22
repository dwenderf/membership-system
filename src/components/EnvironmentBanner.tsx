'use client'

export default function EnvironmentBanner() {
  // Check if we're in production
  const isProduction = process.env.NODE_ENV === 'production' && 
                      process.env.VERCEL_ENV === 'production'
  
  // Don't show banner in production
  if (isProduction) {
    return null
  }

  // Determine environment type
  const getEnvironmentInfo = () => {
    if (process.env.NODE_ENV === 'development') {
      return {
        label: 'DEVELOPMENT',
        description: 'Local development environment',
        bgColor: 'bg-purple-600',
        textColor: 'text-white'
      }
    } else if (process.env.VERCEL_ENV === 'preview') {
      return {
        label: 'PREVIEW',
        description: 'Vercel preview deployment',
        bgColor: 'bg-yellow-500',
        textColor: 'text-black'
      }
    } else {
      return {
        label: 'TEST',
        description: 'Non-production environment',
        bgColor: 'bg-orange-500',
        textColor: 'text-white'
      }
    }
  }

  const env = getEnvironmentInfo()

  return (
    <div className={`${env.bgColor} ${env.textColor} px-4 py-2 text-center relative z-50`}>
      <div className="max-w-7xl mx-auto flex items-center justify-center space-x-3">
        <div className="flex items-center space-x-2">
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
          </svg>
          <span className="font-bold text-sm">
            {env.label} ENVIRONMENT
          </span>
        </div>
        <span className="text-xs hidden sm:inline">
          {env.description} - No real transactions will be processed
        </span>
      </div>
    </div>
  )
}