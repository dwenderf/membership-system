/**
 * Tests for membership validation functions
 */

import {
  validateMembershipCoverage,
  formatMembershipWarning,
  UserMembership,
  Season,
} from '@/lib/membership-validation'

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
})
