import { NextRequest, NextResponse } from 'next/server'

export async function GET() {
  return NextResponse.json({ message: 'API route is working', timestamp: new Date().toISOString() })
}