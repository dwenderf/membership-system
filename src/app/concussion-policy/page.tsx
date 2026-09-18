import Link from 'next/link'

export default function ConcussionPolicyPage() {
  return (
    <div className="min-h-screen bg-gray-50 py-12">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="bg-white shadow-sm rounded-lg p-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-8">Concussion Information and Agreement</h1>

          <div className="prose prose-gray max-w-none">
            <section className="mb-8">
              <h2 className="text-xl font-semibold text-gray-900 mb-4">What is a Concussion?</h2>
              <p className="text-gray-700 mb-4">
                A concussion is a type of traumatic brain injury—or TBI—caused by a bump, blow, or jolt to the head or by a hit to the body that causes the head and brain to move quickly back and forth. This fast movement can cause the brain to bounce around or twist in the skull, creating chemical changes in the brain and sometimes stretching and damaging the brain cells.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-xl font-semibold text-gray-900 mb-4">What are the signs and symptoms of a Concussion?</h2>
              <p className="text-gray-700 mb-4">
                Most people with a concussion recover well from symptoms experienced at the time of the injury. But for some people, symptoms can last for days, weeks, or longer. In general, recovery may be slower among older adults, young children, and teens. Those who have had a concussion in the past are also at risk of having another one. Some people may also find that it takes longer to recover if they have another concussion.
              </p>

              <h3 className="text-lg font-medium text-gray-900 mb-3">Symptoms of concussion usually fall into four categories</h3>
              <div className="overflow-x-auto mb-4">
                <table className="min-w-full border border-gray-200 text-sm text-gray-700">
                  <thead>
                    <tr className="bg-gray-50">
                      <th className="border border-gray-200 px-3 py-2 text-left font-semibold text-gray-900">Thinking/Remembering</th>
                      <th className="border border-gray-200 px-3 py-2 text-left font-semibold text-gray-900">Physical</th>
                      <th className="border border-gray-200 px-3 py-2 text-left font-semibold text-gray-900">Emotional/Mood</th>
                      <th className="border border-gray-200 px-3 py-2 text-left font-semibold text-gray-900">Sleep</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className="border border-gray-200 px-3 py-2 align-top">Difficulty thinking clearly</td>
                      <td className="border border-gray-200 px-3 py-2 align-top">Headache; fuzzy or blurry vision</td>
                      <td className="border border-gray-200 px-3 py-2 align-top">Irritability</td>
                      <td className="border border-gray-200 px-3 py-2 align-top">Sleeping more than usual</td>
                    </tr>
                    <tr>
                      <td className="border border-gray-200 px-3 py-2 align-top">Feeling slowed down</td>
                      <td className="border border-gray-200 px-3 py-2 align-top">Nausea or vomiting (early on); dizziness</td>
                      <td className="border border-gray-200 px-3 py-2 align-top">Sadness</td>
                      <td className="border border-gray-200 px-3 py-2 align-top">Sleeping less than usual</td>
                    </tr>
                    <tr>
                      <td className="border border-gray-200 px-3 py-2 align-top">Difficulty concentrating</td>
                      <td className="border border-gray-200 px-3 py-2 align-top">Sensitivity to noise or light; balance problems</td>
                      <td className="border border-gray-200 px-3 py-2 align-top">More emotional</td>
                      <td className="border border-gray-200 px-3 py-2 align-top">Trouble falling asleep</td>
                    </tr>
                    <tr>
                      <td className="border border-gray-200 px-3 py-2 align-top">Difficulty remembering new information</td>
                      <td className="border border-gray-200 px-3 py-2 align-top">Feeling tired, having no energy</td>
                      <td className="border border-gray-200 px-3 py-2 align-top">Nervousness or anxiety</td>
                      <td className="border border-gray-200 px-3 py-2 align-top"></td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <p className="text-gray-700 mb-4">
                Some of these symptoms may appear right away. Others may not be noticed for days or months after the injury, or until the person resumes their everyday life. Sometimes, people do not recognize or admit that they are having problems. Others may not understand their problems and how the symptoms they are experiencing impact their daily activities.
              </p>
              <p className="text-gray-700 mb-4">
                The signs and symptoms of a concussion can be difficult to sort out. Early on, problems may be overlooked by the person with the concussion, family members, or doctors. People may look fine even though they are acting or feeling differently.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-xl font-semibold text-gray-900 mb-4">When should I seek medical attention?</h2>
              <h3 className="text-lg font-medium text-gray-900 mb-3">Danger Signs in Adults</h3>
              <p className="text-gray-700 mb-4">
                In rare cases, a person with a concussion may form a dangerous blood clot that crowds the brain against the skull. Contact your health care professional or emergency department right away if you experience these danger signs after a bump, blow, or jolt to your head or body:
              </p>
              <ul className="list-disc pl-6 text-gray-700 mb-4">
                <li>Headache that gets worse and does not go away.</li>
                <li>Weakness, numbness or decreased coordination.</li>
                <li>Repeated vomiting or nausea.</li>
                <li>Slurred speech.</li>
              </ul>
              <p className="text-gray-700 mb-4">
                The people checking on you should take you to an emergency department right away if you:
              </p>
              <ul className="list-disc pl-6 text-gray-700 mb-4">
                <li>Look very drowsy or cannot wake up.</li>
                <li>Have one pupil (the black part in the middle of the eye) larger than the other.</li>
                <li>Have convulsions or seizures.</li>
                <li>Cannot recognize people or places.</li>
                <li>Are getting more and more confused, restless, or agitated.</li>
                <li>Have unusual behavior.</li>
                <li>Lose consciousness.</li>
              </ul>
            </section>

            <section className="mb-8">
              <h2 className="text-xl font-semibold text-gray-900 mb-4">When can I start playing again?</h2>
              <p className="text-gray-700 mb-4">
                If you report having a concussion to the NYCPHA, then you will not be allowed to play until we receive a note from your doctor clearing you to play again. This is for your safety and is a requirement from our insurance provider.
              </p>
              <p className="text-sm text-gray-500">
                Source: <Link href="https://www.cdc.gov/traumaticbraininjury/" target="_blank" className="text-blue-600 hover:text-blue-800 underline">Centers for Disease Control</Link>
              </p>
            </section>
          </div>

          <div className="mt-8 pt-6 border-t border-gray-200">
            <p className="text-sm text-gray-500">
              By participating in association activities, all members acknowledge that they have read and understood this Concussion Policy.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
