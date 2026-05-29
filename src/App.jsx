import { useEffect, useState, useCallback } from 'react';

import './styles/navbar.css';
import './styles/hero.css';
import './styles/survey.css';
import './styles/admin.css';

import Navbar from './components/Navbar.jsx';
import Footer from './components/Footer.jsx';
import SurveyLanding from './pages/SurveyLanding.jsx';
import SurveyHome from './pages/SurveyHome.jsx';
import SurveyCredential from './pages/SurveyCredential.jsx';
import SurveyAdminPage from './pages/SurveyAdminPage.jsx';
import { apiClient } from './api/client.js';
import { STORAGE_KEY } from './data/questions.js';
import { safeStorage } from './utils/safeStorage.js';
import ReCAPTCHA from 'react-google-recaptcha';
import './styles/disclaimer.css';

const roles = [
  { code: 'WH/3PL', label: 'Warehouse Operators / 3PL Providers' },
  { code: 'MFCG', label: 'Manufacturers / FMCG / Retail' },
  { code: 'ECOM', label: 'E-commerce Companies' },
  { code: 'LSP', label: 'Logistics Service Providers' },
  { code: 'GOVT', label: 'Government / Policy Makers / Regulators' },
  { code: 'TECH', label: 'Technology Providers' },
  { code: 'EXPRT', label: 'Industry Experts / Consultants' },
];

const routes = {
  landing: '/',
  credentials: '/survey-credentials',
  main: '/survey-home',
  admin: '/survey-admin',
  roles: '/survey-roles',
  questions: '/survey-questions',
  finished: '/survey-finished',
};

function getCurrentRoute() {
  const path = window.location.pathname;
  return Object.values(routes).includes(path) ? path : routes.landing;
}

function getRoleFromRespondent(respondent) {
  if (!respondent?.role && !respondent?.roleCode) return '';

  return roles.find((item) => item.label === respondent.role || item.code === respondent.roleCode) || {
    label: respondent.role || '',
    code: respondent.roleCode || '',
  };
}

