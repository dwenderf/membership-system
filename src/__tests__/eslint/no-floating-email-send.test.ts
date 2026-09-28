/**
 * Tests for the local ESLint rule that blocks fire-and-forget email sends
 * (scripts/eslint-rules/no-floating-email-send.js, #395 / #398).
 */
import { RuleTester } from 'eslint'
import nextTypescript from 'eslint-config-next/typescript'
import rule from '../../../scripts/eslint-rules/no-floating-email-send.js'

// Reuse the exact TypeScript parser the repo's lint config uses, rather than
// depending on a transitive package directly.
const tsLanguageOptions = (nextTypescript as Array<{ languageOptions?: Record<string, unknown> }>)
  .find((c) => c.languageOptions?.parser)?.languageOptions

const ruleTester = new RuleTester({ languageOptions: tsLanguageOptions })

const notifierError = { messageId: 'floatingNotifier' }
const emailLogError = { messageId: 'floatingEmailLog' }

ruleTester.run('no-floating-email-send', rule, {
  valid: [
    // awaited
    { code: `async function f() { await stageCaptainRosterChangeNotification('r', 'u') }` },
    { code: `async function f() { await stageWaitlistRemovedEmail('r', 'u', 'c').catch(() => {}) }` },
    { code: `async function f() { await emailService.sendPaymentPlanCompleted({}) }` },
    // returned (explicit and implicit arrow)
    { code: `function f() { return stageAdminNewRegistrationNotification('r') }` },
    { code: `const f = () => emailService.sendWelcomeEmail({})` },
    // runAfterResponse + awaited Promise.all (the #398 pattern)
    {
      code: `
        runAfterResponse('op', async () => {
          await Promise.all([
            stageCaptainRosterChangeNotification('r', 'u').catch((err: unknown) => log(err)),
            stageAdminNewRegistrationNotification('r', 'u'),
          ])
        }, { registrationId: 'r' })
      `,
    },
    // Promise.allSettled returned
    { code: `function f() { return Promise.allSettled([stageFooEmail(), sendBarNotification()]) }` },
    // after() callback returning the promise
    { code: `after(() => stageRefundNotificationEmail('a', 'b', 'c'))` },
    // assigned for later handling
    { code: `async function f() { const p = stageWaitlistSelectedEmail('r'); await p }` },
    // this.* methods awaited (processor style)
    { code: `class P { async run() { await this.stageRegistrationConfirmationEmail(1, 2) } }` },
    // awaited email_logs writes, including builder chains
    { code: `async function f(s: any) { const { error } = await s.from('email_logs').insert({}) }` },
    { code: `async function f(s: any) { await s.from('email_logs').upsert({}).select().single() }` },
    { code: `function f(s: any) { return s.from('email_logs').insert({}) }` },
    // unrelated floating calls are out of scope (low noise)
    { code: `doSomethingElse(); logger.logSystem('x', 'y'); s.from('payments').insert({})` },
    { code: `stageSomething()` }, // doesn't end in Notification/Email
  ],
  invalid: [
    // bare call
    { code: `stageCaptainRosterChangeNotification('r', 'u')`, errors: [notifierError] },
    // with .catch() only (the exact pre-#398 shape)
    {
      code: `stageAdminNewRegistrationNotification('r', 'u').catch((err: unknown) => log(err))`,
      errors: [notifierError],
    },
    // .then() without return
    { code: `stageWaitlistSelectedEmail('r').then(() => {})`, errors: [notifierError] },
    // void
    { code: `void emailService.sendWaitlistAddedNotification({})`, errors: [notifierError] },
    // member-call send* on emailService with a non-standard suffix
    { code: `emailService.sendPaymentPlanCompleted({})`, errors: [notifierError] },
    // processor-style this.* call
    { code: `class P { async run() { this.stageRegistrationConfirmationEmail(1, 2) } }`, errors: [notifierError] },
    // emailStagingManager.stageEmail and logEmailToDatabase
    { code: `emailStagingManager.stageEmail({})`, errors: [notifierError] },
    { code: `class S { async send() { this.logEmailToDatabase({}) } }`, errors: [notifierError] },
    // Promise.all that is itself floating
    { code: `Promise.all([stageFooNotification(), stageBarEmail()])`, errors: [notifierError, notifierError] },
    // floating inside a runAfterResponse callback (not awaited within it)
    {
      code: `runAfterResponse('op', async () => { stageCaptainRosterChangeNotification('r', 'u') })`,
      errors: [notifierError],
    },
    // conditional fire-and-forget
    { code: `cond && sendAlternateRegistrationConfirmation({})`, errors: [notifierError] },
    // un-awaited email_logs writes
    { code: `function f(s: any) { s.from('email_logs').insert({}) }`, errors: [emailLogError] },
    { code: `function f(s: any) { s.from('email_logs').upsert({}).then(() => {}) }`, errors: [emailLogError] },
  ],
})
