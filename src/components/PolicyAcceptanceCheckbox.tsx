'use client'

import Link from 'next/link'
import { POLICY_LINKS } from '@/lib/policies'

interface PolicyAcceptanceCheckboxProps {
  id?: string
  checked: boolean
  onChange: (checked: boolean) => void
  error?: string
}

export default function PolicyAcceptanceCheckbox({
  id = 'policiesAccepted',
  checked,
  onChange,
  error,
}: PolicyAcceptanceCheckboxProps) {
  return (
    <div className="space-y-3">
      <div className="flex items-start">
        <input
          id={id}
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className={`h-4 w-4 mt-0.5 text-blue-600 focus:ring-blue-500 border-gray-300 rounded ${
            error ? 'border-red-300' : ''
          }`}
        />
        <label htmlFor={id} className="ml-3 text-sm text-gray-700">
          I agree to the{' '}
          <Link href={POLICY_LINKS.terms} target="_blank" className="text-blue-600 hover:text-blue-800 underline">
            Terms and Conditions
          </Link>
          ,{' '}
          <Link href={POLICY_LINKS.codeOfConduct} target="_blank" className="text-blue-600 hover:text-blue-800 underline">
            Code of Conduct
          </Link>
          ,{' '}
          <Link href={POLICY_LINKS.concussionPolicy} target="_blank" className="text-blue-600 hover:text-blue-800 underline">
            Concussion Policy
          </Link>
          , and{' '}
          <Link href={POLICY_LINKS.privacyPolicy} target="_blank" className="text-blue-600 hover:text-blue-800 underline">
            Privacy Policy
          </Link>
          {' *'}
        </label>
      </div>
      {error && (
        <p className="text-sm text-red-600">{error}</p>
      )}
    </div>
  )
}
