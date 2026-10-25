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
