/**
 * Client-side flow for removing the saved card (used by PaymentMethodsSection).
 *
 * DELETE /api/remove-payment-method now clears the DB synchronously, so we refetch
 * immediately after a successful DELETE (no timer racing the webhook). The refetch
 * result is the source of truth for what the UI shows.
 */
export async function removeSavedPaymentMethodAndRefetch<T = unknown>(
  fetchImpl: typeof fetch = fetch
): Promise<{ paymentMethod: T | null }> {
  const response = await fetchImpl('/api/remove-payment-method', { method: 'DELETE' })

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}))
    throw new Error(errorData.error || 'Failed to remove payment method')
  }

  try {
    const refetch = await fetchImpl('/api/user-payment-method')
    if (!refetch.ok) return { paymentMethod: null }
    const data = await refetch.json()
    return { paymentMethod: (data?.paymentMethod as T) ?? null }
  } catch {
    // The removal succeeded; if the refetch fails, trust the DELETE response
    return { paymentMethod: null }
  }
}

export type FetchSavedPaymentMethodResult<T> =
  | { ok: true; paymentMethod: T | null }
  | { ok: false; error: string }

/**
 * Load the saved card from the server. Only a 2xx with a parsed body counts as an
 * answer (including `paymentMethod: null`, meaning "no card"). A network error or
 * non-OK response returns `ok: false`, so callers keep the card they already show.
 */
export async function fetchSavedPaymentMethod<T = unknown>(
  fetchImpl: typeof fetch = fetch
): Promise<FetchSavedPaymentMethodResult<T>> {
  try {
    const response = await fetchImpl('/api/user-payment-method')
    if (!response.ok) return { ok: false, error: `HTTP ${response.status}` }
    const data = await response.json()
    return { ok: true, paymentMethod: (data?.paymentMethod as T) ?? null }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}
