import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { AuthProvider, useAuth } from './AuthContext';
import { supabase } from '../supabaseClient';

jest.mock('../supabaseClient', () => ({
  supabase: {
    auth: { getSession: jest.fn(), onAuthStateChange: jest.fn() },
    from: jest.fn(),
    rpc: jest.fn(),
  },
}));

function Probe() {
  const { role, loading, profile } = useAuth();
  return <output data-testid="auth-state">{JSON.stringify({ role, loading, profile })}</output>;
}

test('a resolved profile releases the route guard while the obsolete role RPC remains pending', async () => {
  let resolveProfile;
  const profile = new Promise(resolve => { resolveProfile = resolve; });
  supabase.auth.getSession.mockResolvedValue({ data: { session: { user: { id: 'test-user', app_metadata: {} } } } });
  supabase.auth.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: jest.fn() } } });
  const request = { select: jest.fn(), eq: jest.fn(), maybeSingle: jest.fn(() => profile) };
  request.select.mockReturnValue(request);
  request.eq.mockReturnValue(request);
  supabase.from.mockReturnValue(request);
  supabase.rpc.mockReturnValue(new Promise(() => {}));

  render(<AuthProvider><Probe /></AuthProvider>);
  await waitFor(() => expect(supabase.rpc).toHaveBeenCalledWith('my_role'));
  await act(async () => resolveProfile({ data: { id: 'test-user', role: 'admin' }, error: null }));
  await waitFor(() => {
    const value = JSON.parse(screen.getByTestId('auth-state').textContent);
    expect(value.role).toBe('admin');
    expect(value.loading).toBe(false);
  });
});

test('technician identity loads using columns actually present in the restored schema', async () => {
  jest.clearAllMocks();
  supabase.auth.getSession.mockResolvedValue({ data: { session: { user: { id: 'tech-user', app_metadata: {} } } } });
  supabase.auth.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: jest.fn() } } });
  const columns = [];
  supabase.from.mockImplementation(table => {
    const request = {
      select: jest.fn(value => { columns.push({ table, value }); return request; }),
      eq: jest.fn(() => request),
      maybeSingle: jest.fn(async () => table === 'profiles'
        ? { data: { id: 'tech-user', role: 'technician', technician_id: 'tech-row' }, error: null }
        : { data: { id: 'tech-row', name: 'Local technician', phone: null, email: 'tech@local.invalid' }, error: null }),
    };
    return request;
  });
  supabase.rpc.mockReturnValue(new Promise(() => {}));
  render(<AuthProvider><Probe /></AuthProvider>);
  await waitFor(() => {
    const value = JSON.parse(screen.getByTestId('auth-state').textContent);
    expect(value.role).toBe('tech');
    expect(value.loading).toBe(false);
    expect(value.profile.id).toBe('tech-row');
    expect(value.profile.full_name).toBe('Local technician');
  });
  expect(columns.find(c => c.table === 'technicians').value).toBe('id, name, phone, email');
});
