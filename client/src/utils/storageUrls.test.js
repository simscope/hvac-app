import { resolveStorageUrl, storageReference } from './storageUrls';
const mockSign = jest.fn();
const mockFrom = jest.fn(() => ({ createSignedUrl: mockSign }));
jest.mock('../supabaseClient', () => ({ supabase: { storage: { from: (...args) => mockFrom(...args) } } }));

beforeEach(() => { jest.clearAllMocks(); mockFrom.mockImplementation(() => ({ createSignedUrl: mockSign })); mockSign.mockResolvedValue({ data: { signedUrl: 'https://new-api.invalid/storage/v1/object/sign/bucket/file?token=new' }, error: null }); });

test('a historical private photo URL is signed by the current backend, without reusing its host or token', async () => {
  const result = await resolveStorageUrl('https://retired.invalid/storage/v1/object/sign/job-photos/job/photo%20one.jpg?token=old', 'job-photos');
  expect(mockFrom).toHaveBeenCalledWith('job-photos');
  expect(mockSign).toHaveBeenCalledWith('job/photo one.jpg', 3600);
  expect(result).not.toContain('retired.invalid');
  expect(result).not.toContain('token=old');
});

test('a restored public document URL retains the exact bucket and key when signed', async () => {
  await resolveStorageUrl('https://retired.invalid/storage/v1/object/public/unit-docs/manual.pdf');
  expect(mockFrom).toHaveBeenCalledWith('unit-docs');
  expect(mockSign).toHaveBeenCalledWith('manual.pdf', 3600);
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
