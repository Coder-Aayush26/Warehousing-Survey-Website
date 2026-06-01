import { safeStorage } from '../utils/safeStorage.js';

const API_URL = (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '');

async function parseJSON(response) {
  try {
    const text = await response.text();
    if (!text) return null;
    return JSON.parse(text);
  } catch (error) {
    console.error('JSON parse error:', error);
    return null;
  }
}

async function authenticatedFetch(url, options = {}) {
  const token = safeStorage.getItem('authToken');
  const headers = {
    ...options.headers,
    Authorization: `Bearer ${token}`,
  };

  const res = await fetch(url, { ...options, headers });

  if (res.status === 401) {
    safeStorage.removeItem('authToken');
    window.dispatchEvent(new CustomEvent('auth:expired'));
    throw new Error('Session expired. Please log in again.');
  }

  return res;
}

export const apiClient = {
  async login(username, password) {
    const res = await fetch(`${API_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await parseJSON(res);
    if (!res.ok) throw new Error(data?.error || 'Login failed');
    return data;
  },

  async verifySession() {
    const token = safeStorage.getItem('authToken');
    if (!token) return null;

    try {
      const res = await fetch(`${API_URL}/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        safeStorage.removeItem('authToken');
        return null;
      }
      return await parseJSON(res);
    } catch {
      return null;
    }
  },

  logout() {
    safeStorage.removeItem('authToken');
  },

  async saveSurvey(respondent, answers, confirmed, confirmedSnapshot, skipped, progress) {
    const res = await authenticatedFetch(`${API_URL}/survey/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ respondent, answers, confirmed, confirmedSnapshot, skipped, progress }),
    });
    const data = await parseJSON(res);
    if (!res.ok) throw new Error(data?.error || 'Failed to save survey');
    return data;
  },

  async getDraft() {
    const res = await authenticatedFetch(`${API_URL}/survey/draft`);
    const data = await parseJSON(res);
    if (!res.ok) throw new Error(data?.error || 'Failed to fetch draft');
    return data;
  },

  async submitSurvey(surveyId) {
    const res = await authenticatedFetch(`${API_URL}/survey/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ surveyId }),
    });
    const data = await parseJSON(res);
    if (!res.ok) throw new Error(data?.error || 'Failed to submit survey');
    return data;
  },

  async saveReferrals(referrals) {
    const res = await authenticatedFetch(`${API_URL}/survey/referral`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ referrals }),
    });
    const data = await parseJSON(res);
    if (!res.ok) throw new Error(data?.error || 'Failed to save referrals');
    return data;
  },
};
