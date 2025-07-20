/**
 * Get the base URL for internal API calls
 * Works in both development and production environments
 */
export function getBaseUrl(): string {
  // In production (Vercel), use the VERCEL_URL
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`
  }
  
  // In development or custom deployments, use NEXT_PUBLIC_SITE_URL
  if (process.env.NEXT_PUBLIC_SITE_URL) {
    return process.env.NEXT_PUBLIC_SITE_URL
  }
  
  // Fallback to localhost for development
  return 'http://localhost:3000'
}