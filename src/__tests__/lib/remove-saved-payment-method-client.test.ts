import { fetchSavedPaymentMethod, removeSavedPaymentMethodAndRefetch } from '@/lib/payment-methods/remove-saved-payment-method-client'

// Simulates PaymentMethodsSection's remove flow against a server whose DELETE now
// clears the DB synchronously: the old card must not reappear after removal.
describe('removeSavedPaymentMethodAndRefetch (PaymentMethodsSection remove flow)', () => {
  it('refetches immediately after DELETE and the old card does not reappear', async () => {
    let saved: { id: string } | null = { id: 'pm_old' }
    const calls: string[] = []
    const fetchImpl = jest.fn(async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`)
      if (init?.method === 'DELETE') { saved = null; return new Response(JSON.stringify({ success: true }), { status: 200 }) }
      return new Response(JSON.stringify({ paymentMethod: saved }), { status: 200 })
    }) as unknown as typeof fetch
    const timeoutSpy = jest.spyOn(global, 'setTimeout')
    const result = await removeSavedPaymentMethodAndRefetch(fetchImpl)
    expect(result.paymentMethod).toBeNull()
    expect(calls).toEqual(['DELETE /api/remove-payment-method', 'GET /api/user-payment-method'])
    expect(timeoutSpy).not.toHaveBeenCalled() // no delayed (1s) refetch scheduled
    timeoutSpy.mockRestore()
  })

  it('throws the server error when DELETE fails', async () => {
    const fetchImpl = jest.fn(async () => new Response(JSON.stringify({ error: 'No payment method found' }), { status: 404 })) as unknown as typeof fetch
    await expect(removeSavedPaymentMethodAndRefetch(fetchImpl)).rejects.toThrow('No payment method found')
  })
})

// Mirrors PaymentMethodsSection.loadPaymentMethod: state is only replaced when ok
async function reloadInto(current: { id: string } | null, fetchImpl: typeof fetch) {
  const r = await fetchSavedPaymentMethod<{ id: string }>(fetchImpl)
  return r.ok ? r.paymentMethod : current
}

describe('fetchSavedPaymentMethod (reload after a removal error)', () => {
  const card = { id: 'pm_1' }
  it('keeps the existing card when the reload has a network error', async () => {
    const f = jest.fn(async () => { throw new TypeError('Failed to fetch') }) as unknown as typeof fetch
    expect(await fetchSavedPaymentMethod(f)).toMatchObject({ ok: false })
    expect(await reloadInto(card, f)).toBe(card)
  })
  it('keeps the existing card on a non-OK reload', async () => {
    const f = jest.fn(async () => new Response('{}', { status: 500 })) as unknown as typeof fetch
    expect(await reloadInto(card, f)).toBe(card)
  })
  it('keeps the existing card when the body cannot be parsed', async () => {
    const f = jest.fn(async () => new Response('not json', { status: 200 })) as unknown as typeof fetch
    expect(await reloadInto(card, f)).toBe(card)
  })
  it('clears the card when the server confirms there is none (200, paymentMethod: null)', async () => {
    const f = jest.fn(async () => new Response(JSON.stringify({ paymentMethod: null }), { status: 200 })) as unknown as typeof fetch
    expect(await fetchSavedPaymentMethod(f)).toEqual({ ok: true, paymentMethod: null })
    expect(await reloadInto(card, f)).toBeNull()
  })
})