export default function App() {
  const [credentials, setCredentials] = useState(null);
  const [respondentDetails, setRespondentDetails] = useState(null);
  const [showRoleSelection, setShowRoleSelection] = useState(false);
  const [role, setRole] = useState('');
  const [loginError, setLoginError] = useState('');
  const [route, setRoute] = useState(routes.landing);
  const [isLoading, setIsLoading] = useState(false);
  const [captchaToken, setCaptchaToken] = useState(null);
  // true while we're silently checking the stored token on page load
  const [sessionChecking, setSessionChecking] = useState(true);

  const navigate = (nextRoute) => {
    window.history.pushState({}, '', nextRoute);
    setRoute(nextRoute);
  };

  /** Clear all auth state and go back to the login screen. */
  const handleLogout = useCallback(() => {
    apiClient.logout();
    setCredentials(null);
    setRespondentDetails(null);
    setRole('');
    setShowRoleSelection(false);
    setLoginError('');
    navigate(routes.credentials);
  }, []);

  const restoreDraftState = useCallback(async () => {
    const draft = await apiClient.getDraft();
    if (!draft || Object.keys(draft).length === 0) return;

    if (draft.respondent) {
      setRespondentDetails({
        name: draft.respondent.name || '',
        email: draft.respondent.email || '',
        organization: draft.respondent.organization || '',
      });

      const restoredRole = getRoleFromRespondent(draft.respondent);
      if (restoredRole) setRole(restoredRole);
    }

    setShowRoleSelection(true);
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      answers: draft.answers || {},
      confirmed: draft.confirmed || {},
      confirmedSnapshot: draft.confirmedSnapshot || {},
      autofilled: draft.autofilled || {},
      skipped: draft.skipped || {},
      currentSectionIdx: draft.progress?.currentSectionIdx || 0,
      savedAt: draft.updatedAt ? new Date(draft.updatedAt).getTime() : Date.now()
    }));
  }, []);

  useEffect(() => {
    // ── 1. Silently restore session from stored token ─────────────────────────
    apiClient.verifySession().then(async (user) => {
      if (user) {
        // Token is still valid — skip the login screen
        setCredentials({ username: user.username });
        if (!user.isAdmin) {
          try {
            await restoreDraftState();
          } catch (draftError) {
            console.error('Failed to restore draft from session:', draftError);
          }
        }
        const currentPath = window.location.pathname;
        const validPaths = Object.values(routes);
        // If the stored path makes sense, keep it; otherwise go to /survey-home
        if (validPaths.includes(currentPath) && currentPath !== routes.credentials) {
          setRoute(currentPath);
        } else {
          const dest = user.isAdmin ? routes.admin : routes.main;
          window.history.replaceState({}, '', dest);
          setRoute(dest);
        }
      } else {
        // No valid token — make sure we land on a public page
        if (!Object.values(routes).includes(window.location.pathname)) {
          window.history.replaceState({}, '', routes.landing);
          setRoute(routes.landing);
        } else {
          setRoute(window.location.pathname);
        }
      }
      setSessionChecking(false);
    });

    // ── 2. Handle token expiry fired by authenticatedFetch ───────────────────
    const onAuthExpired = () => handleLogout();
    window.addEventListener('auth:expired', onAuthExpired);

    // ── 3. Browser back/forward ───────────────────────────────────────────────
    const handlePopState = () => setRoute(getCurrentRoute());
    window.addEventListener('popstate', handlePopState);

    return () => {
      window.removeEventListener('auth:expired', onAuthExpired);
      window.removeEventListener('popstate', handlePopState);
    };
  }, [handleLogout, restoreDraftState]);

  // Show nothing while we're verifying the token (avoids flash of login screen)
  if (sessionChecking) return null;

  const handleCredentialsSubmit = async (event) => {
    event.preventDefault();
    setIsLoading(true);
    const formData = new FormData(event.currentTarget);
    const username = formData.get('username')?.trim();
    const password = formData.get('password')?.trim();

    if (!captchaToken) {
      setLoginError('Please complete the captcha verification.');
      setIsLoading(false);
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(username)) {
      setLoginError('Please enter a valid email address.');
      setIsLoading(false);
      return;
    }

    try {
      let loginData;
      try {
        loginData = await apiClient.login(username, password);
      } catch (loginError) {
        try {
          const regRes = await fetch('/api/auth/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
          });
          if (regRes.ok) {
            loginData = await apiClient.login(username, password);
          } else {
            throw new Error('Invalid credentials or username already taken.');
          }
        } catch (regError) {
          throw new Error(regError.message || 'Invalid username or password.');
        }
      }

      safeStorage.setItem('authToken', loginData.token);
      safeStorage.removeItem(STORAGE_KEY);
      setLoginError('');
      setCredentials({ username });

      if (loginData.isAdmin) {
        navigate(routes.admin);
        return;
      }

      try {
        await restoreDraftState();
      } catch (draftError) {
        console.error('Failed to load existing draft:', draftError);
      }

      navigate(routes.main);
    } catch (error) {
      setLoginError(error.message || 'Invalid username or password.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleRespondentDetailsSubmit = (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);

    setRespondentDetails({
      name: formData.get('name')?.trim(),
      email: formData.get('email')?.trim(),
      organization: formData.get('organization')?.trim(),
    });
    setShowRoleSelection(true);
  };

  if (route === routes.landing) {
    return <SurveyLanding onGetStarted={() => navigate(routes.credentials)} />;
  }

  if (!credentials || route === routes.credentials) {
    return (
      <main className="gate-screen">
        <form className="gate-card" onSubmit={handleCredentialsSubmit}>
          <p className="gate-eyebrow">India Warehousing Ecosystem Survey 2026</p>
          <h1>Enter your credentials</h1>
          <label>
            Email
            <input name="username" type="email" placeholder="you@example.com" required disabled={isLoading} />
          </label>
            <label>
              Password
              <input name="password" type="password" placeholder="Password" required disabled={isLoading} />
            </label>
            {/* ReCAPTCHA */}
            <ReCAPTCHA
              sitekey={import.meta.env.VITE_RECAPTCHA_SITE_KEY}
              onChange={(value) => setCaptchaToken(value)}
            />
          {loginError && <p className="gate-error">{loginError}</p>}
          <button className="hero-action" type="submit" disabled={isLoading}>
            {isLoading ? 'Logging in...' : 'Continue'}
          </button>
          <p className="survey-disclaimer">No personal identity or individual information will be disclosed at any stage of the study. We assure you that all information provided in this survey will remain anonymous and confidential.</p>
        </form>
      </main>
    );
  }

  if (route === routes.roles) {
    return (
      <>
      <Navbar onLogout={handleLogout} />
        <main className="role-screen">
          <section className="role-card">
            {!showRoleSelection ? (
              <form className="respondent-form" onSubmit={handleRespondentDetailsSubmit}>
                <p className="gate-eyebrow">Before the survey</p>
                <h1>Your details</h1>
                <label>
                  Name (optional)
                  <input name="name" type="text" placeholder="Your full name" defaultValue={respondentDetails?.name || ''} />
                </label>
                <label>
                  Email (optional)
                  <input name="email" type="email" placeholder="you@example.com" defaultValue={respondentDetails?.email || ''} />
                </label>
                <label>
                  Organization / Company name <span style={{color: 'red'}}>*</span>
                  <input name="organization" type="text" placeholder="Company or organization" required defaultValue={respondentDetails?.organization || ''} />
                </label>
                <button className="hero-action" type="submit">Continue to role</button>
              </form>
            ) : (
              <>
                <p className="gate-eyebrow">Before the survey</p>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '10px' }}>
                  <h1 style={{ margin: 0 }}>Select your role</h1>
                  <button 
                    type="button" 
                    onClick={() => setShowRoleSelection(false)}
                    style={{ background: 'none', border: 'none', color: 'var(--primary-color, #2563eb)', cursor: 'pointer', textDecoration: 'underline', fontSize: '0.9rem', padding: 0 }}
                  >
                    Edit Details
                  </button>
                </div>
                <div className="role-grid">
                  {roles.map((item) => (
                    <button
                      key={item.code}
                      type="button"
                      onClick={() => {
                        setRole(item);
                        navigate(routes.questions);
                      }}
                    >
                      <span className="role-code">{item.code}</span>
                      {item.label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </section>
        </main>
        <Footer />
      </>
    );
  }

  if (route === routes.questions || route === routes.finished) {
    let hasDraft = false;
    try {
      const draftData = safeStorage.getItem(STORAGE_KEY);
      if (draftData) {
        const draft = JSON.parse(draftData);
        hasDraft = Object.keys(draft.answers || {}).length > 2;
      }
    } catch (e) {
      console.error('Error checking for draft:', e);
    }
    const screen = route === routes.finished ? 'complete' : (hasDraft ? 'welcome' : 'survey');

    return (
      <SurveyCredential
        initialScreen={screen}
        onFinish={() => navigate(routes.finished)}
        respondent={{ ...credentials, ...respondentDetails, role: role.label, roleCode: role.code }}
      />
    );
  }

  if (route === routes.main) {
    return (
      <>
        <Navbar onLogout={handleLogout} />
        <SurveyHome onStartSurvey={() => navigate(routes.roles)} />
        <Footer />
      </>
    );
  }

  if (route === routes.admin) {
    return (
      <>
        <Navbar onLogout={handleLogout} />
        <SurveyAdminPage />
        <Footer />
      </>
    );
  }

  return (
    <>
      <Navbar onLogout={handleLogout} />
      <SurveyHome onStartSurvey={() => navigate(routes.roles)} />
      <Footer />
    </>
  );
}
