/**
 * ESLint rule: no-floating-email-send
 *
 * Fails when an email notifier call, or an `email_logs` insert/upsert, is
 * fire-and-forget: its promise is left floating as a bare expression
 * statement (or `void`-ed) instead of being awaited, returned, or handed to
 * something that owns it (Promise.all/allSettled, runAfterResponse, after).
 *
 * Why: on Vercel the function is frozen as soon as the route returns, so a
 * floating promise is silently dropped some of the time (#395 / #398).
 *
 * This is a purely syntactic check (no type information needed), scoped in
 * eslint.config.mjs to route handlers and server-side email/processor code.
 * It deliberately only looks at known notifier names so it stays low-noise.
 *
 * How to comply:
 *   - `await stageFooNotification(...)`, or `return` it, or
 *   - wrap post-response work: `runAfterResponse('op', async () => {
 *       await Promise.all([stageFoo(...).catch(...), stageBar(...)])
 *     })`
 *
 * Escape hatch (must explain why):
 *   // eslint-disable-next-line local/no-floating-email-send -- <reason>
 */

// Bare-function / method names treated as email notifiers.
const NOTIFIER_NAME_PATTERNS = [
  /^stage[A-Z]\w*(Notification|Notifications|Email|Emails)$/, // stageCaptainRosterChangeNotification, stageWaitlistSelectedEmail, stageConfirmationEmails
  /^send[A-Z]\w*(Notification|Notifications|Confirmation|Email|Emails)$/, // sendWaitlistAddedNotification, sendWelcomeEmail
  /^sendEmailImmediately$/,
  /^stageEmail$/, // emailStagingManager.stageEmail
  /^logEmailToDatabase$/, // EmailService's email_logs writer
]

// Objects whose send*/stage* methods are always email sends, whatever the suffix
// (e.g. emailService.sendPaymentPlanCompleted).
const EMAIL_OBJECTS = new Set(['emailService', 'emailStagingManager', 'emailProcessor'])

const PROMISE_COMBINATORS = new Set(['all', 'allSettled', 'race', 'any'])
const LOG_WRITE_METHODS = new Set(['insert', 'upsert'])

function propertyName(member) {
  if (!member || member.type !== 'MemberExpression') return null
  if (!member.computed && member.property.type === 'Identifier') return member.property.name
  if (member.computed && member.property.type === 'Literal' && typeof member.property.value === 'string') {
    return member.property.value
  }
  return null
}

function isNotifierCall(node) {
  const callee = node.callee
  if (callee.type === 'Identifier') {
    return NOTIFIER_NAME_PATTERNS.some((re) => re.test(callee.name))
  }
  if (callee.type === 'MemberExpression') {
    const name = propertyName(callee)
    if (!name) return false
    if (NOTIFIER_NAME_PATTERNS.some((re) => re.test(name))) return true
    const obj = callee.object
    if (obj.type === 'Identifier' && EMAIL_OBJECTS.has(obj.name) && /^(send|stage)/.test(name)) return true
  }
  return false
}

/** `<anything>.from('email_logs').insert(...)` / `.upsert(...)` */
function isEmailLogsWrite(node) {
  const callee = node.callee
  if (callee.type !== 'MemberExpression' || !LOG_WRITE_METHODS.has(propertyName(callee))) return false
  const fromCall = callee.object
  if (!fromCall || fromCall.type !== 'CallExpression') return false
  if (propertyName(fromCall.callee) !== 'from') return false
  const arg = fromCall.arguments[0]
  return !!arg && arg.type === 'Literal' && arg.value === 'email_logs'
}

/**
 * Climb from a call to the outermost expression that carries the same promise:
 * `.then/.catch/.finally` chains, builder chains after `.insert()` (e.g.
 * `.select().single()`), parentheses/TS wrappers, conditional/logical
 * branches, and array elements of an awaited-or-not Promise combinator.
 */
function outermostCarrier(node) {
  let current = node
  for (;;) {
    const parent = current.parent
    if (!parent) return current

    // x.then(...) / x.catch(...) / x.select().single() — keep climbing the chain
    if (parent.type === 'MemberExpression' && parent.object === current &&
        parent.parent && parent.parent.type === 'CallExpression' && parent.parent.callee === parent) {
      current = parent.parent
      continue
    }

    if (
      parent.type === 'TSAsExpression' ||
      parent.type === 'TSNonNullExpression' ||
      parent.type === 'TSSatisfiesExpression' ||
      parent.type === 'TSTypeAssertion' ||
      parent.type === 'ChainExpression' ||
      (parent.type === 'ConditionalExpression' && parent.test !== current) ||
      (parent.type === 'LogicalExpression' && parent.right === current) ||
      (parent.type === 'SequenceExpression' && parent.expressions[parent.expressions.length - 1] === current)
    ) {
      current = parent
      continue
    }

    // [p1, p2] inside Promise.all([...]) — the combinator carries the promise
    if (parent.type === 'ArrayExpression' && parent.parent &&
        parent.parent.type === 'CallExpression' && parent.parent.arguments[0] === parent &&
        isPromiseCombinator(parent.parent)) {
      current = parent.parent
      continue
    }

    return current
  }
}

function isPromiseCombinator(call) {
  const callee = call.callee
  return callee.type === 'MemberExpression' &&
    callee.object.type === 'Identifier' && callee.object.name === 'Promise' &&
    PROMISE_COMBINATORS.has(propertyName(callee))
}

/** Floating = bare expression statement, or explicitly discarded with `void`. */
function isFloating(carrier) {
  const parent = carrier.parent
  if (!parent) return false
  if (parent.type === 'ExpressionStatement') return true
  if (parent.type === 'UnaryExpression' && parent.operator === 'void') return true
  // Sequence element that isn't the last one: its value is discarded
  if (parent.type === 'SequenceExpression' && parent.expressions[parent.expressions.length - 1] !== carrier) return true
  return false
}

function calleeLabel(node, sourceCode) {
  const text = sourceCode.getText(node.callee)
  return text.length > 60 ? `${text.slice(0, 57)}...` : text
}

/** @type {import('eslint').Rule.RuleModule} */
module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow fire-and-forget email notifier calls and email_logs writes (await them, return them, or use runAfterResponse/after())',
    },
    schema: [],
    messages: {
      floatingNotifier:
        "'{{name}}(...)' is fire-and-forget. Vercel freezes the function after the response, so this email can be silently dropped (#395). Await it, return it, or schedule it with runAfterResponse()/after().",
      floatingEmailLog:
        "email_logs {{method}} is not awaited or returned, so the log row can be silently dropped (#395). Await it and check the { error } result.",
    },
  },

  create(context) {
    const sourceCode = context.sourceCode || context.getSourceCode()
    return {
      CallExpression(node) {
        const notifier = isNotifierCall(node)
        const emailLog = !notifier && isEmailLogsWrite(node)
        if (!notifier && !emailLog) return

        const carrier = outermostCarrier(node)
        if (!isFloating(carrier)) return

        if (notifier) {
          context.report({ node, messageId: 'floatingNotifier', data: { name: calleeLabel(node, sourceCode) } })
        } else {
          context.report({ node, messageId: 'floatingEmailLog', data: { method: propertyName(node.callee) } })
        }
      },
    }
  },
}
