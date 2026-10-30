// DDC-CWICR-OE: DataDrivenConstruction · OpenBusinessERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
import { useState, useRef, useEffect, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, Link } from 'react-router-dom';
import {
  Eye, EyeOff, Mail, Lock, User, Globe, ChevronDown,
  Check, Building2, Briefcase, Search,
} from 'lucide-react';
import { Button, Input, Logo, CountryFlag } from '@/shared/ui';
import { SUPPORTED_LANGUAGES, getLanguageByCode } from '@/app/i18n';
import { readRememberChoice, useAuthStore } from '@/stores/useAuthStore';
import { meetsPasswordPolicy } from './passwordPolicy';

export function RegisterPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const setTokens = useAuthStore((s) => s.setTokens);
  const currentLang = getLanguageByCode(i18n.language);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [company, setCompany] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [howFoundUs, setHowFoundUs] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [langOpen, setLangOpen] = useState(false);
  const langRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (langRef.current && !langRef.current.contains(e.target as Node)) setLangOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const passwordsMatch = password === confirmPassword;
  // The server's rules (length, a letter in any script, a digit), shared with
  // the reset page so the two forms cannot drift from each other.
  const passwordStrong = meetsPasswordPolicy(password);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');

    if (!passwordsMatch) {
      setError(t('auth.passwords_no_match', { defaultValue: 'Passwords do not match' }));
      return;
    }
    if (passwordStrong === false) {
      setError(
        t('auth.password_requirements', {
          defaultValue:
            'Password must be at least 8 characters with at least one letter and one digit',
        }),
      );
      return;
    }

    setLoading(true);

    try {
      const regRes = await fetch('/api/v1/users/auth/register/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          password,
          full_name: fullName,
          company,
          job_title: jobTitle,
          how_found_us: howFoundUs,
        }),
      });

      if (!regRes.ok) {
        // FastAPI returns either a plain string detail or a list of
        // validation-error objects; flatten the list into one message,
        // otherwise fall back to the generic failure text.
        const body = await regRes.json().catch(() => null);
        const detail = body?.detail;
        const fallback = t('auth.registration_failed', 'Registration failed');
        const message = Array.isArray(detail)
          ? detail.map((item: { msg?: string }) => item.msg).join('; ')
          : detail || fallback;
        setError(message);
        return;
      }

      // The registration endpoint returns the user record. In gated modes
      // (admin-approve / email-verify) the new account comes back with
      // is_active=false and the immediate login attempt 401s with the
      // same generic "Invalid email or password" used for bad creds, so
      // without this branch users get a confusing dead-end. Surface a
      // clear pending-activation message instead.
      const regBody = await regRes.json().catch(() => null);
      if (regBody && regBody.is_active === false) {
        setError(
          t(
            'auth.registration_pending_activation',
            'Account created. An administrator needs to activate it before you can log in. ' +
              'For local installs, set OE_REGISTRATION_MODE=open in your .env to skip this step.',
          ),
        );
        return;
      }

      const loginRes = await fetch('/api/v1/users/auth/login/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      if (loginRes.ok) {
        const data = await loginRes.json();
        setTokens(data.access_token, data.refresh_token, readRememberChoice(), email);
        navigate('/');
      } else {
        navigate('/login');
      }
    } catch {
      setError(t('auth.connection_error', 'Unable to connect to server'));
    } finally {
      setLoading(false);
    }
  };

  const points = [
    t('login.biz_point_1', 'Double-entry accounting'),
    t('login.biz_point_2', 'Quotes, orders and invoices'),
    t('login.biz_point_3', 'Purchasing and stock'),
    t('login.biz_point_4', 'Projects, time and people'),
  ];

  return (
    <div className="relative flex h-screen bg-surface-secondary overflow-hidden">
      {/* Language — top right */}
      <div className="absolute top-3 end-3 z-30" ref={langRef}>
        <button
          onClick={() => setLangOpen(!langOpen)}
          className="flex items-center gap-1.5 rounded-lg border border-border-light bg-surface-elevated px-2.5 py-1 text-xs text-content-secondary hover:bg-surface-elevated transition-colors shadow-sm"
        >
          <Globe size={12} className="text-content-tertiary" />
          <CountryFlag code={currentLang.country} size={14} />
          <span className="hidden sm:inline">{currentLang.name}</span>
          <ChevronDown size={11} className={`text-content-tertiary transition-transform ${langOpen ? 'rotate-180' : ''}`} />
        </button>
        {langOpen && (
          <div className="absolute end-0 mt-1 w-44 max-h-72 overflow-y-auto rounded-xl border border-border-light bg-surface-elevated shadow-xl py-0.5">
            {SUPPORTED_LANGUAGES.map((lang) => {
              const isActive = i18n.language === lang.code;
              return (
                <button
                  key={lang.code}
                  onClick={() => { i18n.changeLanguage(lang.code); setLangOpen(false); }}
                  className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-xs transition-colors ${isActive ? 'bg-oe-blue/10 text-oe-blue font-medium' : 'text-content-primary hover:bg-surface-secondary'}`}
                >
                  <CountryFlag code={lang.country} size={14} />
                  <span className="truncate">{lang.name}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Right on lg+: what the product is ── */}
      <aside className="hidden lg:flex relative z-10 order-2 w-1/2 flex-col justify-center border-s border-border-light bg-surface-secondary px-14 xl:px-20 py-10">
        <p className="text-xs font-semibold uppercase tracking-[0.08em] text-content-tertiary">
          {t('login.biz_eyebrow', { defaultValue: 'Open-source ERP' })}
        </p>
        <h2 className="mt-3 max-w-[460px] text-[30px] font-semibold leading-[1.15] tracking-[-0.02em] text-content-primary">
          {t('auth.biz_register_headline', { defaultValue: 'Set up your company workspace in a minute.' })}
        </h2>
        <p className="mt-4 max-w-[440px] text-[15px] leading-relaxed text-content-secondary">
          {t('login.biz_desc', { defaultValue: 'Built for companies of 1 to 1,000 people. Self-hosted or in the cloud, in your language and currency.' })}
        </p>
        <ul className="mt-8 grid max-w-[460px] grid-cols-2 gap-x-8 gap-y-3 text-sm text-content-secondary">
          {points.map((point) => (
            <li key={point} className="flex items-center gap-2">
              <Check size={14} className="shrink-0 text-oe-blue" />
              {point}
            </li>
          ))}
        </ul>
        <p className="mt-12 text-xs text-content-tertiary">
          {t('login.biz_footer', { defaultValue: 'AGPL-3.0 · Your data stays on your server' })}
        </p>
      </aside>

      {/* ── Right: logo + form ── */}
      <div className="flex flex-1 order-1 items-center justify-center p-4 sm:p-6 relative z-10">
        <div className="w-full max-w-[400px]">
          {/* Logo */}
          <div className="mb-5 flex flex-col items-center">
              <div className="flex items-center gap-2.5">
              <Logo size="md" />
              <span className="text-2xl font-medium text-content-primary whitespace-nowrap" style={{ fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif", letterSpacing: '-0.02em' }}>
                Open<span className="font-semibold">Business</span><span className="text-content-quaternary">ERP</span>
              </span>
            </div>
            <p className="mt-1 text-xs text-content-tertiary">{t('login.workspace_tagline_biz', { defaultValue: 'Business management workspace' })}</p>
          </div>

          {/* Form */}
          <div className="rounded-lg border border-border-light bg-surface-elevated px-6 py-5 shadow-sm">
            {/* Visually hidden h1 for screen readers + a11y tools — visible text uses h2 below */}
            <h1 className="sr-only">{t('auth.create_account', 'Create account')}</h1>
            <div>
              <h2 className="text-base font-semibold text-content-primary mb-0.5">
                {t('auth.create_account', 'Create account')}
              </h2>
              <p className="text-xs text-content-secondary mb-4">
                {t('auth.biz_register_subtitle', { defaultValue: 'Create your OpenBusinessERP account' })}
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-3" aria-label={t('auth.register', 'Create account')}>
              <div>
                <Input
                  id="register-full-name"
                  name="full_name"
                  label={t('auth.full_name', 'Full Name')}
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder={t('auth.full_name_placeholder', 'John Smith')}
                  required aria-required="true"
                  autoFocus
                  autoComplete="name"
                  icon={<User size={15} />}
                />
              </div>

              <div>
                <Input
                  id="register-email"
                  name="email"
                  label={t('auth.biz_work_email', { defaultValue: 'Work email' })}
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                  autoComplete="email"
                  required aria-required="true"
                  icon={<Mail size={15} />}
                />
              </div>

              <div>
                <Input
                  id="register-company"
                  name="company"
                  label={t('auth.biz_company', { defaultValue: 'Company' })}
                  type="text"
                  value={company}
                  onChange={(e) => setCompany(e.target.value)}
                  placeholder={t('auth.biz_company_placeholder', { defaultValue: 'Your company name' })}
                  autoComplete="organization"
                  icon={<Building2 size={15} />}
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <Input
                  id="register-job-title"
                  name="job_title"
                  label={t('auth.biz_job_title', { defaultValue: 'Job title' })}
                  type="text"
                  value={jobTitle}
                  onChange={(e) => setJobTitle(e.target.value)}
                  placeholder={t('auth.biz_job_title_placeholder', { defaultValue: 'e.g. Finance manager' })}
                  autoComplete="organization-title"
                  icon={<Briefcase size={15} />}
                />
                <div>
                  <label htmlFor="register-how-found" className="text-sm font-medium text-content-primary block mb-1">
                    {t('auth.how_found_us', 'How did you find us?')}
                  </label>
                  <div className="relative">
                    <div className="pointer-events-none absolute inset-y-0 start-0 flex items-center ps-3 text-content-tertiary">
                      <Search size={15} />
                    </div>
                    <select
                      id="register-how-found"
                      name="how_found_us"
                      value={howFoundUs}
                      onChange={(e) => setHowFoundUs(e.target.value)}
                      className="h-9 w-full rounded-lg border border-border bg-surface-primary ps-9 pe-3 text-sm text-content-primary transition-all duration-fast ease-oe focus:outline-none focus:ring-2 focus:ring-oe-blue focus:border-transparent hover:border-content-tertiary appearance-none cursor-pointer"
                    >
                      <option value="">{t('auth.how_found_select', '- Select -')}</option>
                      <option value="google">{t('auth.how_found_google', 'Google Search')}</option>
                      <option value="github">{t('auth.how_found_github', 'GitHub')}</option>
                      <option value="linkedin">{t('auth.how_found_linkedin', 'LinkedIn')}</option>
                      <option value="reddit">{t('auth.how_found_reddit', 'Reddit')}</option>
                      <option value="youtube">{t('auth.how_found_youtube', 'YouTube')}</option>
                      <option value="recommendation">{t('auth.how_found_recommendation', 'Recommendation')}</option>
                      <option value="conference">{t('auth.how_found_conference', 'Conference / Event')}</option>
                      <option value="other">{t('auth.how_found_other', 'Other')}</option>
                    </select>
                  </div>
                </div>
              </div>

              <div className="flex flex-col gap-1">
                <label htmlFor="register-password" className="text-sm font-medium text-content-primary">
                  {t('auth.password', 'Password')}
                </label>
                <div className="relative">
                  <div className="pointer-events-none absolute inset-y-0 start-0 flex items-center ps-3 text-content-tertiary">
                    <Lock size={15} />
                  </div>
                  <input
                    id="register-password"
                    name="password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={t('auth.password_min', 'Minimum 8 characters')}
                    autoComplete="new-password"
                    required aria-required="true"
                    minLength={8}
                    className="h-9 w-full rounded-lg border border-border bg-surface-primary pl-9 pr-9 text-sm text-content-primary placeholder:text-content-tertiary transition-all duration-fast ease-oe focus:outline-none focus:ring-2 focus:ring-oe-blue focus:border-transparent hover:border-content-tertiary"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    aria-label={showPassword ? t('auth.hide_password', 'Hide password') : t('auth.show_password', 'Show password')}
                    className="absolute inset-y-0 end-0 flex items-center pe-3 text-content-tertiary hover:text-content-secondary transition-colors"
                    tabIndex={-1}
                  >
                    {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
                {password && (
                  <div className="flex items-center gap-2 mt-0.5">
                    <div className={`h-1 flex-1 rounded-full transition-colors duration-normal ${password.length >= 8 ? 'bg-semantic-success' : 'bg-border'}`} />
                    <div className={`h-1 flex-1 rounded-full transition-colors duration-normal ${password.length >= 12 ? 'bg-semantic-success' : 'bg-border'}`} />
                    <div className={`h-1 flex-1 rounded-full transition-colors duration-normal ${/[A-Z]/.test(password) && /[0-9]/.test(password) ? 'bg-semantic-success' : 'bg-border'}`} />
                    <span className="text-2xs text-content-tertiary ml-1">
                      {password.length < 8 ? t('auth.password_strength_weak', 'Weak') : password.length < 12 ? t('auth.password_strength_medium', 'Medium') : t('auth.password_strength_strong', 'Strong')}
                    </span>
                  </div>
                )}
              </div>

              <div>
                <Input
                  id="register-confirm-password"
                  name="confirm_password"
                  label={t('auth.confirm_password', 'Confirm Password')}
                  type={showPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder={t('auth.confirm_password_placeholder', 'Repeat your password')}
                  autoComplete="new-password"
                  required aria-required="true"
                  error={confirmPassword && !passwordsMatch ? t('auth.passwords_mismatch', 'Passwords do not match') : undefined}
                  icon={<Lock size={15} />}
                />
              </div>

              {error && (
                <div className="flex items-start gap-2 rounded-lg bg-semantic-error-bg px-3 py-2 text-xs text-semantic-error">
                  <span className="shrink-0 mt-0.5">!</span>
                  <span>{error}</span>
                </div>
              )}

              <div>
                <label className="flex items-start gap-2 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={privacyAccepted}
                    onChange={(e) => setPrivacyAccepted(e.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded border-border text-oe-blue focus:ring-oe-blue cursor-pointer shrink-0"
                  />
                  <span className="text-[11px] text-content-secondary leading-snug">
                    {t('auth.privacy_consent', 'I agree to the')}{' '}
                    <a
                      href="/privacy-policy.html"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-oe-blue hover:underline font-medium"
                    >
                      {t('auth.privacy_policy', 'Privacy Policy')}
                    </a>
                    {' '}{t('auth.and', 'and')}{' '}
                    <a
                      href="/terms.html"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-oe-blue hover:underline font-medium"
                    >
                      {t('auth.terms_of_service', 'Terms of Service')}
                    </a>
                    {'. '}
                    {t('auth.privacy_consent_detail', 'Your data is processed in accordance with GDPR. We collect your name, email, company info, and usage data to provide the service. You can delete your account at any time.')}
                  </span>
                </label>
              </div>

              <div>
                <Button
                  type="submit"
                  variant="primary"
                  size="lg"
                  loading={loading}
                  disabled={
                    !(
                      fullName &&
                      email &&
                      password &&
                      confirmPassword &&
                      passwordsMatch &&
                      passwordStrong &&
                      privacyAccepted
                    )
                  }
                  className="w-full"
                >
                  {t('auth.create_account', 'Create account')}
                </Button>
              </div>
            </form>

            <div className="mt-4 border-t border-border-light pt-3.5">
              <p className="text-center text-xs text-content-secondary">
                {t('auth.has_account', 'Already have an account?')}{' '}
                <Link to="/login" className="font-medium text-oe-blue hover:text-oe-blue-hover transition-colors">
                  {t('auth.login', 'Sign in')}
                </Link>
              </p>
              <button
                type="button"
                onClick={() => navigate('/login')}
                className="mt-2 block w-full text-center text-2xs text-oe-blue hover:text-oe-blue-hover hover:underline font-medium cursor-pointer transition-colors"
              >
                {t('auth.try_demo', 'Try demo account →')}
              </button>
            </div>
          </div>

          {/* Mobile footer */}
          <div className="lg:hidden mt-3 text-center text-2xs text-content-quaternary">
            <div className="flex items-center justify-center gap-3">
              <a href="https://github.com/datadrivenconstruction/OpenBusinessERP" target="_blank" rel="noopener noreferrer" className="hover:text-content-secondary transition-colors">GitHub</a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
