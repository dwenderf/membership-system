/**
 * Client-side early payoff submission (#452), kept out of the component so it's unit-testable
 * without a DOM. Guarantees at most one POST in flight per guard (double-clicks, re-renders), and
 * always refetches the plan list afterwards so the card reflects the server - router.refresh()
 * alone doesn't rerun the component's client-side fetch.
 */
export type EarlyPayoffClientResult =
  | { status: 'skipped' }
  | { status: 'success' }
  | { status: 'error'; message: string }

export async function submitEarlyPayoff(args: {
  planId: string
  inFlight: { current: boolean }
  refetch: () => Promise<void> | void
  fetchImpl?: typeof fetch
}): Promise<EarlyPayoffClientResult> {
  const { planId, inFlight, refetch } = args
  const fetchImpl = args.fetchImpl ?? fetch
  if (inFlight.current) return { status: 'skipped' }
  inFlight.current = true

  let result: EarlyPayoffClientResult
  try {
    const response = await fetchImpl('/api/user/payment-plans/early-payoff', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ planId })
    })
    const data = await response.json().catch(() => ({}))
    result = response.ok && data.success
      ? { status: 'success' }
      : { status: 'error', message: data.error || 'Failed to process early payoff' }
  } catch {
    result = { status: 'error', message: 'An unexpected error occurred' }
  }

  try {
    // Refetch on failure too: a declined payoff is rolled back, an in-progress one isn't.
    await refetch()
  } finally {
    inFlight.current = false
  }
  return result
}
