import Link from 'next/link'
import type { ReactNode } from 'react'
import { primaryCtaClassName } from './primaryCtaStyles'

interface PrimaryCtaProps {
  href: string
  icon?: ReactNode
  children: ReactNode
  className?: string
  fullWidth?: boolean
}

/**
 * NYCPHA's brand CTA style: a pill button with a hard offset "sticker" shadow
 * that shrinks and shifts on hover to read as a press. Reserved for genuinely
 * primary actions — not meant to be applied to every button in the app.
 */
export default function PrimaryCta({ href, icon, children, className = '', fullWidth = false }: PrimaryCtaProps) {
  return (
    <Link
      href={href}
      className={`${primaryCtaClassName({ fullWidth })} justify-between ${className}`}
    >
      <span className="flex items-center gap-3">
        {icon && <span className="text-2xl">{icon}</span>}
        <span>{children}</span>
      </span>
      <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
      </svg>
    </Link>
  )
}
