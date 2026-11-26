// Turns a photo the user picked into a small base64 JPEG for Gemini vision. Phone photos are 3-8 MB; sending them
// raw is slow and wasteful, so they are scaled down first (when the browser can), and anything still too big is refused.
const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp']);
export const MAX_PHOTOS = 3;
const MAX_SIDE = 1280;
const MAX_BASE64_CHARS = 5_000_000; // ~3.7 MB of image data

function readAsBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read that photo.'));
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.readAsDataURL(blob);
  });
}

export async function prepareImage(file) {
  if (!file || !ALLOWED.has(file.type)) throw new Error('Please choose a JPEG, PNG or WebP photo.');
  if (file.size > 30 * 1024 * 1024) throw new Error('That photo is too large.');

  if (typeof createImageBitmap === 'function' && typeof document !== 'undefined') {
    try {
      const bmp = await createImageBitmap(file);
      const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bmp.width * scale));
      canvas.height = Math.max(1, Math.round(bmp.height * scale));
      canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
      bmp.close?.();
      const data = canvas.toDataURL('image/jpeg', 0.82).split(',')[1] || '';
      if (data && data.length <= MAX_BASE64_CHARS) return { mimeType: 'image/jpeg', data, name: file.name };
    } catch {
      // fall through to the raw path
    }
  }
  const data = await readAsBase64(file);
  if (!data || data.length > MAX_BASE64_CHARS) throw new Error('That photo is too large to send. Try a smaller one.');
  return { mimeType: file.type, data, name: file.name };
}

const MAX_PDF_BYTES = 8 * 1024 * 1024;

/** A photo or PDF of a lab report, ready to send to Gemini. PDFs are sent as-is (Gemini reads them natively). */
export async function prepareReportFile(file) {
  if (file?.type === 'application/pdf') {
    if (file.size > MAX_PDF_BYTES) throw new Error('That PDF is over 8 MB. Try a photo of the results page instead.');
    const data = await readAsBase64(file);
    if (!data) throw new Error('Could not read that PDF.');
    return { mimeType: 'application/pdf', data, name: file.name };
  }
  if (file && !ALLOWED.has(file.type)) throw new Error('Please choose a PDF or a JPEG, PNG or WebP photo.');
  return prepareImage(file);
}
