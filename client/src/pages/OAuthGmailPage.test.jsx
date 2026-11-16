import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import OAuthGmailPage from './OAuthGmailPage';
jest.mock('../context/AuthContext', () => ({ useAuth: () => ({ loading: false, user: mockUser }) }));
const mockUser = { id: 'PUBLIC_QA_USER' };
jest.mock('../supabaseClient', () => ({ supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 'PUBLIC_SYNTHETIC_JWT' } } }) } }, FUNCTIONS_URL: 'http://127.0.0.1:18200/functions/v1', SUPABASE_ANON_KEY: 'PUBLIC_ANON' }));
beforeEach(() => { window.history.replaceState(null, '', '/'); global.fetch = jest.fn(); });
test('start is issued once with cookie credentials even under StrictMode', async () => {
  fetch.mockResolvedValue({ ok: true, json: async () => ({ authorization_url: 'https://accounts.google.com/o/oauth2/v2/auth?state=PUBLIC_QA' }) });
  render(<React.StrictMode><MemoryRouter initialEntries={['/oauth-gmail']}><OAuthGmailPage /></MemoryRouter></React.StrictMode>);
  await screen.findByRole('link', { name: 'Продолжить в Google' });
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls[0][1].credentials).toBe('include');
  expect(fetch.mock.calls[0][0]).toMatch(/oauth_google_start$/);
});
test('callback strips code/state from browser URL and posts once with the current session', async () => {
  window.history.replaceState(null, '', '/oauth-gmail/complete#code=PUBLIC_QA_CODE&state=PUBLIC_QA_STATE');
  fetch.mockResolvedValue({ ok: true, json: async () => ({ ok: true, connected: true }) });
  render(<MemoryRouter initialEntries={['/oauth-gmail/complete']}><OAuthGmailPage /></MemoryRouter>);
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  expect(window.location.hash).toBe('');
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ code: 'PUBLIC_QA_CODE', state: 'PUBLIC_QA_STATE' });
  expect(fetch.mock.calls[0][1].credentials).toBe('include');
  await screen.findByText('Gmail безопасно подключён к вашей организации.');
});
test('missing callback code/state never invokes the provider or API', async () => {
  render(<MemoryRouter initialEntries={['/oauth-gmail/complete']}><OAuthGmailPage /></MemoryRouter>);
  await screen.findByText('Нет кода или state. Начните подключение заново.');
  expect(fetch).not.toHaveBeenCalled();
});
test('authorization URL cannot redirect to another origin', async () => {
  fetch.mockResolvedValue({ ok: true, json: async () => ({ authorization_url: 'https://evil.invalid/' }) });
  render(<MemoryRouter initialEntries={['/oauth-gmail']}><OAuthGmailPage /></MemoryRouter>);
  await screen.findByText('Недопустимый адрес авторизации.');
  expect(screen.queryByRole('link', { name: 'Продолжить в Google' })).toBeNull();
});
