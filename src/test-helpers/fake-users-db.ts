/** Tiny in-memory users/alternates store that honours the conditional UPDATE filters */
export function makeFakeDb(initialPm: string | null) {
  const state = {
    user: { id: 'user-1', first_name: 'Ada', last_name: 'L', email: 'ada@example.com', stripe_payment_method_id: initialPm, stripe_customer_id: 'cus_1' } as Record<string, unknown>,
    alternatesDeleted: 0,
    updates: 0,
  }
  const supabase = {
    from(table: string) {
      if (table === 'user_alternate_registrations') {
        return { delete: () => ({ eq: async () => { state.alternatesDeleted++; return { error: null } } }) }
      }
      return {
        update(payload: Record<string, unknown>) {
          const filters: Record<string, unknown> = {}
          const q = {
            eq(col: string, val: unknown) { filters[col] = val; return q },
            async select() {
              const match = Object.entries(filters).every(([k, v]) => state.user[k] === v)
              if (!match) return { data: [], error: null }
              Object.assign(state.user, payload); state.updates++
              return { data: [{ ...state.user }], error: null }
            },
          }
          return q
        },
      }
    },
  }
  return { state, supabase: supabase as never }
}
