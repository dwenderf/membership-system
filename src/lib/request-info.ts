import { NextRequest } from 'next/server'

export interface RequestInfo {
  ip: string
  userAgent: string
  browser: {
    name: string
    version: string
    engine: string
  }
  os: {
    name: string
    version: string
  }
  device: {
    type: 'desktop' | 'mobile' | 'tablet' | 'unknown'
    isMobile: boolean
    isTablet: boolean
    isDesktop: boolean
  }
  headers: Record<string, string>
  url: string
  method: string
  referer?: string
  language?: string
  timezone?: string
}

/**
 * Extract comprehensive request information including IP, browser, OS, and device details
 */
export function extractRequestInfo(request: NextRequest): RequestInfo {
  // Get IP address (handles various proxy scenarios)
  const ip = getClientIP(request)
  
  // Get user agent
  const userAgent = request.headers.get('user-agent') || 'Unknown'
  
  // Parse browser and OS information
  const browserInfo = parseUserAgent(userAgent)
  
  // Get additional headers
  const headers: Record<string, string> = {}
  request.headers.forEach((value, key) => {
    headers[key] = value
  })
  
  return {
    ip,
    userAgent,
    browser: browserInfo.browser,
    os: browserInfo.os,
    device: browserInfo.device,
    headers,
    url: request.url,
    method: request.method,
    referer: request.headers.get('referer') || undefined,
    language: request.headers.get('accept-language') || undefined,
    timezone: request.headers.get('x-timezone') || undefined
  }
}

/**
 * Get client IP address, handling various proxy scenarios
 */
function getClientIP(request: NextRequest): string {
  // Check for various IP headers (in order of preference)
  const ipHeaders = [
    'x-forwarded-for',
    'x-real-ip',
    'x-client-ip',
    'x-forwarded',
    'x-cluster-client-ip',
    'forwarded-for',
    'forwarded'
  ]
  
  for (const header of ipHeaders) {
    const value = request.headers.get(header)
    if (value) {
      // Handle comma-separated IPs (take the first one)
      const firstIP = value.split(',')[0].trim()
      if (isValidIP(firstIP)) {
        return firstIP
      }
    }
  }
  
  // Fallback to connection remote address (if available)
  const connection = (request as any).connection || (request as any).socket
  if (connection?.remoteAddress) {
    return connection.remoteAddress
  }
  
  return 'unknown'
}

/**
 * Validate IP address format
 */
function isValidIP(ip: string): boolean {
  // Basic IP validation
  const ipv4Regex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/
  const ipv6Regex = /^(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$/
  
  return ipv4Regex.test(ip) || ipv6Regex.test(ip)
}

/**
 * Parse user agent string to extract browser, OS, and device information
 */
function parseUserAgent(userAgent: string): {
  browser: { name: string; version: string; engine: string }
  os: { name: string; version: string }
  device: { type: 'desktop' | 'mobile' | 'tablet' | 'unknown'; isMobile: boolean; isTablet: boolean; isDesktop: boolean }
} {
  const ua = userAgent.toLowerCase()
  
  // Browser detection
  let browserName = 'Unknown'
  let browserVersion = 'Unknown'
  let browserEngine = 'Unknown'
  
  if (ua.includes('chrome')) {
    browserName = 'Chrome'
    browserVersion = extractVersion(ua, 'chrome')
    browserEngine = 'Blink'
  } else if (ua.includes('firefox')) {
    browserName = 'Firefox'
    browserVersion = extractVersion(ua, 'firefox')
    browserEngine = 'Gecko'
  } else if (ua.includes('safari') && !ua.includes('chrome')) {
    browserName = 'Safari'
    browserVersion = extractVersion(ua, 'version')
    browserEngine = 'WebKit'
  } else if (ua.includes('edge')) {
    browserName = 'Edge'
    browserVersion = extractVersion(ua, 'edge')
    browserEngine = 'Blink'
  } else if (ua.includes('opera')) {
    browserName = 'Opera'
    browserVersion = extractVersion(ua, 'opera')
    browserEngine = 'Blink'
  }
  
  // OS detection
  let osName = 'Unknown'
  let osVersion = 'Unknown'
  
  if (ua.includes('windows')) {
    osName = 'Windows'
    if (ua.includes('windows nt 10.0')) osVersion = '10'
    else if (ua.includes('windows nt 6.3')) osVersion = '8.1'
    else if (ua.includes('windows nt 6.2')) osVersion = '8'
    else if (ua.includes('windows nt 6.1')) osVersion = '7'
    else if (ua.includes('windows nt 6.0')) osVersion = 'Vista'
    else if (ua.includes('windows nt 5.2')) osVersion = 'XP x64'
    else if (ua.includes('windows nt 5.1')) osVersion = 'XP'
  } else if (ua.includes('mac os x')) {
    osName = 'macOS'
    osVersion = extractVersion(ua, 'mac os x')
  } else if (ua.includes('linux')) {
    osName = 'Linux'
    if (ua.includes('ubuntu')) osVersion = 'Ubuntu'
    else if (ua.includes('fedora')) osVersion = 'Fedora'
    else if (ua.includes('centos')) osVersion = 'CentOS'
    else if (ua.includes('debian')) osVersion = 'Debian'
  } else if (ua.includes('android')) {
    osName = 'Android'
    osVersion = extractVersion(ua, 'android')
  } else if (ua.includes('ios')) {
    osName = 'iOS'
    osVersion = extractVersion(ua, 'os ')
  }
  
  // Device detection
  let deviceType: 'desktop' | 'mobile' | 'tablet' | 'unknown' = 'unknown'
  let isMobile = false
  let isTablet = false
  let isDesktop = false
  
  if (ua.includes('mobile') || ua.includes('android') || ua.includes('iphone')) {
    deviceType = 'mobile'
    isMobile = true
  } else if (ua.includes('tablet') || ua.includes('ipad')) {
    deviceType = 'tablet'
    isTablet = true
  } else {
    deviceType = 'desktop'
    isDesktop = true
  }
  
  return {
    browser: { name: browserName, version: browserVersion, engine: browserEngine },
    os: { name: osName, version: osVersion },
    device: { type: deviceType, isMobile, isTablet, isDesktop }
  }
}

/**
 * Extract version number from user agent string
 */
function extractVersion(userAgent: string, browser: string): string {
  const regex = new RegExp(`${browser}[\\/\\s]([\\d.]+)`, 'i')
  const match = userAgent.match(regex)
  return match ? match[1] : 'Unknown'
}

/**
 * Get a simplified request info object for logging
 */
export function getSimpleRequestInfo(request: NextRequest) {
  const info = extractRequestInfo(request)
  return {
    ip: info.ip,
    userAgent: info.userAgent,
    browser: `${info.browser.name} ${info.browser.version}`,
    os: `${info.os.name} ${info.os.version}`,
    device: info.device.type,
    url: info.url,
    method: info.method
  }
} 