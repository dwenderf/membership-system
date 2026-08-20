/**
 * Shared helpers for reading errors thrown by the xero-node SDK.
 *
 * On a failed API call, xero-node's AccountingApi builds an `ApiError` from the raw
 * axios error response and rejects with `JSON.stringify(...)` of it — so `catch` receives
 * a JSON *string*, not a live object, in most cases. Some call sites in this codebase also
 * receive the object directly (e.g. from `xeroApi.accountingApi.updateContact`'s promise
 * rejection). These helpers handle both, plus a bare `Error`.
 *
 * The parsed shape is the raw Xero REST API error JSON (PascalCase), distinct from
 * xero-node's own camelCase SDK model classes.
 */

export interface XeroApiErrorBody {
  Elements?: Array<{ ValidationErrors?: Array<{ Message: string }> }>
  Message?: string
}

export interface XeroApiError {
  message?: string
  response?: { status?: number; body?: XeroApiErrorBody }
  body?: XeroApiErrorBody
}

function tryJsonParse(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return undefined
  }
}

function asXeroApiError(error: unknown): XeroApiError | undefined {
  if (typeof error === 'string') {
    const parsed = tryJsonParse(error)
    return parsed && typeof parsed === 'object' ? (parsed as unknown as XeroApiError) : undefined
  }
  if (error && typeof error === 'object') {
    return error as unknown as XeroApiError
  }
  return undefined
}

/**
 * Extracts the first Xero validation error message, if present.
 * Checks `response.body.Elements[0].ValidationErrors[0].Message`, then `body.Elements[...]`,
 * then falls back to a top-level `message`.
 */
export function getXeroValidationMessage(error: unknown): string | undefined {
  const xeroError = asXeroApiError(error)
  return (
    xeroError?.response?.body?.Elements?.[0]?.ValidationErrors?.[0]?.Message ??
    xeroError?.body?.Elements?.[0]?.ValidationErrors?.[0]?.Message ??
    xeroError?.message
  )
}

/** Extracts the HTTP status code from a Xero SDK error, if present. */
export function getXeroErrorStatus(error: unknown): number | undefined {
  return asXeroApiError(error)?.response?.status
}

/**
 * Shape of the axios-style errors thrown by `xero.refreshWithRefreshToken` (OAuth token
 * refresh) — distinct from the accounting API's validation-error shape above.
 */
export interface HttpClientError {
  message?: string
  stack?: string
  response?: { status?: number; data?: unknown }
}

export function asHttpClientError(error: unknown): HttpClientError | undefined {
  if (error && typeof error === 'object') {
    return error as unknown as HttpClientError
  }
  return undefined
}

/**
 * A single entry in a Xero batch API error's `Elements` array. Each element represents
 * one item from the batch (an invoice, credit note, or payment) — only the ID/Number
 * fields relevant to that entity type are present.
 */
export interface XeroBatchErrorElement {
  ValidationErrors?: Array<{ Message: string }>
  InvoiceID?: string
  InvoiceNumber?: string
  CreditNoteID?: string
  CreditNoteNumber?: string
  PaymentID?: string
}

export interface XeroBatchErrorBody {
  Elements?: XeroBatchErrorElement[]
}

/**
 * Parses a batch sync error thrown by xero-node into its raw error body. Handles the
 * JSON-stringified rejection (see module docs above) as well as receiving the object
 * directly, and unwraps `response.body` / `body` wrappers.
 */
export function parseXeroBatchError(error: unknown): XeroBatchErrorBody | undefined {
  const parsed: unknown = typeof error === 'string' ? (tryJsonParse(error) ?? error) : error
  if (!parsed || typeof parsed !== 'object') {
    return undefined
  }
  const wrapper = parsed as { response?: { body?: unknown }; body?: unknown }
  return (wrapper.response?.body ?? wrapper.body ?? parsed) as XeroBatchErrorBody
}
