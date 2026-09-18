// Single source of truth for the four documents shown at onboarding, membership
// purchase, and registration. All in-app: this repo is canonical for all four.
export const POLICY_LINKS = {
  terms: '/terms',
  privacyPolicy: '/privacy-policy',
  codeOfConduct: '/code-of-conduct',
  concussionPolicy: '/concussion-policy',
} as const
