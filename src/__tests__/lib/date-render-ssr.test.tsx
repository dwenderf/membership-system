/**
 * #410: client components that show DATE columns render the same text on the
 * server (UTC on Vercel) and in a browser in any zone, so SSR and hydration
 * agree. No jsdom in this repo, so render to static markup under several TZs.
 */
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { formatDateString } from '@/lib/date-utils'

function SeasonRange({ start, end }: { start: string; end: string }) {
  // Same expression RegistrationHistory / RegistrationPurchase / admin seasons use.
  return <p>{formatDateString(start)} - {formatDateString(end)}</p>
}

const ORIGINAL_TZ = process.env.TZ
afterAll(() => {
  if (ORIGINAL_TZ === undefined) delete process.env.TZ
  else process.env.TZ = ORIGINAL_TZ
})

it.each(['UTC', 'America/New_York', 'Pacific/Kiritimati', 'America/Los_Angeles'])(
  'renders identical markup under TZ=%s',
  (zone) => {
    process.env.TZ = zone
    expect(renderToStaticMarkup(<SeasonRange start="2026-09-01" end="2027-03-31" />)).toBe(
      '<p>9/1/2026 - 3/31/2027</p>'
    )
  }
)
