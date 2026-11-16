import { resolveStorageUrl, storageReference } from './storageUrls';
const mockSign = jest.fn();
const mockPublic = jest.fn();
const mockFrom = jest.fn(() => ({ createSignedUrl: mockSign, getPublicUrl: mockPublic }));
jest.mock('../supabaseClient', () => ({ supabase: { storage: { from: (...args) => mockFrom(...args) } } }));

beforeEach(() => { jest.clearAllMocks(); mockFrom.mockImplementation(() => ({ createSignedUrl: mockSign, getPublicUrl: mockPublic })); mockSign.mockResolvedValue({ data: { signedUrl: 'https://new-api.invalid/storage/v1/object/sign/bucket/file?token=new' }, error: null }); mockPublic.mockReturnValue({ data: { publicUrl: 'https://hvac-app-jade.vercel.app/storage/v1/object/public/unit-docs/manual.pdf' } }); });

test('a historical private photo URL is signed by the current backend, without reusing its host or token', async () => {
  const result = await resolveStorageUrl('https://retired.invalid/storage/v1/object/sign/job-photos/job/photo%20one.jpg?token=old', 'job-photos');
  expect(mockFrom).toHaveBeenCalledWith('job-photos');
  expect(mockSign).toHaveBeenCalledWith('job/photo one.jpg', 3600);
  expect(result).not.toContain('retired.invalid');
  expect(result).not.toContain('token=old');
});

test.each([
  'https://retired.invalid/storage/v1/object/public/unit-docs/manual.pdf',
  'https://msi.tail4626fb.ts.net:8443/storage/v1/object/public/unit-docs/manual.pdf',
  'https://retired.invalid/storage/v1/object/sign/unit-docs/manual.pdf?token=expired',
  'manual.pdf',
])('the verified public library uses the current SDK public URL without requesting signing permission: %s', async (value) => {
  const url = await resolveStorageUrl(value, 'unit-docs');
  expect(mockFrom).toHaveBeenCalledWith('unit-docs');
  expect(mockPublic).toHaveBeenCalledWith('manual.pdf');
  expect(mockSign).not.toHaveBeenCalled();
  expect(url).toBe('https://hvac-app-jade.vercel.app/storage/v1/object/public/unit-docs/manual.pdf');
});

test('public library paths are decoded once and delegated to the SDK for current-origin encoding', async () => {
  mockPublic.mockReturnValue({ data: { publicUrl: 'https://hvac-app-jade.vercel.app/storage/v1/object/public/unit-docs/guides/manual%20one%25.pdf' } });
  const url = await resolveStorageUrl('https://retired.invalid/storage/v1/object/public/unit-docs/guides/manual%20one%25.pdf');
  expect(mockPublic).toHaveBeenCalledWith('guides/manual one%.pdf');
  expect(mockSign).not.toHaveBeenCalled();
  expect(url).toBe('https://hvac-app-jade.vercel.app/storage/v1/object/public/unit-docs/guides/manual%20one%25.pdf');
});

test.each(['invoices', 'job-photos', 'chat-attachments'])('private bucket %s retains signing even for a historical public-looking URL', async (bucket) => {
  await resolveStorageUrl(`https://retired.invalid/storage/v1/object/public/${bucket}/folder/manual%20one.pdf`);
  expect(mockFrom).toHaveBeenCalledWith(bucket);
  expect(mockSign).toHaveBeenCalledWith('folder/manual one.pdf', 3600);
  expect(mockPublic).not.toHaveBeenCalled();
});

test('a missing SDK public URL fails without trying a private signing fallback', async () => {
  mockPublic.mockReturnValue({ data: {} });
  await expect(resolveStorageUrl('manual.pdf', 'unit-docs')).rejects.toThrow('Storage link is unavailable');
  expect(mockSign).not.toHaveBeenCalled();
});

test('relative attachment keys use the caller bucket', async () => {
  await resolveStorageUrl('chat/file.pdf', 'chat-attachments');
  expect(mockFrom).toHaveBeenCalledWith('chat-attachments');
  expect(mockSign).toHaveBeenCalledWith('chat/file.pdf', 3600);
});

test('ordinary external documents remain external and never trigger a Storage call', async () => {
  expect(await resolveStorageUrl('https://vendor.invalid/manual.pdf')).toBe('https://vendor.invalid/manual.pdf');
  expect(mockFrom).not.toHaveBeenCalled();
});

test('denied Storage access never falls back to the old public URL', async () => {
  mockSign.mockResolvedValue({ data: null, error: new Error('denied') });
  await expect(resolveStorageUrl('https://retired.invalid/storage/v1/object/public/job-photos/private.jpg')).rejects.toThrow('denied');
});

test('unsafe schemes and malformed encoded Storage paths are not signed', async () => {
  expect(await resolveStorageUrl('javascript:alert(1)', 'unit-docs')).toBe('');
  expect(storageReference('https://retired.invalid/storage/v1/object/public/unit-docs/%ZZ')).toBeNull();
  expect(mockFrom).not.toHaveBeenCalled();
});

test.each([
  'https://retired.invalid/storage/v1/object/public/job-photos/job/photo.jpg',
  'https://msi.tail4626fb.ts.net:8443/storage/v1/object/public/job-photos/job/photo.jpg',
])('historical or current Tail storage links are replaced by a current-origin signed URL: %s', async (value) => {
  mockSign.mockResolvedValue({ data: { signedUrl: 'https://hvac-app-jade.vercel.app/storage/v1/object/sign/job-photos/job/photo.jpg?token=new' }, error: null });
  const result = await resolveStorageUrl(value, 'job-photos');
  expect(mockFrom).toHaveBeenCalledWith('job-photos');
  expect(mockSign).toHaveBeenCalledWith('job/photo.jpg', 3600);
  expect(new URL(result).origin).toBe('https://hvac-app-jade.vercel.app');
});
