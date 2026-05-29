import { useState, useEffect } from 'react';
import { apiClient } from '../api/client.js';
import { generateDetailedExcel } from '../utils/excelExport.js';
import Navbar from '../components/Navbar.jsx';
import Footer from '../components/Footer.jsx';
import { safeStorage } from '../utils/safeStorage.js';
import '../data/questions.js';
import '../styles/admin.css';
import SurveyDashboardPage from '../pages/SurveyDashboardPage.jsx';

export default function SurveyAdminPage() {
  const [view, setView] = useState(window.location.hash.includes('dashboard') ? 'dashboard' : 'summary');
  const [surveys, setSurveys] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Listen to hash changes
  useEffect(() => {
    const handleHash = () => {
      if (window.location.hash.includes('dashboard')) setView('dashboard');
      else setView('summary');
    };
    window.addEventListener('hashchange', handleHash);
    return () => window.removeEventListener('hashchange', handleHash);
  }, []);

  useEffect(() => {
    fetchSurveys();
  }, []);

  const fetchSurveys = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/survey/all', {
        headers: {
          'Authorization': `Bearer ${safeStorage.getItem('authToken') || ''}`
        }
      });
      if (!response.ok) throw new Error('Failed to fetch surveys');
      const data = await response.json();
      setSurveys(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err.message);
      setSurveys([]);
    } finally {
      setLoading(false);
    }
  };

  const downloadExcel = () => {
    try {
      const questions = window.SURVEY_DATA?.QUESTIONS || {};
      generateDetailedExcel(surveys, questions);
    } catch (err) {
      alert('Failed to download: ' + err.message);
    }
  };

  // Analytics
  const totalResponses = surveys.length;
  const completedResponses = surveys.filter(s => s.status === 'submitted').length;
  const draftResponses = surveys.filter(s => s.status === 'draft').length;
  const avgProgress = surveys.length > 0
    ? Math.round(surveys.reduce((sum, s) => sum + (s.progress?.totalAnswered || 0), 0) / surveys.length)
    : 0;

  const roleStats = {};
  surveys.forEach(s => {
    const role = s.respondent?.role || 'Unknown';
    roleStats[role] = (roleStats[role] || 0) + 1;
  });

  if (view === 'dashboard') {
    return (
      <>
        <Navbar />
        <SurveyDashboardPage />
        <Footer />
      </>
    );
  }

  return (
    <main className="bg-gray-50 min-h-screen p-6">
      <section className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-800">Admin Dashboard</h1>
        <p className="text-gray-600">Survey Analytics & Response Management</p>
      </section>

      {error && <div className="mb-4 text-sm text-red-600">{error}</div>}

        {/* Analytics Cards */}
        <section className="analytics-cards mb-6">
            <div className="analytics-value text-2xl font-semibold text-purple-600">{avgProgress}%</div>
            <div className="analytics-label text-gray-500">Avg Progress</div>
        </section>

      {/* Role Distribution */}
      <section className="admin-section mb-6">
        <h2 className="text-xl font-semibold mb-2">Responses by Role</h2>
        {Object.keys(roleStats).length > 0 ? (
          <ul className="role-list space-y-1">
            {Object.entries(roleStats).map(([role, count]) => (
              <li key={role} className="flex justify-between bg-white shadow rounded p-2">
                <span className="text-gray-700">{role}</span>
                <span className="role-count font-medium text-indigo-600">{count}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-gray-500">No responses yet</p>
        )}
      </section>

      {/* Recent Responses Table */}
      <section className="admin-section mb-6">
        <h2 className="text-xl font-semibold mb-2">Recent Responses</h2>
        {loading ? (
          <p className="text-gray-500">Loading responses...</p>
        ) : surveys.length > 0 ? (
          <div className="responses-table overflow-x-auto bg-white shadow rounded">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Name</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Email</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Organization</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Role</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Progress</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Submitted</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {surveys.slice(0, 10).map((survey, idx) => (
                  <tr key={idx} className="hover:bg-gray-50">
                    <td className="px-4 py-2 text-sm text-gray-700">{survey.respondent?.name || 'N/A'}</td>
                    <td className="px-4 py-2 text-sm text-gray-700">{survey.respondent?.email || 'N/A'}</td>
                    <td className="px-4 py-2 text-sm text-gray-700">{survey.respondent?.organization || 'N/A'}</td>
                    <td className="px-4 py-2 text-sm text-gray-700">{survey.respondent?.role || 'N/A'}</td>
                    <td className="px-4 py-2 text-sm text-gray-700">{survey.progress?.totalAnswered || 0}%</td>
                    <td className="px-4 py-2 text-sm">
                      <span className={`status-badge status-${survey.status} px-2 py-1 rounded ${survey.status === 'submitted' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'}`}>
                        {survey.status || 'draft'}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-sm text-gray-700">
                      {survey.submittedAt ? new Date(survey.submittedAt).toLocaleDateString() : 'N/A'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-gray-500">No responses yet</p>
        )}
      </section>

      {/* Download Button */}
      <section className="admin-section">
        <button className="admin-btn-download bg-indigo-600 hover:bg-indigo-700 text-white font-medium py-2 px-4 rounded" onClick={downloadExcel}>
          ⬇ Download All Responses (Excel - Detailed)
        </button>
      </section>
    </main>
  );
}
