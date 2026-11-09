// Content: the Terms and Conditions document attached to issue #373 (last
// updated 9 November, 2026). Render it as written; do not edit the legal text here.
export default function TermsPage() {
  return (
    <div className="min-h-screen bg-gray-50 py-12">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="bg-white shadow-sm rounded-lg p-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-8">TERMS AND CONDITIONS &amp; LIABILITY WAIVER</h1>

          <div className="prose prose-gray max-w-none">
            <p className="text-sm text-gray-500 mb-6">
              <strong>Last Updated:</strong> 9 November, 2026
            </p>

            <p className="text-gray-700 mb-4">
              Welcome to the online platform and registration system (the &quot;System&quot;) of the <strong>New York City Gay Hockey Association, Inc.</strong>, a registered New York non-profit corporation (the &quot;Corporation&quot;), doing business as the <strong>New York City Pride Hockey Alliance</strong> (collectively referred to as &quot;NYCGHA,&quot; &quot;NYCPHA,&quot; &quot;we,&quot; &quot;us,&quot; or &quot;our&quot;).
            </p>
            <p className="text-gray-700 mb-4">
              By creating an account, registering for an activity, or executing a transaction through this System, you (the &quot;Participant,&quot; &quot;User,&quot; or &quot;Registrant&quot;) agree to be legally bound by these Terms and Conditions and the integrated Release of Liability (the &quot;Agreement&quot;). If you do not agree, you are not authorized to use the System or participate in any Corporation activities.
            </p>

            <hr className="my-8 border-gray-200" />

            <section className="mb-8">
              <h2 className="text-xl font-semibold text-gray-900 mb-4">1. Corporate Governance &amp; Participant Status</h2>
              <ul className="list-disc pl-6 text-gray-700 mb-4 space-y-2">
                <li><strong>Non-Membership Structure:</strong> In accordance with Article II of the Corporation’s official By-Laws, <strong>the Corporation has no corporate members</strong>. Legal, financial, and administrative management of the Corporation is vested strictly in the Board of Directors (the &quot;Board&quot;).</li>
                <li><strong>Participant Status:</strong> Registration, fee payment, or profile creation within the System grants an individual the status of an active <strong>Participant</strong> or <strong>Registrant</strong> in our hockey programs, leagues, and events. It does not grant corporate voting rights, ownership, or legal interest in the governance, assets, or property of the Corporation.</li>
                <li><strong>Age Restrictions:</strong> Active on-ice participation is strictly limited to individuals who are eighteen (18) years of age or older.</li>
                <li><strong>Board Discretion:</strong> The Board retains absolute authority to deny or revoke access to the System or bar any individual from participating in Corporation programs to serve the best interests of the organization.</li>
              </ul>
            </section>

            <section className="mb-8">
              <h2 className="text-xl font-semibold text-gray-900 mb-4">2. Fees, Financial Pipelines, and Arrears</h2>
              <ul className="list-disc pl-6 text-gray-700 mb-4 space-y-2">
                <li><strong>Payment Processing:</strong> The Board determines all season registration fees, scrimmage pricing, tournament entries, and payment plan schedules. All financial transactions are securely handled through our integrated payment processor, <strong>Stripe</strong>.</li>
                <li><strong>Accounting Sync &amp; Fiscal Year:</strong> By initiating a payment or partial payment plan, you authorize the System to pass transactional data to our financial ledger via the <strong>Xero API</strong> using a unique auto-assigned identifier under the standardized format: <code>&quot;First Last - MemberID&quot;</code>. The Corporation operates on a fiscal year beginning September 1 and ending August 31.</li>
                <li><strong>Arrears Policy:</strong> All participants must pay their league dues and event fees by the strict deadlines established by the organization. <strong>The Board reserves the absolute right to suspend playing privileges, remove individuals from rosters, or freeze account access for any participant found to be in arrears.</strong> Suspended individuals are ineligible to register for future activities until all outstanding balances are resolved and any outstanding Corporation property (such as team jerseys or socks) is returned.</li>
                <li><strong>Refund and Data Retention Policy:</strong> All event registration fees and transaction costs are completely non-refundable. Profiles requesting account closure are subjected to a database &quot;soft deletion&quot; to preserve structural financial history required for federal 501(c)(3) tax exemption and financial auditing compliance.</li>
              </ul>
            </section>

            <section className="mb-8">
              <h2 className="text-xl font-semibold text-gray-900 mb-4">3. Teams and Tournaments</h2>
              <ul className="list-disc pl-6 text-gray-700 mb-4 space-y-2">
                <li><strong>Roster Control:</strong> The Board, along with its designated team captains, league officials, and tournament administrators, holds absolute authority for determining division assignments, setting player rosters, and organizing brackets for all league play, scrimmages, and tournament teams.</li>
                <li><strong>Event Participation:</strong> Participants registering for our annual hosted tournament or representing NYCPHA at external competitions agree to follow the competitive timelines, code structures, and roster rules set forth by the specific event organizers.</li>
                <li><strong>Waitlists &amp; Automated Billing:</strong> Event slots and tournament entries are capped dynamically by the System based on capacity limits. If you register for a waitlisted position, you acknowledge and agree that you may be automatically selected to fill an opening and billed immediately via your saved Stripe payment method.</li>
                <li><strong>Alternates:</strong> Registered alternate players accept and agree that their saved payment method will be charged automatically on a dynamic, per-game basis if a team captain or league administrator selects them to complete an on-ice roster slot.</li>
              </ul>
            </section>

            <section className="mb-8">
              <h2 className="text-xl font-semibold text-gray-900 mb-4">4. Code of Conduct, Protective Equipment, and League Rules</h2>
              <ul className="list-disc pl-6 text-gray-700 mb-4 space-y-2">
                <li><strong>Code of Conduct Integration:</strong> All participants must strictly adhere to the active <strong>NYCPHA Code of Conduct</strong> available at <a href="https://my.nycpha.org/code-of-conduct" className="text-blue-600 hover:text-blue-800 underline">https://my.nycpha.org/code-of-conduct</a>. Discrimination, harassment, slurs, threats, or dangerous behavior (on or off the ice, in locker rooms, or via social media) will not be tolerated under any circumstances.</li>
                <li><strong>Mandatory Face Protection:</strong> For safety and insurance purposes, all players are strictly required to wear complete hockey equipment, including <strong>HECC/CSA-approved helmets equipped with a mandatory full face shield or cage</strong> at all times while on the ice, on the players&apos; bench, or in the penalty box. Modified half-shields, visors, or unshielded helmets are strictly prohibited for playing participants.</li>
                <li><strong>Adherence to Governing League Rules:</strong> NYCPHA programs run across various ice facilities and divisions (including our independent Rec League or external leagues operated at spaces like Chelsea Piers or Prospect Park). <strong>You agree to abide by the specific playing and game rules of the respective league under which your program is running.</strong> Rules, game suspensions, and disciplinary parameters are subject to the specific facility, league operator, or seasonal updates enacted by the Board.</li>
                <li><strong>Disciplinary Action:</strong> The Board retains sole discretion to issue sanctions, game suspensions, or permanent expulsion from all NYCPHA activities—without refund—for any violation of the Code of Conduct or governing league rules. Disciplinary decisions made by the Board are final and not subject to appeal.</li>
              </ul>
            </section>

            <section className="mb-8">
              <h2 className="text-xl font-semibold text-gray-900 mb-4">5. Rule Supremacy &amp; Conflict of Policies</h2>
              <ul className="list-disc pl-6 text-gray-700 mb-4 space-y-2">
                <li><strong>Supremacy of Specific Event Rules:</strong> NYCPHA coordinates and operates programs across a broad range of venues, structured leagues, and travel configurations. <strong>Any general protective equipment requirements, on-ice policies, game regulations, or operational rules described in this document may be completely superseded by the specific rules, guidelines, and bylaws governing individual tournaments, seasonal leagues, or host facilities.</strong></li>
                <li>In the event of a direct conflict between the boilerplate policies herein and the specialized handbooks or rule sheets distributed for a specific league (e.g., rules specific to Chelsea Piers Adult Hockey Leagues vs. Prospect Park tournaments vs. our internal Rec League variations), <strong>the rules of the specific governing league running that unique program shall control and take immediate precedence.</strong></li>
              </ul>
            </section>

            <section className="mb-8">
              <h2 className="text-xl font-semibold text-gray-900 mb-4">6. Comprehensive Waiver, Release of Liability &amp; Hold-Harmless Agreement</h2>
              <p className="text-gray-700 mb-4"><em>Completion and execution of this waiver form is an absolute prerequisite to participation in any Corporation on-ice activity.</em></p>
              <ul className="list-disc pl-6 text-gray-700 mb-4 space-y-2">
                <li><strong>Assumption of Inherent Risk:</strong> You acknowledge and fully understand that ice hockey is a high-speed, full-contact, and fundamentally <strong>hazardous athletic activity</strong>. Participation involves severe inherent risks, including but not limited to: collisions with boards, goals, or other players; contact with pucks traveling at high velocities, razor-sharp skate blades, and hockey sticks; falls on hard ice surfaces; equipment failure; and potential exposure to communicable illnesses. You recognize that these risks can result in severe physical trauma, concussions, irreversible brain injury, paralysis, broken bones, cardiac events, or <strong>death</strong>. Knowing and understanding these risks, <strong>you voluntarily choose to participate and expressly assume all risks</strong> associated with your presence at any NYCGHA/NYCPHA activity, whether on the ice, on the bench, in the locker rooms, or as a spectator attending games.</li>
                <li><strong>Release of Liability:</strong> To the maximum extent permitted under the laws of the State of New York, you hereby <strong>release, waive, acquit, and forever discharge</strong> the New York City Gay Hockey Association, Inc. (doing business as the New York City Pride Hockey Alliance), its Board of Directors, its officers, team captains, coaches, game officials, referees, sponsors, volunteers, and all other members or participants (collectively, the &quot;Released Parties&quot;) from any and all claims, demands, liabilities, causes of action, lawsuits, or financial obligations arising out of <strong>ordinary negligence</strong>, personal injury, property damage, illness, or wrongful death sustained by you while participating in, traveling to, or attending any organization-sponsored event.</li>
                <li><strong>Indemnification &amp; Hold-Harmless:</strong> You explicitly agree to <strong>defend, indemnify, and hold harmless</strong> the Released Parties from any and all third-party claims, liabilities, losses, damages, or costs (including reasonable attorneys&apos; fees and legal expenses) arising out of, resulting from, or in any connection with your personal conduct, actions, omissions, or presence at any NYCGHA/NYCPHA scrimmage, league game, tournament, or social event.</li>
                <li><strong>Medical Consent &amp; Financial Responsibility:</strong> You certify that you are physically fit and have no medical conditions that would prevent your safe participation in ice hockey. In the event of an on-ice injury or medical emergency, you hereby grant the Corporation’s representatives the authority to seek emergency medical treatment on your behalf if you are incapacitated. You accept <strong>sole and exclusive financial responsibility</strong> for any and all costs related to medical transit, emergency room care, hospitalization, surgeries, or subsequent therapeutic treatments.</li>
              </ul>
            </section>

            <section className="mb-8">
              <h2 className="text-xl font-semibold text-gray-900 mb-4">7. Severability and Entire Agreement</h2>
              <ul className="list-disc pl-6 text-gray-700 mb-4 space-y-2">
                <li><strong>Severability:</strong> If any individual provision, paragraph, or clause of this Agreement is declared invalid, illegal, or unenforceable by a court of competent jurisdiction, such invalidation shall not affect, negate, or detract from the validity and legality of any other provision herein, all of which shall remain in full force and effect.</li>
                <li><strong>Governing Law and Jurisdiction:</strong> This Agreement is executed in and shall be construed strictly under the laws of the <strong>State of New York</strong>. Any formal legal proceedings, disputes, or arbitrations arising directly out of your participation or this liability release must be filed exclusively in a state or federal court located within the <strong>City and County of New York</strong>.</li>
              </ul>
            </section>
          </div>
        </div>
      </div>
    </div>
  )
}
