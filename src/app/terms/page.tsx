import Link from 'next/link'

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-gray-50 py-12">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="bg-white shadow-sm rounded-lg p-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-8">Terms and Conditions</h1>
          
          <div className="prose prose-gray max-w-none">
            <p className="text-sm text-gray-500 mb-6">
              Last updated: June 22, 2025 (Version 1.0)
            </p>

            <section className="mb-8">
              <h2 className="text-xl font-semibold text-gray-900 mb-4">1. Acceptance of Terms</h2>
              <p className="text-gray-700 mb-4">
                By accessing and using this hockey association membership system ("Service"), you accept and agree to be bound by the terms and provision of this agreement.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-xl font-semibold text-gray-900 mb-4">2. Membership</h2>
              <p className="text-gray-700 mb-4">
                Membership to the hockey association is required to participate in certain activities, teams, and events. All memberships are subject to approval by association administrators.
              </p>
              <ul className="list-disc pl-6 text-gray-700 mb-4">
                <li>Membership fees are non-refundable except in extraordinary circumstances at the discretion of administrators</li>
                <li>Members must maintain current membership status to participate in association activities</li>
                <li>Membership benefits and privileges may vary by membership type</li>
              </ul>
            </section>

            <section className="mb-8">
              <h2 className="text-xl font-semibold text-gray-900 mb-4">3. Registration and Payment</h2>
              <p className="text-gray-700 mb-4">
                Registration for teams, events, and activities requires payment at the time of registration unless otherwise specified.
              </p>
              <ul className="list-disc pl-6 text-gray-700 mb-4">
                <li>All payments are processed securely through our payment processor</li>
                <li>Registration fees are generally non-refundable</li>
                <li>Refunds may be considered on a case-by-case basis for medical or extraordinary circumstances</li>
                <li>Failure to pay outstanding fees may result in suspension of membership privileges</li>
              </ul>
            </section>

            <section className="mb-8">
              <h2 className="text-xl font-semibold text-gray-900 mb-4">4. Code of Conduct</h2>
              <p className="text-gray-700 mb-4">
                All members must abide by our{' '}
                <Link href="/code-of-conduct" className="text-blue-600 hover:text-blue-800 underline">
                  Code of Conduct
                </Link>
                . Violations may result in penalties or membership suspension at the discretion of association administrators.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-xl font-semibold text-gray-900 mb-4">5. Liability and Risk</h2>
              <p className="text-gray-700 mb-4">
                Participation in hockey activities involves inherent risks. By joining the association, members acknowledge and assume these risks.
              </p>
              <ul className="list-disc pl-6 text-gray-700 mb-4">
                <li>Members participate at their own risk and are responsible for their own safety</li>
                <li>Proper equipment and insurance coverage are strongly recommended</li>
                <li>The association is not liable for injuries sustained during activities</li>
                <li>Members should consult with medical professionals regarding fitness to participate</li>
              </ul>
            </section>

            <section className="mb-8">
              <h2 className="text-xl font-semibold text-gray-900 mb-4">6. Privacy</h2>
              <p className="text-gray-700 mb-4">
                Your privacy is important to us. Please review our{' '}
                <Link href="/privacy-policy" className="text-blue-600 hover:text-blue-800 underline">
                  Privacy Policy
                </Link>
                {' '}to understand how we collect, use, and protect your personal information.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-xl font-semibold text-gray-900 mb-4">7. Modifications</h2>
              <p className="text-gray-700 mb-4">
                The association reserves the right to modify these terms at any time. Members will be notified of significant changes and may be required to re-accept updated terms.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-xl font-semibold text-gray-900 mb-4">8. Contact Information</h2>
              <p className="text-gray-700 mb-4">
                If you have questions about these terms, please contact the association administrators through the system or at our official contact information.
              </p>
            </section>
          </div>

          <div className="mt-8 pt-6 border-t border-gray-200">
            <p className="text-sm text-gray-500">
              These terms constitute the entire agreement between you and the hockey association regarding use of this service.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}