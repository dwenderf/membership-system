import { Database } from '../../types/database'

/** The columns selected when reading existing `xero_invoice_line_items` rows for
 * reuse (credit note allocation, proportional refund calculations). */
export type XeroLineItemRow = Pick<
  Database['public']['Tables']['xero_invoice_line_items']['Row'],
  'description' | 'line_amount' | 'account_code' | 'tax_type' | 'line_item_type' | 'discount_code_id' | 'item_id'
>
