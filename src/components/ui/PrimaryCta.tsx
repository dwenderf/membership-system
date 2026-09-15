import Link from 'next/link'
import type { ReactNode } from 'react'

interface PrimaryCtaProps {
  href: string
  icon?: ReactNode
  children: ReactNode
  className?: string
}

/**
 * NYCPHA's brand CTA style: a pill button with a hard offset "sticker" shadow
 * that shrinks and shifts on hover to read as a press. Reserved for genuinely
 * primary actions — not meant to be applied to every button in the app.
 */
export default function PrimaryCta({ href, icon, children, className = '' }: PrimaryCtaProps) {
  return (
    <Link
      href={href}
      className={`group inline-flex items-center justify-between gap-3 w-full sm:w-auto min-w-[225px] rounded-full border-[3px] border-brand-ink bg-white px-6 py-4 font-sans font-bold text-brand-ink shadow-[4px_4px_0_var(--color-brand-ink)] transition-all duration-300 hover:bg-brand-tide hover:shadow-[1px_1px_0_var(--color-brand-ink)] hover:translate-x-[3px] hover:translate-y-[3px] ${className}`}
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
