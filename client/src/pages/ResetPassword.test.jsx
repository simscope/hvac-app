import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import ResetPassword from './ResetPassword';

const mockGetSession = jest.fn();
const mockUpdateUser = jest.fn();
const mockOnAuth = jest.fn();
const mockUnsubscribe = jest.fn();
let mockAuthListener;
jest.mock('../supabaseClient', () => ({ supabase: { auth: {
  getSession: (...args) => mockGetSession(...args),
  updateUser: (...args) => mockUpdateUser(...args),
  onAuthStateChange: (...args) => mockOnAuth(...args),
} } }));
const session = { user: { id: 'PUBLIC_QA_USER' }, access_token: 'PUBLIC_SYNTHETIC_JWT' };
const ready = () => waitFor(() => expect(screen.getByRole('button')).toBeEnabled());
beforeEach(() => {
  window.history.replaceState(null, '', '/reset-password');
  mockGetSession.mockResolvedValue({ data: { session }, error: null });
  mockUpdateUser.mockResolvedValue({ data: {}, error: null });
  mockOnAuth.mockImplementation((listener) => { mockAuthListener = listener; return { data: { subscription: { unsubscribe: mockUnsubscribe } } }; });
});

test('waits for SDK recovery bootstrap, including when implicit tokens are removed from the URL', async () => {
  let resolve;
  mockGetSession.mockReturnValue(new Promise((done) => { resolve = done; }));
  window.history.replaceState(null, '', '/reset-password#access_token=PUBLIC_SYNTHETIC_JWT&type=recovery');
  render(<ResetPassword />);
  expect(screen.getByRole('button')).toBeDisabled();
  expect(screen.getByRole('status')).toHaveTextContent('Проверяем');
  await act(async () => {
    window.history.replaceState(null, '', '/reset-password');
    resolve({ data: { session }, error: null });
  });
  await ready();
  expect(screen.queryByRole('alert')).toBeNull();
});

test('PASSWORD_RECOVERY makes the form ready and a stale bootstrap result cannot clear it', async () => {
  let resolve;
  mockGetSession.mockReturnValue(new Promise((done) => { resolve = done; }));
  render(<ResetPassword />);
  act(() => mockAuthListener('PASSWORD_RECOVERY', session));
  await ready();
  await act(async () => resolve({ data: { session: null }, error: null }));
  expect(screen.getByRole('button')).toBeEnabled();
});

test.each([
  [{ data: { session: null }, error: null }],
  [{ data: { session: null }, error: new Error('expired') }],
])('a missing or expired recovery session keeps submission disabled', async (result) => {
  mockGetSession.mockResolvedValue(result);
  render(<ResetPassword />);
  expect(await screen.findByRole('alert')).toHaveTextContent('недействительна или истекла');
  expect(screen.getByRole('button')).toBeDisabled();
  expect(mockUpdateUser).not.toHaveBeenCalled();
});

test.each(['/reset-password#error_code=otp_expired&error_description=Expired', '/reset-password?error=access_denied'])('an explicit failed callback is rejected even with a prior login: %s', async (url) => {
  window.history.replaceState(null, '', url);
  render(<ResetPassword />);
  expect(await screen.findByRole('alert')).toHaveTextContent('недействительна или истекла');
  expect(screen.getByRole('button')).toBeDisabled();
  expect(mockGetSession).not.toHaveBeenCalled();
});

test('rechecks the session before updating and rejects an expired session without a password call', async () => {
  mockGetSession.mockResolvedValueOnce({ data: { session }, error: null }).mockResolvedValueOnce({ data: { session: null }, error: null });
  render(<ResetPassword />); await ready();
  fireEvent.change(screen.getByLabelText('Новый пароль'), { target: { value: 'PUBLIC_QA_PASSWORD' } });
  fireEvent.click(screen.getByRole('button'));
  expect(await screen.findByRole('alert')).toHaveTextContent('недействительна или истекла');
  expect(mockUpdateUser).not.toHaveBeenCalled();
});

test('updates the password only after session readiness, then unsubscribes on unmount', async () => {
  const view = render(<ResetPassword />); await ready();
  fireEvent.change(screen.getByLabelText('Новый пароль'), { target: { value: 'PUBLIC_QA_PASSWORD' } });
  fireEvent.click(screen.getByRole('button'));
  await screen.findByText('Пароль изменён');
  expect(mockUpdateUser).toHaveBeenCalledTimes(1);
  expect(mockUpdateUser).toHaveBeenCalledWith({ password: 'PUBLIC_QA_PASSWORD' });
  view.unmount(); expect(mockUnsubscribe).toHaveBeenCalled();
});
