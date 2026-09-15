interface PrimaryCtaStyleOptions {
  fullWidth?: boolean
  disabled?: boolean
}

/**
 * Shared visual style behind PrimaryCta (Link) and PrimaryCtaButton (button):
 * NYCPHA's pill CTA with a hard offset "sticker" shadow that shrinks and
 * shifts on hover to read as a press.
 */
export function primaryCtaClassName({ fullWidth = false, disabled = false }: PrimaryCtaStyleOptions = {}): string {
  const width = fullWidth ? 'w-full' : 'w-full sm:w-auto'

  // Callers add their own justify-* (Link: justify-between for icon+chevron;
  // PrimaryCtaButton: justify-center for plain text).
  if (disabled) {
    return `inline-flex items-center gap-3 ${width} min-w-[225px] rounded-full border-[3px] border-gray-300 bg-gray-100 px-6 py-4 font-sans font-bold text-gray-400 cursor-not-allowed`
  }

  return `group inline-flex items-center gap-3 ${width} min-w-[225px] rounded-full border-[3px] border-brand-ink bg-white px-6 py-4 font-sans font-bold text-brand-ink shadow-[4px_4px_0_var(--color-brand-ink)] transition-all duration-300 hover:bg-brand-tide hover:shadow-[1px_1px_0_var(--color-brand-ink)] hover:translate-x-[3px] hover:translate-y-[3px]`
}
