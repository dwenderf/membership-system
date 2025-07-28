import { NextRequest, NextResponse } from 'next/server'
import { extractRequestInfo, getSimpleRequestInfo } from '@/lib/request-info'

export async function GET(request: NextRequest) {
  try {
    // Extract comprehensive request information
    const fullInfo = extractRequestInfo(request)
    const simpleInfo = getSimpleRequestInfo(request)
    
    return NextResponse.json({
      success: true,
      message: 'Request information extracted successfully',
      timestamp: new Date().toISOString(),
      
      // Simple info for quick reference
      simple: simpleInfo,
      
      // Detailed info for debugging
      detailed: {
        ip: fullInfo.ip,
        userAgent: fullInfo.userAgent,
        browser: fullInfo.browser,
        os: fullInfo.os,
        device: fullInfo.device,
        url: fullInfo.url,
        method: fullInfo.method,
        referer: fullInfo.referer,
        language: fullInfo.language,
        timezone: fullInfo.timezone,
        // Only include safe headers (exclude sensitive ones)
        safeHeaders: {
          'accept': fullInfo.headers['accept'],
          'accept-language': fullInfo.headers['accept-language'],
          'accept-encoding': fullInfo.headers['accept-encoding'],
          'user-agent': fullInfo.headers['user-agent'],
          'referer': fullInfo.headers['referer'],
          'x-forwarded-for': fullInfo.headers['x-forwarded-for'],
          'x-real-ip': fullInfo.headers['x-real-ip'],
          'x-client-ip': fullInfo.headers['x-client-ip']
        }
      }
    })
    
  } catch (error) {
    console.error('Error extracting request info:', error)
    return NextResponse.json({ 
      error: 'Failed to extract request information',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 })
  }
} 