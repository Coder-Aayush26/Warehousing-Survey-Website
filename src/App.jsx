import { useEffect, useRef, useState } from 'react';

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

export default function App() {
  const [credentials, setCredentials] = useState(null);
  const [respondentDetails, setRespondentDetails] = useState(null);
  const [showRoleSelection, setShowRoleSelection] = useState(false);
  const [role, setRole] = useState('');
  const [loginError, setLoginError] = useState('');
  const [route, setRoute] = useState(getCurrentRoute());
  const [isLoading, setIsLoading] = useState(false);
  const [captchaToken, setCaptchaToken] = useState(null);
  const captchaRef = useRef(null);
  const recaptchaSiteKey = import.meta.env.VITE_RECAPTCHA_SITE_KEY;

  const navigate = (nextRoute) => {
    window.history.pushState({}, '', nextRoute);
    setRoute(nextRoute);
  };

  useEffect(() => {
    // Always ensure the URL matches a valid route, default to landing
    if (!Object.values(routes).includes(window.location.pathname)) {
      window.history.replaceState({}, '', routes.landing);
      setRoute(routes.landing);
    } else {
      setRoute(window.location.pathname);
    }

    const handlePopState = () => {
      const currentPath = getCurrentRoute();
      setRoute(currentPath);
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const handleCredentialsSubmit = async (event) => {
    event.preventDefault();
    setLoginError('');
    setIsLoading(true);
    const formData = new FormData(event.currentTarget);
    const username = formData.get('username')?.trim();
    const password = formData.get('password')?.trim();

    // Validate captcha token before proceeding
    if (!captchaToken) {
      setLoginError('Please complete the captcha verification.');
      setIsLoading(false);
      return;
    }
    if (username !== 'admin@gmail.com' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(username)) {
      setLoginError('Please enter a valid email address.');
      setIsLoading(false);
      return;
    }

    try {
      if (username === 'admin@gmail.com') {
        if (password !== 'survey2026') {
          throw new Error('Invalid admin password.');
        }
        const { token } = await apiClient.login(username, password, captchaToken);
        safeStorage.setItem('authToken', token);
        setLoginError('');
        setCredentials({ username });
        navigate(routes.admin);
      } else {
        const { token } = await apiClient.loginOrRegister(username, password, captchaToken);

        safeStorage.setItem('authToken', token);
        setLoginError('');
        setCredentials({ username });

        // Fetch existing draft from the database to restore state
        try {
          const draft = await apiClient.getDraft();
          if (draft && Object.keys(draft).length > 0) {
            if (draft.respondent) {
              setRespondentDetails({
                name: draft.respondent.name || '',
                email: draft.respondent.email || '',
                organization: draft.respondent.organization || '',
              });
              if (draft.respondent.role) {
                const matchingRole = roles.find(r => r.label === draft.respondent.role || r.code === draft.respondent.roleCode);
                setRole(matchingRole || {
                  label: draft.respondent.role,
                  code: draft.respondent.roleCode || ''
                });
              }
            }
            setShowRoleSelection(true);
            // Populate browser storage so that when the Survey app starts, it resumes the draft.
            safeStorage.setItem(STORAGE_KEY, JSON.stringify({
              answers: draft.answers || {},
              confirmed: draft.confirmed || {},
              confirmedSnapshot: draft.confirmedSnapshot || {},
              autofilled: draft.autofilled || {},
              skipped: draft.skipped || {},
              currentSectionIdx: draft.progress?.currentSectionIdx || 0,
              savedAt: draft.updatedAt ? new Date(draft.updatedAt).getTime() : Date.now()
            }));
          }
        } catch (draftError) {
          console.error('Failed to load existing draft:', draftError);
        }

            // After successful credential/login, show the survey start page
            navigate(routes.main);
      }
    } catch (error) {
      setLoginError(error.message || 'Invalid username or password.');
      setCaptchaToken(null);
      captchaRef.current?.reset();
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
            {recaptchaSiteKey ? (
              <ReCAPTCHA
                ref={captchaRef}
                sitekey={recaptchaSiteKey}
                onChange={(value) => setCaptchaToken(value)}
                onExpired={() => setCaptchaToken(null)}
                onErrored={() => {
                  setCaptchaToken(null);
                  setLoginError('Captcha could not load. Please refresh and try again.');
                }}
              />
            ) : (
              <p className="gate-error">Captcha is not configured. Add VITE_RECAPTCHA_SITE_KEY to .env.</p>
            )}
          {loginError && <p className="gate-error">{loginError}</p>}
          <button className="hero-action" type="submit" disabled={isLoading || !recaptchaSiteKey}>
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
        <Navbar />
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
        <Navbar />
        <SurveyHome onStartSurvey={() => navigate(routes.roles)} />
        <Footer />
      </>
    );
  }

  if (route === routes.admin) {
    return (
      <>
        <Navbar />
        <SurveyAdminPage />
        <Footer />
      </>
    );
  }

  return (
    <>
      <Navbar />
      <SurveyHome onStartSurvey={() => navigate(routes.roles)} />
      <Footer />
    </>
  );
}
