const mockCreateClient = jest.fn();
jest.mock('@supabase/supabase-js', () => ({ createClient: (...args) => mockCreateClient(...args) }));
const original = { ...process.env };
beforeEach(() => {
  jest.resetModules();
  mockCreateClient.mockImplementation(() => ({}));
  process.env.REACT_APP_SUPABASE_URL = 'same-origin';
  process.env.REACT_APP_SUPABASE_ANON_KEY = 'PUBLIC_SYNTHETIC_ANON';
  delete process.env.REACT_APP_SUPABASE_FUNCTIONS_URL;
});
afterAll(() => { process.env = original; });

test('same-origin transport keeps the existing MSI auth storage key on every deployment hostname', () => {
  const config = require('./supabaseClient');
  expect(config.SUPABASE_URL).toBe(window.location.origin);
  expect(config.FUNCTIONS_URL).toBe('/functions/v1');
  expect(mockCreateClient).toHaveBeenCalledWith(window.location.origin, 'PUBLIC_SYNTHETIC_ANON', {
    auth: { persistSession: true, autoRefreshToken: true, storageKey: 'sb-msi-auth-token' },
  });
});

test('missing API configuration cannot fall back to any retired backend', () => {
  delete process.env.REACT_APP_SUPABASE_URL;
  expect(() => require('./supabaseClient')).toThrow('REACT_APP_SUPABASE_URL');
  expect(mockCreateClient).not.toHaveBeenCalled();
});
