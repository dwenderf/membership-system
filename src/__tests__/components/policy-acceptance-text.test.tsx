import { readFileSync } from 'fs'
import { join } from 'path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import PolicyAcceptanceCheckbox from '@/components/PolicyAcceptanceCheckbox'
import {
  ACCEPT_POLICIES_BUTTON_LABEL,
  ONBOARDING_POLICIES_REQUIRED_MESSAGE,
  POLICIES_REQUIRED_API_ERROR,
  POLICY_CHECKBOX_TEXT,
  POLICY_LINKS,
  policiesRequiredMessage,
} from '@/lib/policies'

const POLICY_LIST = 'Terms and Conditions, Code of Conduct, Concussion Policy, and Privacy Policy'

function stripTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
}

function readSource(relativePath: string): string {
  return readFileSync(join(__dirname, '..', '..', relativePath), 'utf8')
}

describe('shared policy acceptance text', () => {
  it('keeps the exact user-facing wording', () => {
    expect(POLICY_CHECKBOX_TEXT).toBe(`I agree to the ${POLICY_LIST} *`)
    expect(ACCEPT_POLICIES_BUTTON_LABEL).toBe('Accept Policies to Continue')
    expect(policiesRequiredMessage('purchasing')).toBe(`Please agree to the ${POLICY_LIST} before purchasing`)
    expect(policiesRequiredMessage('continuing')).toBe(`Please agree to the ${POLICY_LIST} before continuing`)
    expect(POLICIES_REQUIRED_API_ERROR).toBe(`You must agree to the ${POLICY_LIST}`)
    expect(ONBOARDING_POLICIES_REQUIRED_MESSAGE).toBe('You must accept the terms and conditions to continue')
  })

  it('renders the checkbox label from the shared text with a link to each document', () => {
    const html = renderToStaticMarkup(
      createElement(PolicyAcceptanceCheckbox, { checked: false, onChange: () => {} })
    )
    const label = html.match(/<label[^>]*>([\s\S]*?)<\/label>/)
    expect(label).not.toBeNull()
    expect(stripTags(label![1])).toBe(POLICY_CHECKBOX_TEXT)

    const hrefs = Array.from(label![1].matchAll(/<a [^>]*href="([^"]+)"/g)).map((m) => m[1])
    expect(hrefs).toEqual([
      POLICY_LINKS.terms,
      POLICY_LINKS.codeOfConduct,
      POLICY_LINKS.concussionPolicy,
      POLICY_LINKS.privacyPolicy,
    ])
    expect(label![1].match(/target="_blank"/g)).toHaveLength(4)
  })

  it('renders the error passed to the checkbox', () => {
    const message = policiesRequiredMessage('purchasing')
    const html = renderToStaticMarkup(
      createElement(PolicyAcceptanceCheckbox, { checked: false, onChange: () => {}, error: message })
    )
    expect(stripTags(html)).toContain(message)
  })

  it.each([
    ['components/MembershipPurchase.tsx', "policiesRequiredMessage('purchasing')"],
    ['components/RegistrationPurchase.tsx', "policiesRequiredMessage('continuing')"],
  ])('%s uses the shared button label and error message', (file, errorCall) => {
    const source = readSource(file)
    expect(source).toContain('ACCEPT_POLICIES_BUTTON_LABEL')
    expect(source).toContain(errorCall)
    expect(source).not.toContain("'Accept Policies to Continue'")
    expect(source).not.toContain('Please agree to the Terms')
  })

  it.each([
    'app/onboarding/page.tsx',
    'app/api/create-membership-payment-intent/route.ts',
    'app/api/create-registration-payment-intent/route.ts',
    'app/api/join-waitlist/route.ts',
    'app/api/user-alternate-registrations/route.ts',
  ])('%s has no inline copy of the policy wording', (file) => {
    const source = readSource(file)
    expect(source).not.toContain(POLICY_LIST)
    expect(source).not.toContain('You must accept the terms and conditions')
  })
})
