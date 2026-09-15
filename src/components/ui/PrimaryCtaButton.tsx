import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { primaryCtaClassName } from './primaryCtaStyles'

interface PrimaryCtaButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'> {
  children: ReactNode
  className?: string
  fullWidth?: boolean
}

/**
 * Button counterpart to PrimaryCta, for a primary action that isn't
 * navigation (e.g. submitting a purchase) — same NYCPHA CTA style, including
 * a muted disabled state, since the native `disabled` attribute alone can't
 * express the pill/shadow treatment's "off" look.
 */
export default function PrimaryCtaButton({
  children,
  className = '',
  fullWidth = true,
  disabled,
  type = 'button',
  ...rest
}: PrimaryCtaButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled}
      className={`${primaryCtaClassName({ fullWidth, disabled })} justify-center ${className}`}
      {...rest}
    >
      {children}
    </button>
  )
}
