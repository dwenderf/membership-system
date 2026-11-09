'use client'

import { Fragment } from 'react'
import Link from 'next/link'
import {
  POLICY_CHECKBOX_PREFIX,
  POLICY_CHECKBOX_SUFFIX,
  POLICY_DOCUMENTS,
  policyListSeparator,
} from '@/lib/policies'

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
          {POLICY_CHECKBOX_PREFIX}
          {POLICY_DOCUMENTS.map((doc, i) => (
            <Fragment key={doc.key}>
              {policyListSeparator(i)}
              <Link href={doc.href} target="_blank" className="text-blue-600 hover:text-blue-800 underline">
                {doc.label}
              </Link>
            </Fragment>
          ))}
          {POLICY_CHECKBOX_SUFFIX}
        </label>
      </div>
      {error && (
        <p className="text-sm text-red-600">{error}</p>
      )}
    </div>
  )
}
