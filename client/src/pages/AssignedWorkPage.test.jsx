import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AssignedWorkPage from './AssignedWorkPage';
import { supabase } from '../supabaseClient';
import { useAuth } from '../context/AuthContext';
jest.mock('../supabaseClient', () => ({ supabase: { from: jest.fn() } }));
jest.mock('../context/AuthContext', () => ({ useAuth: jest.fn() }));

beforeEach(() => jest.clearAllMocks());
test('calendar loads only the linked technician and offers details without reassignment controls', async () => {
  useAuth.mockReturnValue({ profile: { id: 'linked-tech' } });
  const q = { select: jest.fn(), eq: jest.fn(), order: jest.fn().mockResolvedValue({ data: [{ id: 'owned-job', issue: 'QA appointment', status: 'Diagnosis' }] }) };
  q.select.mockReturnValue(q);q.eq.mockReturnValue(q);supabase.from.mockReturnValue(q);
  render(<MemoryRouter initialEntries={['/calendar']}><AssignedWorkPage /></MemoryRouter>);
  await screen.findByRole('link', { name: /QA appointment/ });
  expect(q.eq).toHaveBeenCalledWith('technician_id', 'linked-tech');
  expect(screen.getByRole('heading').textContent).toBe('My calendar');
  expect(screen.queryByRole('combobox')).toBeNull();
});
test('missing identity never launches an unfiltered query', async () => {
  useAuth.mockReturnValue({ profile: null });
  render(<MemoryRouter><AssignedWorkPage /></MemoryRouter>);
  await screen.findByText('No assigned jobs.');
  expect(supabase.from).not.toHaveBeenCalled();
});
test('API error is visible and is not an empty successful calendar', async () => {
  useAuth.mockReturnValue({ profile: { id: 'linked-tech' } });
  const q = { select: jest.fn(), eq: jest.fn(), order: jest.fn().mockResolvedValue({ error: { message: 'synthetic API failure' } }) };
  q.select.mockReturnValue(q);q.eq.mockReturnValue(q);supabase.from.mockReturnValue(q);
  render(<MemoryRouter><AssignedWorkPage /></MemoryRouter>);
  await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/Could not load/));
  expect(screen.queryByText('No assigned jobs.')).toBeNull();
});
