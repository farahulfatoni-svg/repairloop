import { fail, requireText } from './workflow.js';
export const MAX_PHOTOS = 5;
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
export const MAX_TOTAL_PHOTO_BYTES = 10 * 1024 * 1024;
export function intakePhotos(files = []) {
  if (!Array.isArray(files) || files.length > MAX_PHOTOS) fail('Attach at most five condition photos.');
  if (files.reduce((sum, file) => sum + (file.buffer?.length || 0), 0) > MAX_TOTAL_PHOTO_BYTES) fail('Condition photos must total 10 MB or less.');
  return files.map(file => {
    const bytes = file.buffer;
    if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > MAX_PHOTO_BYTES) fail('Each condition photo must be non-empty and 5 MB or smaller.');
    const png = bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && bytes.toString('ascii', 12, 16) === 'IHDR';
    const jpg = bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
    const webp = bytes.length >= 16 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
    const mimeType = png ? 'image/png' : jpg ? 'image/jpeg' : webp ? 'image/webp' : null;
    if (!mimeType || mimeType !== file.mimetype) fail('Condition photos must contain JPG, PNG, or WebP image data matching their file type.');
    const filename = String(file.originalname || 'device-photo').split(/[\\/]/).pop().replace(/[\x00-\x1f\x7f]/g, '').slice(0, 160) || 'device-photo';
    return { filename, mimeType, size: bytes.length, data: bytes, uploadedAt: new Date() };
  });
}
export function intakeFields(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail('Repair request must be an object.');
  const customer = body.customer || {};
  const device = body.device || {};
  const accessories = device.accessories || [];
  if (!Array.isArray(accessories) || accessories.length > 20) fail('Use at most 20 accessories.');
  const seen = new Set();
  const cleanAccessories = accessories.map(value => requireText(value, 'Accessory name', 120)).filter(value => { const key = value.toLowerCase(); if (seen.has(key)) return false; seen.add(key); return true; });
  const optional = (value, label, max) => { if (value === undefined || value === '') return ''; return requireText(value, label, max); };
  const category = device.category || 'Other';
  if (!['Mobile phone', 'Laptop', 'Tablet', 'Desktop', 'Other'].includes(category)) fail('Choose a valid device category.');
  const method = body.intake?.method || 'Walk-in';
  if (!['Walk-in', 'Pickup'].includes(method)) fail('Choose Walk-in or Pickup for arrival method.');
  if (device.photos?.length || body.conditionPhotos?.length) fail('Attach actual image files using the photo upload field.');
  return {
    customer: { name: requireText(customer.name, 'Customer name', 200), email: optional(customer.email, 'Email', 200), phone: optional(customer.phone, 'Phone', 100) },
    device: { category, brand: requireText(device.brand, 'Device brand', 200), model: requireText(device.model, 'Device model', 200), serialNumber: optional(device.serialNumber, 'Serial number', 200), reportedFaults: requireText(device.reportedFaults, 'Reported faults'), accessories: cleanAccessories, photos: [] },
    intake: { method }, status: 'Submitted'
  };
}
