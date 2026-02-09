import { Link } from 'react-router-dom';

export function TermsPage() {
  return (
    <div className="min-h-screen bg-[#F5F0EB]">
      <div className="max-w-2xl mx-auto px-4 py-8">
        <Link to="/" className="text-sm text-gray-500 hover:text-gray-700 mb-4 inline-block">&larr; Back</Link>

        <h1 className="text-2xl font-bold text-[#373536] mb-6">Terms and Conditions</h1>

        <div className="bg-white rounded-lg p-6 border border-gray-200 text-sm text-gray-600">
          <p>Terms and conditions content coming soon.</p>
        </div>
      </div>
    </div>
  );
}
