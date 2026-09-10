/**
 * Tests for membership validation functions
 */

import {
  validateMembershipCoverage,
  formatMembershipWarning,
  formatMembershipRequirementText,
  validateAssistanceAmount,
  UserMembership,
  Season,
} from '@/lib/membership-validation'
import { formatDateString } from '@/lib/date-utils'

describe('Membership Validation Functions', () => {
  const testSeason: Season = {
    name: 'Fall 2025',
    start_date: '2025-09-01',
    end_date: '2025-12-31',
  }

  describe('validateMembershipCoverage', () => {
    describe('field naming compatibility', () => {
      it('should find membership using membership.id (singular)', () => {
        const userMemberships: UserMembership[] = [
          {
            id: 'um-1',
            valid_from: '2025-01-01',
            valid_until: '2025-12-31',
            membership: {
              id: 'mem-123',
              name: 'Premium Membership',
            },
          },
        ]

        const result = validateMembershipCoverage('mem-123', userMemberships, testSeason)

        expect(result.isValid).toBe(true)
        expect(result.membershipName).toBe('Premium Membership')
      })

      it('should find membership using memberships.id (plural)', () => {
        const userMemberships: UserMembership[] = [
          {
            id: 'um-1',
            valid_from: '2025-01-01',
            valid_until: '2025-12-31',
            memberships: {
              id: 'mem-123',
              name: 'Premium Membership',
            },
          },
        ]

        const result = validateMembershipCoverage('mem-123', userMemberships, testSeason)

        expect(result.isValid).toBe(true)
        expect(result.membershipName).toBe('Premium Membership')
      })

      it('should find membership using membership_id (direct field)', () => {
        const userMemberships: UserMembership[] = [
          {
            id: 'um-1',
            membership_id: 'mem-123',
            valid_from: '2025-01-01',
            valid_until: '2025-12-31',
          },
        ]

        const result = validateMembershipCoverage('mem-123', userMemberships, testSeason)

        expect(result.isValid).toBe(true)
        expect(result.membershipName).toBeUndefined()
      })
    })

    describe('coverage validation', () => {
      it('should return valid when membership covers full season', () => {
        const userMemberships: UserMembership[] = [
          {
            id: 'um-1',
            valid_from: '2025-01-01',
            valid_until: '2026-01-15',
            membership: { id: 'mem-123', name: 'Premium' },
          },
        ]

        const result = validateMembershipCoverage('mem-123', userMemberships, testSeason)

        expect(result.isValid).toBe(true)
        expect(result.validUntil).toBe('2026-01-15')
      })

      it('should return valid when membership expires exactly on season end', () => {
        const userMemberships: UserMembership[] = [
          {
            id: 'um-1',
            valid_from: '2025-01-01',
            valid_until: '2025-12-31',
            membership: { id: 'mem-123', name: 'Premium' },
          },
        ]

        const result = validateMembershipCoverage('mem-123', userMemberships, testSeason)

        expect(result.isValid).toBe(true)
      })

      it('should return invalid when membership expires before season ends', () => {
        const userMemberships: UserMembership[] = [
          {
            id: 'um-1',
            valid_from: '2025-01-01',
            valid_until: '2025-11-15',
            membership: { id: 'mem-123', name: 'Premium' },
          },
        ]

        const result = validateMembershipCoverage('mem-123', userMemberships, testSeason)

        expect(result.isValid).toBe(false)
        expect(result.validUntil).toBe('2025-11-15')
        expect(result.seasonEndDate).toBe('2025-12-31')
        expect(result.daysShort).toBeGreaterThan(0)
        expect(result.monthsNeeded).toBeGreaterThanOrEqual(1)
      })

      it('should return invalid when no matching membership exists', () => {
        const userMemberships: UserMembership[] = [
          {
            id: 'um-1',
            valid_from: '2025-01-01',
            valid_until: '2025-12-31',
            membership: { id: 'mem-other', name: 'Other Membership' },
          },
        ]

        const result = validateMembershipCoverage('mem-123', userMemberships, testSeason)

        expect(result.isValid).toBe(false)
        expect(result.membershipName).toBeUndefined()
      })

      it('should return invalid when user has no memberships', () => {
        const result = validateMembershipCoverage('mem-123', [], testSeason)

        expect(result.isValid).toBe(false)
        expect(result.membershipName).toBeUndefined()
      })
    })

    describe('multiple memberships', () => {
      it('should use the membership with the latest expiration', () => {
        const userMemberships: UserMembership[] = [
          {
            id: 'um-1',
            valid_from: '2025-01-01',
            valid_until: '2025-10-31',
            membership: { id: 'mem-123', name: 'Premium' },
          },
          {
            id: 'um-2',
            valid_from: '2025-01-01',
            valid_until: '2026-02-28',
            membership: { id: 'mem-123', name: 'Premium' },
          },
          {
            id: 'um-3',
            valid_from: '2025-01-01',
            valid_until: '2025-11-30',
            membership: { id: 'mem-123', name: 'Premium' },
          },
        ]

        const result = validateMembershipCoverage('mem-123', userMemberships, testSeason)

        expect(result.isValid).toBe(true)
        expect(result.validUntil).toBe('2026-02-28')
      })

      it('should only consider memberships with matching ID', () => {
        const userMemberships: UserMembership[] = [
          {
            id: 'um-1',
            valid_from: '2025-01-01',
            valid_until: '2025-10-31',
            membership: { id: 'mem-123', name: 'Premium' },
          },
          {
            id: 'um-2',
            valid_from: '2025-01-01',
            valid_until: '2026-12-31',
            membership: { id: 'mem-other', name: 'Other' },
          },
        ]

        const result = validateMembershipCoverage('mem-123', userMemberships, testSeason)

        expect(result.isValid).toBe(false)
        expect(result.validUntil).toBe('2025-10-31')
      })
    })
  })

  describe('formatMembershipWarning', () => {
    it('should return empty string when membership is valid', () => {
      const result = formatMembershipWarning({
        isValid: true,
        membershipName: 'Premium',
        validUntil: '2026-01-15',
      })

      expect(result).toBe('')
    })

    it('should return generic message when no membership found', () => {
      const result = formatMembershipWarning({
        isValid: false,
        membershipName: undefined,
      })

      expect(result).toBe('You need a membership to register for this category.')
    })

    it('should include membership name and extension info when membership expires early', () => {
      const result = formatMembershipWarning({
        isValid: false,
        membershipName: 'Premium',
        validUntil: '2025-11-15',
        seasonEndDate: '2025-12-31',
        monthsNeeded: 2,
        daysShort: 46,
      })

      expect(result).toContain('Premium')
      expect(result).toContain('46 days')
      expect(result).toContain('2 months')
    })

    it('should use singular form for 1 day/month', () => {
      const result = formatMembershipWarning({
        isValid: false,
        membershipName: 'Premium',
        validUntil: '2025-12-30',
        seasonEndDate: '2025-12-31',
        monthsNeeded: 1,
        daysShort: 1,
      })

      expect(result).toContain('1 day')
      expect(result).toContain('1 month')
      expect(result).not.toContain('days')
      expect(result).not.toContain('months')
    })
  })

  describe('formatMembershipRequirementText', () => {
    const seasonEndDate = '2025-12-31'

    it('collapses an identical registration-level/category-level requirement (drops the OR)', () => {
      const result = formatMembershipRequirementText(
        [
          { id: 'mem-123', name: 'NYCPHA Full Membership' },
          { id: 'mem-123', name: 'NYCPHA Full Membership' },
        ],
        [],
        seasonEndDate
      )

      expect(result).toBe('NYCPHA Full Membership')
    })

    it('joins distinct requirements with OR when the user has neither', () => {
      const result = formatMembershipRequirementText(
        [
          { id: 'mem-123', name: 'NYCPHA Full Membership' },
          { id: 'mem-456', name: 'NYCPHA Social Membership' },
        ],
        [],
        seasonEndDate
      )

      expect(result).toBe('NYCPHA Full Membership OR NYCPHA Social Membership')
    })

    it('shows plain requirement text when no season end date is available', () => {
      const result = formatMembershipRequirementText(
        [{ id: 'mem-123', name: 'NYCPHA Full Membership' }],
        [{ membership_id: 'mem-123', valid_until: '2025-10-01' }],
        undefined
      )

      expect(result).toBe('NYCPHA Full Membership')
    })

    it('shows plain requirement text when the user has no matching membership at all', () => {
      const result = formatMembershipRequirementText(
        [{ id: 'mem-123', name: 'NYCPHA Full Membership' }],
        [{ membership_id: 'mem-other', valid_until: '2026-06-01' }],
        seasonEndDate
      )

      expect(result).toBe('NYCPHA Full Membership')
    })

    it('shows plain requirement text when the matching membership already covers the full season', () => {
      const result = formatMembershipRequirementText(
        [{ id: 'mem-123', name: 'NYCPHA Full Membership' }],
        [{ membership_id: 'mem-123', valid_until: '2026-06-01' }],
        seasonEndDate
      )

      expect(result).toBe('NYCPHA Full Membership')
    })

    it('adds the season end date and extension note for a single requirement expiring before season end', () => {
      const result = formatMembershipRequirementText(
        [{ id: 'mem-123', name: 'NYCPHA Full Membership' }],
        [{ membership_id: 'mem-123', valid_until: '2025-10-01' }],
        seasonEndDate
      )

      expect(result).toBe(
        `NYCPHA Full Membership valid until ${formatDateString(seasonEndDate)}. You need to extend your membership in order to register.`
      )
    })

    it('adds the season end date and extension note when two different requirements are offered and one is short', () => {
      const result = formatMembershipRequirementText(
        [
          { id: 'mem-123', name: 'NYCPHA Full Membership' },
          { id: 'mem-456', name: 'NYCPHA Social Membership' },
        ],
        [{ membership_id: 'mem-123', valid_until: '2025-10-01' }],
        seasonEndDate
      )

      expect(result).toBe(
        `NYCPHA Full Membership OR NYCPHA Social Membership valid until ${formatDateString(seasonEndDate)}. You need to extend your membership in order to register.`
      )
    })

    it('uses the latest-expiring matching membership to decide coverage, but still shows the season end date', () => {
      const result = formatMembershipRequirementText(
        [{ id: 'mem-123', name: 'NYCPHA Full Membership' }],
        [
          { membership_id: 'mem-123', valid_until: '2025-09-01' },
          { membership_id: 'mem-123', valid_until: '2025-11-15' },
        ],
        seasonEndDate
      )

      expect(result).toBe(
        `NYCPHA Full Membership valid until ${formatDateString(seasonEndDate)}. You need to extend your membership in order to register.`
      )
    })

    it('shows plain requirement text when the latest of several matching memberships covers the full season', () => {
      const result = formatMembershipRequirementText(
        [{ id: 'mem-123', name: 'NYCPHA Full Membership' }],
        [
          { membership_id: 'mem-123', valid_until: '2025-09-01' },
          { membership_id: 'mem-123', valid_until: '2026-06-01' },
        ],
        seasonEndDate
      )

      expect(result).toBe('NYCPHA Full Membership')
    })
  })

  describe('validateAssistanceAmount', () => {
    const priceCents = 3000 // $30.00

    it('rejects a blank amount', () => {
      expect(validateAssistanceAmount('', priceCents)).not.toBeNull()
    })

    it('rejects a whitespace-only amount', () => {
      expect(validateAssistanceAmount('   ', priceCents)).not.toBeNull()
    })

    it('rejects a bare "-"', () => {
      expect(validateAssistanceAmount('-', priceCents)).not.toBeNull()
    })

    it('rejects a bare "+"', () => {
      expect(validateAssistanceAmount('+', priceCents)).not.toBeNull()
    })

    it('rejects non-numeric text', () => {
      expect(validateAssistanceAmount('abc', priceCents)).not.toBeNull()
    })

    it('rejects a negative amount', () => {
      expect(validateAssistanceAmount('-5', priceCents)).not.toBeNull()
    })

    it('rejects an amount over the membership price', () => {
      expect(validateAssistanceAmount('31', priceCents)).not.toBeNull()
    })

    it('accepts an explicit $0', () => {
      expect(validateAssistanceAmount('0', priceCents)).toBeNull()
    })

    it('accepts a mid-range amount', () => {
      expect(validateAssistanceAmount('15', priceCents)).toBeNull()
    })

    it('accepts an amount exactly equal to the membership price', () => {
      expect(validateAssistanceAmount('30', priceCents)).toBeNull()
    })

    it('includes the dollar bounds in the error message', () => {
      const error = validateAssistanceAmount('', priceCents)
      expect(error).toContain('$0')
      expect(error).toContain('$30.00')
    })
  })
})
