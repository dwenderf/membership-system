import Link from 'next/link'

export default function CodeOfConductPage() {
  return (
    <div className="min-h-screen bg-gray-50 py-12">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="bg-white shadow-sm rounded-lg p-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-8">NYCPHA Code of Conduct</h1>

          <div className="prose prose-gray max-w-none">
            <section className="mb-8">
              <p className="text-gray-700 mb-6">
                The NYCPHA Code of Conduct is the organization&apos;s statement of expected behavioral standards that all players are required to read, understand, and follow. The Code of Conduct, intended to reflect the stated goals of the NYCPHA (see Mission Statement), clarifies the expectation that NYCPHA players have responsibility for their actions in connection with NYCPHA activities both on and off the ice, at home and while traveling, and through their use of social media. This Code of Conduct is intended to ensure that there is a fair process in place for ensuring that members are held accountable for their actions when NYCPHA standards are violated.
              </p>
              <p className="text-gray-700 mb-6">
                The Code of Conduct has been adopted by the NYCPHA Board of Directors (&quot;the Board&quot;) and applies to all members of the NYCPHA. All members of the NYCPHA agree to abide by this Code of Conduct in signing up for membership and in participating in NYCPHA activities.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-xl font-semibold text-gray-900 mb-4">Mission Statement</h2>
              <p className="text-gray-700 mb-4">
                The New York City Pride Hockey Alliance provides a safe-space for the LGBTQ+ community and its allies that celebrates inclusivity, fosters connection, and champions pride both on and off the ice.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-xl font-semibold text-gray-900 mb-4">Language</h2>
              <p className="text-gray-700 mb-4">
                Threatening conduct of any kind, verbal threats, slurs of any kind against race, ethnicity, sexual orientation, or gender identity will not be tolerated under any circumstances.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-xl font-semibold text-gray-900 mb-4">Sportsmanship</h2>
              <p className="text-gray-700 mb-4">
                Sportsmanship is defined as fairness and respect for one&apos;s opponent, and graciousness in winning or losing.
              </p>
              <p className="text-gray-700 mb-4">
                All players are expected to conduct themselves with the highest level of sportsmanship. Any player who deliberately tries to harm or intimidate another player through threatening, aggressive or demeaning actions and/or language of any kind will be subject to the consequences described herein.
              </p>
              <p className="text-gray-700 mb-4">
                As representatives of the NYCPHA their teams, it is doubly important that Captains and Alternate Captains be held to the highest level of conduct. They set the example for the team.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-xl font-semibold text-gray-900 mb-4">Enforcement Process</h2>
              <p className="text-gray-700 mb-4">
                Members are encouraged to report possible violations of the Code of Conduct to the Board. Code of Conduct violations can be reported to any member of the Board either in person or via email at{' '}
                <Link href="mailto:codeofconduct@nycpha.org" className="text-blue-600 hover:text-blue-800 underline">
                  codeofconduct@nycpha.org
                </Link>
                .
              </p>
              <p className="text-gray-700 mb-4">
                The Board will investigate all such complaints or designate another officer or member of the NYCPHA to do so. The Board may also investigate potential violations of the Code of Conduct of its own accord or upon receiving a report from a non-member.
              </p>
              <p className="text-gray-700 mb-4">
                In completing an investigation, it will generally be the Board&apos;s practice to make findings of fact regarding the allegations and to give notice and an opportunity to respond to the person(s) against whom a violation has been reported.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-xl font-semibold text-gray-900 mb-4">Consequences</h2>
              <p className="text-gray-700 mb-4">
                Should the Board conclude that the Code of Conduct has been violated, the Board will determine the appropriate sanction.
              </p>
              <p className="text-gray-700 mb-4">
                The penalty for each violation will be determined at the sole discretion of the Board. Sanctions can include but are not limited to: warnings, suspensions from games (including the forfeiture of prepaid alternate passes), removal from teams, suspension of NYCPHA membership or expulsion from the NYCPHA.
              </p>
              <p className="text-gray-700 mb-4">
                In determining the appropriate sanctions, the Board will generally take into account the totality of the member&apos;s conduct within the NYCPHA, including that member&apos;s past violations of the Code of Conduct.
              </p>
              <p className="text-gray-700 mb-4">
                The Board&apos;s decisions are not subject to appeal. The Board notes that it will generally be its practice to expel members only by consensus of the Board.
              </p>
              <p className="text-gray-700 mb-4">
                It will generally be the Board&apos;s practice to inform interested parties of the sanctions it has issued under the Code of Conduct. In addition, players who are suspended or expelled are not eligible for a refund of any portion of their season fees nor are they allowed to sit on the bench during the term of their suspensions.
              </p>
              <p className="text-gray-700 mb-4">
                It will generally be the Board&apos;s practice to presume that conduct that led any hockey venue staff or on-ice official to penalize a member with a match penalty or a suspension due to offending conduct of the type described herein has violated the Code of Conduct.
              </p>
              <p className="text-gray-700 mb-4">
                The Code of Conduct is subject to revision by the Board of the NYCPHA with or without notice. It will generally be the NYCPHA&apos;s practice to publish updates to the Code of Conduct on its website.
              </p>
            </section>
          </div>

          <div className="mt-8 pt-6 border-t border-gray-200">
            <p className="text-sm text-gray-500">
              This Code of Conduct is effective December 20, 2004.<br />
              The Code of Conduct was revised on March 25, 2007.<br />
              The Code of Conduct was revised on October 1, 2013.<br />
              The Code of Conduct was revised on August 5, 2019.<br />
              The Code of Conduct was revised on January 14, 2025.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
