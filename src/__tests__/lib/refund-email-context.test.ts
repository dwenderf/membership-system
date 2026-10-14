import { getRegistrationDateLabel } from '@/lib/registration-date-label'

type R = { data: unknown; error: unknown }
const results: Record<string, R> = {}
const mockFrom = jest.fn((table: string) => {
  const chain: Record<string, jest.Mock> = {}
  for (const m of ['select', 'eq', 'limit']) chain[m] = jest.fn(() => chain)
  chain.maybeSingle = jest.fn(() => Promise.resolve(results[table] ?? { data: null, error: null }))
  return chain
})
jest.mock('@/lib/supabase/server', () => ({ createAdminClient: () => ({ from: mockFrom }) }))

import { resolveRefundEmailContext } from '@/lib/email/refund-context'
import { createAdminClient } from '@/lib/supabase/server'

describe('getRegistrationDateLabel', () => {
  it('uses the season name for team registrations', () => {
    expect(getRegistrationDateLabel({ type: 'team', startDate: '2026-10-11T20:00:00Z', seasonName: 'Fall/Winter 2026' })).toBe('Fall/Winter 2026')
  })
  it('uses the event date for events and scrimmages', () => {
    const label = getRegistrationDateLabel({ type: 'scrimmage', startDate: '2026-10-11T20:00:00Z', seasonName: 'Fall/Winter 2026' })
    expect(label).toMatch(/Oct 11/)
    expect(label).not.toBe('Fall/Winter 2026')
  })
  it('returns null instead of an empty string', () => {
    expect(getRegistrationDateLabel({ type: 'team', seasonName: '  ' })).toBeNull()
    expect(getRegistrationDateLabel({ type: 'event', startDate: null, seasonName: null })).toBeNull()
  })
})

describe('resolveRefundEmailContext', () => {
  beforeEach(() => { for (const k of Object.keys(results)) delete results[k] })
  const run = () => resolveRefundEmailContext(createAdminClient(), 'u1', 'p1')

  it('resolves a team registration to its season', async () => {
    results.user_registrations = { data: { registration: { name: 'Rec League', type: 'team', start_date: null, season: { name: 'Fall/Winter 2026' } } }, error: null }
    await expect(run()).resolves.toEqual({ registrationName: 'Rec League', seasonName: 'Fall/Winter 2026', source: 'registration' })
  })

  it('resolves an alternate selection (the 2026-10-13 incident case)', async () => {
    results.alternate_selections = { data: { alternate_registration: { game_date: '2026-10-11T20:00:00Z', registration: { name: 'Rec League', type: 'team', start_date: null, season: [{ name: 'Fall/Winter 2026' }] } } }, error: null }
    await expect(run()).resolves.toEqual({ registrationName: 'Rec League', seasonName: 'Fall/Winter 2026', source: 'alternate' })
  })

  it('uses the game date for an alternate on an event', async () => {
    results.alternate_selections = { data: { alternate_registration: { game_date: '2026-10-11T20:00:00Z', registration: { name: 'Clinic', type: 'event', start_date: null, season: { name: 'S' } } } }, error: null }
    const ctx = await run()
    expect(ctx?.seasonName).toMatch(/Oct 11/)
  })

  it('resolves a membership', async () => {
    results.user_memberships = { data: { valid_until: '2027-06-30', membership: { name: 'Adult Membership' } }, error: null }
    await expect(run()).resolves.toEqual({ registrationName: 'Adult Membership', seasonName: 'Valid through 6/30/2027', source: 'membership' })
  })

  it('returns null when nothing matches', async () => {
    await expect(run()).resolves.toBeNull()
  })
})
