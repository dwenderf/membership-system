interface FinancialSummaryData {
  roster_gross: number
  roster_discounts: number
  roster_net: number
  alt_gross: number
  alt_discounts: number
  alt_net: number
  total_net: number
}

interface FinancialSummaryProps {
  data: FinancialSummaryData
  mode: 'compact' | 'full'
  showAlternates?: boolean
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

export default function FinancialSummary({ data, mode, showAlternates = true }: FinancialSummaryProps) {
  const hasAlternates = showAlternates && (data.alt_net > 0 || data.alt_gross > 0)

  if (mode === 'compact') {
    return (
      <div className="mt-3 pt-3 border-t border-gray-200 space-y-1 text-xs text-gray-600">
        <div className="flex justify-between">
          <span className="font-medium text-gray-700">Roster</span>
          <span className="text-right">
            <span className="text-gray-500">{formatCents(data.roster_gross)}</span>
            {data.roster_discounts > 0 && (
              <span className="text-red-500 ml-1">-{formatCents(data.roster_discounts)}</span>
            )}
            <span className="font-medium text-gray-900 ml-1">= {formatCents(data.roster_net)}</span>
          </span>
        </div>
        {hasAlternates && (
          <div className="flex justify-between">
            <span className="font-medium text-gray-700">Alternates</span>
            <span className="text-right">
              {data.alt_discounts > 0 ? (
                <>
                  <span className="text-gray-500">{formatCents(data.alt_gross)}</span>
                  <span className="text-red-500 ml-1">-{formatCents(data.alt_discounts)}</span>
                  <span className="font-medium text-gray-900 ml-1">= {formatCents(data.alt_net)}</span>
                </>
              ) : (
                <span className="font-medium text-gray-900">{formatCents(data.alt_net)}</span>
              )}
            </span>
          </div>
        )}
        {hasAlternates && (
          <div className="flex justify-between pt-1 border-t border-gray-100">
            <span className="font-semibold text-gray-700">Total Net</span>
            <span className="font-semibold text-gray-900">{formatCents(data.total_net)}</span>
          </div>
        )}
      </div>
    )
  }

  // Full mode — used on detail pages as a card section
  return (
    <div className="bg-white shadow rounded-lg p-6 mb-6">
      <h2 className="text-xl font-semibold text-gray-900 mb-4">Financial Summary</h2>
      <div className="space-y-3">
        {/* Roster row */}
        <div>
          <div className="flex items-center justify-between text-sm font-medium text-gray-500 uppercase tracking-wide mb-1">
            <span>Roster</span>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div className="text-center">
              <div className="text-xs text-gray-500 mb-0.5">Gross</div>
              <div className="text-base font-semibold text-gray-900">{formatCents(data.roster_gross)}</div>
            </div>
            <div className="text-center">
              <div className="text-xs text-gray-500 mb-0.5">Discounts</div>
              <div className="text-base font-semibold text-red-600">
                {data.roster_discounts > 0 ? `-${formatCents(data.roster_discounts)}` : '—'}
              </div>
            </div>
            <div className="text-center">
              <div className="text-xs text-gray-500 mb-0.5">Net</div>
              <div className="text-base font-semibold text-green-700">{formatCents(data.roster_net)}</div>
            </div>
          </div>
        </div>

        {/* Alternates row */}
        {showAlternates && (
          <>
            <div className="border-t border-gray-100 pt-3">
              <div className="flex items-center justify-between text-sm font-medium text-gray-500 uppercase tracking-wide mb-1">
                <span>Alternates</span>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div className="text-center">
                  <div className="text-xs text-gray-500 mb-0.5">Gross</div>
                  <div className="text-base font-semibold text-gray-900">{formatCents(data.alt_gross)}</div>
                </div>
                <div className="text-center">
                  <div className="text-xs text-gray-500 mb-0.5">Discounts</div>
                  <div className="text-base font-semibold text-red-600">
                    {data.alt_discounts > 0 ? `-${formatCents(data.alt_discounts)}` : '—'}
                  </div>
                </div>
                <div className="text-center">
                  <div className="text-xs text-gray-500 mb-0.5">Net</div>
                  <div className="text-base font-semibold text-green-700">{formatCents(data.alt_net)}</div>
                </div>
              </div>
            </div>

            {/* Total row */}
            <div className="border-t border-gray-200 pt-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Total Net</span>
                <span className="text-lg font-bold text-gray-900">{formatCents(data.total_net)}</span>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
