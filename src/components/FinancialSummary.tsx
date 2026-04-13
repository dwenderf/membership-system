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
  const dollars = Math.round(cents / 100)
  return `$${dollars.toLocaleString('en-US')}`
}

export default function FinancialSummary({ data, mode, showAlternates = true }: FinancialSummaryProps) {
  const hasAlternates = showAlternates && (data.alt_net > 0 || data.alt_gross > 0)

  if (mode === 'compact') {
    return (
      <div className="mt-3 pt-3 border-t border-gray-200 space-y-1 text-xs text-gray-600">
        <div className="flex items-center gap-2">
          <span className="text-gray-500">{formatCents(data.roster_gross)}</span>
          {data.roster_discounts > 0 && (
            <span className="text-red-500">−{formatCents(data.roster_discounts)}</span>
          )}
          <span className="font-medium text-gray-900">= {formatCents(data.roster_net)}</span>
        </div>
        {hasAlternates && (
          <div className="flex items-center gap-2">
            <span className="text-gray-500 font-medium">Alts</span>
            {data.alt_discounts > 0 ? (
              <>
                <span className="text-gray-500">{formatCents(data.alt_gross)}</span>
                <span className="text-red-500">−{formatCents(data.alt_discounts)}</span>
                <span className="font-medium text-gray-900">= {formatCents(data.alt_net)}</span>
              </>
            ) : (
              <span className="font-medium text-gray-900">{formatCents(data.alt_net)}</span>
            )}
          </div>
        )}
        {hasAlternates && (
          <div className="flex items-center gap-2 pt-1 border-t border-gray-100">
            <span className="font-semibold text-gray-700">Total</span>
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
      <table className="text-sm w-auto">
        <thead>
          <tr className="text-xs font-medium text-gray-500 uppercase tracking-wide">
            <th className="text-left pr-12 pb-2 font-medium"></th>
            <th className="text-left pr-10 pb-2 font-medium">Gross</th>
            <th className="text-left pr-10 pb-2 font-medium">Discounts</th>
            <th className="text-left pb-2 font-medium">Net</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="pr-12 py-1 text-xs text-gray-500 uppercase tracking-wide font-medium">Roster</td>
            <td className="pr-10 py-1 font-semibold text-gray-900">{formatCents(data.roster_gross)}</td>
            <td className="pr-10 py-1 font-semibold text-red-600">
              {data.roster_discounts > 0 ? `−${formatCents(data.roster_discounts)}` : '—'}
            </td>
            <td className="py-1 font-semibold text-green-700">{formatCents(data.roster_net)}</td>
          </tr>
          {showAlternates && (
            <tr>
              <td className="pr-12 py-1 text-xs text-gray-500 uppercase tracking-wide font-medium">Alternates</td>
              <td className="pr-10 py-1 font-semibold text-gray-900">{formatCents(data.alt_gross)}</td>
              <td className="pr-10 py-1 font-semibold text-red-600">
                {data.alt_discounts > 0 ? `−${formatCents(data.alt_discounts)}` : '—'}
              </td>
              <td className="py-1 font-semibold text-green-700">{formatCents(data.alt_net)}</td>
            </tr>
          )}
          {showAlternates && (
            <tr className="border-t border-gray-200">
              <td className="pr-12 pt-2 text-xs text-gray-700 uppercase tracking-wide font-semibold">Total Net</td>
              <td></td>
              <td></td>
              <td className="pt-2 text-base font-bold text-gray-900">{formatCents(data.total_net)}</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
