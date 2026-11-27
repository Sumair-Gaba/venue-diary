// Venue Diary — Vercel Blob client-upload token handler. The browser uploads
// files directly to Blob (any size: photos & videos), so this only issues a
// short-lived signed token after checking the caller's session. The resulting
// URL is recorded via POST /api/media by the client.
import { handleUpload } from '@vercel/blob/client';
import { put } from '@vercel/blob';
import { sessionContext } from './db.js';

// Server-side upload: the mobile app can't use the browser client-upload flow
// (it pulls in Node-only deps), so it sends us the image bytes and we push them
// to Blob here with the read-write token. Returns the public URL.
export async function uploadBuffer(pathname, buffer, contentType) {
  const { url } = await put(pathname, buffer, {
    access: 'public',
    contentType: contentType || 'application/octet-stream',
    addRandomSuffix: true,
    token: process.env.BLOB_READ_WRITE_TOKEN,
  });
  return url;
}

const ALLOWED = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'video/quicktime', 'video/webm', 'video/x-matroska'];

// `body` = parsed JSON from the request. `reqLike` = { headers: { get(name) } }.
export async function handleBlobUpload(body, reqLike) {
  return handleUpload({
    body,
    request: reqLike,
    token: process.env.BLOB_READ_WRITE_TOKEN,
    onBeforeGenerateToken: async (_pathname, clientPayload) => {
      const ctx = await sessionContext(clientPayload); // clientPayload = the session token
      if (!ctx) throw new Error('Unauthorized');
      // Only an owner with a venue, or the admin, may upload — not venue-less users.
      if (!ctx.venue && ctx.user.role !== 'admin') throw new Error('No venue to upload to');
      return {
        allowedContentTypes: ALLOWED,
        maximumSizeInBytes: 100 * 1024 * 1024, // 100 MB
        addRandomSuffix: true,
        tokenPayload: JSON.stringify({ userId: ctx.user.id }),
      };
    },
    // onUploadCompleted intentionally omitted — the client records the URL via
    // POST /api/media, which also works in local dev (no public webhook needed).
  });
}
