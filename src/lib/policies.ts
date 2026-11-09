// Single source of truth for the four documents shown at onboarding, membership
// purchase, and registration. All in-app: this repo is canonical for all four.
export const POLICY_LINKS = {
  terms: '/terms',
  privacyPolicy: '/privacy-policy',
  codeOfConduct: '/code-of-conduct',
  concussionPolicy: '/concussion-policy',
} as const

// The four documents in the order they are named everywhere in the UI.
export const POLICY_DOCUMENTS = [
  { key: 'terms', label: 'Terms and Conditions', href: POLICY_LINKS.terms },
  { key: 'codeOfConduct', label: 'Code of Conduct', href: POLICY_LINKS.codeOfConduct },
  { key: 'concussionPolicy', label: 'Concussion Policy', href: POLICY_LINKS.concussionPolicy },
  { key: 'privacyPolicy', label: 'Privacy Policy', href: POLICY_LINKS.privacyPolicy },
] as const

/** Separator rendered before the document at `index` ("", ", ", or ", and "). */
export function policyListSeparator(index: number): string {
  if (index === 0) return ''
  return index === POLICY_DOCUMENTS.length - 1 ? ', and ' : ', '
}

/** "Terms and Conditions, Code of Conduct, Concussion Policy, and Privacy Policy" */
export const POLICY_LIST_TEXT = POLICY_DOCUMENTS
  .map((doc, i) => `${policyListSeparator(i)}${doc.label}`)
  .join('')

// Policy acceptance checkbox (PolicyAcceptanceCheckbox renders each document as a link).
export const POLICY_CHECKBOX_PREFIX = 'I agree to the '
export const POLICY_CHECKBOX_SUFFIX = ' *'
/** Plain-text form of the checkbox label, as it reads on screen. */
export const POLICY_CHECKBOX_TEXT = `${POLICY_CHECKBOX_PREFIX}${POLICY_LIST_TEXT}${POLICY_CHECKBOX_SUFFIX}`

/** Purchase / registration button label while the policies checkbox is unchecked. */
export const ACCEPT_POLICIES_BUTTON_LABEL = 'Accept Policies to Continue'

/** Client-side error shown when the checkbox is unchecked at purchase or registration. */
export function policiesRequiredMessage(action: 'purchasing' | 'continuing'): string {
  return `Please agree to the ${POLICY_LIST_TEXT} before ${action}`
}

/** API error returned when a request arrives without policiesAccepted: true. */
export const POLICIES_REQUIRED_API_ERROR = `You must agree to the ${POLICY_LIST_TEXT}`

/** Onboarding form error when the checkbox is unchecked. */
export const ONBOARDING_POLICIES_REQUIRED_MESSAGE = 'You must accept the terms and conditions to continue'
