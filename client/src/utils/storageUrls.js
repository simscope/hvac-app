import { supabase } from '../supabaseClient';

// Read the bucket/key from historical public or signed URLs without requesting the old host.
export function storageReference(value, defaultBucket) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const raw = value.trim();
  if (/^https?:\/\//i.test(raw)) {
    let pathname;
    try { pathname = new URL(raw).pathname; } catch { return null; }
    const match = pathname.match(/^\/storage\/v1\/object\/(?:public|sign|authenticated)\/([^/]+)\/(.+)$/);
    if (!match) return null;
    try { return { bucket: decodeURIComponent(match[1]), path: decodeURIComponent(match[2]) }; }
    catch { return null; }
  }
  if (!defaultBucket || /^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith('//')) return null;
  return { bucket: defaultBucket, path: raw.replace(/^\/+/, '') };
}

export async function resolveStorageUrl(value, defaultBucket) {
  const ref = storageReference(value, defaultBucket);
  if (!ref) return typeof value === 'string' && /^https?:\/\//i.test(value) ? value : '';
  const bucket = supabase.storage.from(ref.bucket);
  // unit-docs is the verified public library bucket. Public delivery preserves
  // its existing access contract without requiring a Storage SELECT policy.
  // Every other bucket still requires a fresh signed URL, even if a legacy URL
  // contains /public/. Both SDK methods use the current backend origin.
  if (ref.bucket === 'unit-docs') {
    const { data } = bucket.getPublicUrl(ref.path);
    if (!data?.publicUrl) throw new Error('Storage link is unavailable');
    return data.publicUrl;
  }
  const { data, error } = await bucket.createSignedUrl(ref.path, 3600);
  if (error) throw error;
  if (!data?.signedUrl) throw new Error('Storage link is unavailable');
  return data.signedUrl;
}
