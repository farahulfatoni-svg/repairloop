import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import multer from 'multer';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { RepairCase } from './models.js';
import { intakeFields, intakePhotos, MAX_PHOTOS } from './media.js';
import { caseParts, consumePart } from './inventory.js';
import { fail, requireText, latestQuote, requireOpen, quotationInput, requireAssessment, requireApproval, requireQuality, updateExecution, CLOSED_STATES } from './workflow.js';

const app = express(); const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
app.use(cors()); app.use(express.json());
const asyncRoute = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const getCase = async id => {
  if (!mongoose.isValidObjectId(id)) fail('Invalid repair case ID.');
  const repair = await RepairCase.findById(id);
  if (!repair) fail('Repair case not found.', 404);
  return repair;
};
app.get('/api/cases', asyncRoute(async (req, res) => res.json(await RepairCase.find().sort({ updatedAt: -1 }))));
app.get('/api/cases/:id', asyncRoute(async (req, res) => res.json(await getCase(req.params.id))));
app.post('/api/cases', upload.array('photos', MAX_PHOTOS), asyncRoute(async (req, res) => {
  let body = req.body;
  if (req.is('multipart/form-data')) {
    try { body = JSON.parse(req.body.case); }
    catch { fail('The repair-request details could not be read. Please submit the form again.'); }
  }
  const fields = intakeFields(body);
  const photos = intakePhotos(req.files || []);
  // Images and intake fields commit together in one MongoDB document.
  res.status(201).json(await RepairCase.create({ ...fields, conditionPhotos: photos }));
}));
const loadPhoto = async (caseId, photoId) => {
  if (!mongoose.isValidObjectId(caseId) || !mongoose.isValidObjectId(photoId)) fail('Invalid repair case or photo ID.');
  const record = await RepairCase.findOne({ _id: caseId, 'conditionPhotos._id': photoId }).select('+conditionPhotos.data');
  const photo = record?.conditionPhotos.id(photoId);
  if (!photo?.data) fail('Condition photo not found for this repair case.', 404);
  return photo;
};
app.get('/api/cases/:id/photos/:photoId', asyncRoute(async (req, res) => {
  const photo = await loadPhoto(req.params.id, req.params.photoId);
  res.set('Content-Type', photo.mimeType);
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Cache-Control', 'private, max-age=3600');
  res.send(Buffer.from(photo.data));
}));
app.get('/api/cases/:id/parts', asyncRoute(async (req, res) => res.json(await caseParts(req.params.id))));
app.post('/api/cases/:id/parts/consume', asyncRoute(async (req, res) => res.json(await consumePart(req.params.id, req.body))));
app.patch('/api/cases/:id', asyncRoute(async (req, res) => {
  const repair = await getCase(req.params.id);
  if (Object.keys(req.body).some(key => !['intake', 'diagnosis', 'execution', 'status'].includes(key))) fail('Use the dedicated quotation or Gemini review controls for those changes.');
  const beforeStatus = repair.status;
  if (CLOSED_STATES.includes(beforeStatus)) fail('This case is closed or ready for return. Its record is read-only.', 409);
  const current = latestQuote(repair);
  const { intake, diagnosis, execution } = req.body;
  let nextStatus = req.body.status || beforeStatus;
  if (intake) {
    if (intake.receivedAt && (!Number.isFinite(new Date(intake.receivedAt).getTime()) || new Date(intake.receivedAt).getTime() > Date.now())) fail('Physical receipt date cannot be invalid or in the future.');
    if (repair.intake?.receivedAt && !intake.receivedAt) fail('An existing physical receipt cannot be removed.');
  }
  if (diagnosis && current?.status === 'Accepted') {
    if (diagnosis.recommendedWork !== repair.diagnosis.recommendedWork || Number(diagnosis.estimatedParts || 0) !== Number(repair.diagnosis.estimatedParts || 0) || Number(diagnosis.estimatedLabour || 0) !== Number(repair.diagnosis.estimatedLabour || 0)) fail('Use Issue revised quotation to change approved scope or prices.', 409);
  }
  if (execution) {
    if (intake || diagnosis) fail('Save assessment and execution separately.');
    nextStatus = updateExecution(repair, execution, nextStatus);
  } else if (nextStatus !== beforeStatus && !['Received', 'Assessing', 'Closed - unrepairable'].includes(nextStatus)) {
    fail('Quotation decisions and repair completion must use their respective workflow controls.', 409);
  }
  if (intake) repair.intake = intake;
  if (diagnosis) repair.diagnosis = diagnosis;
  if (nextStatus === 'Closed - unrepairable' && !execution) {
    if (repair.quotations.length) fail('This assessment closure is available before issuing a quotation.', 409);
    if (!repair.diagnosis.unrepairable) fail('Mark the device unrepairable before closing.');
    requireText(repair.diagnosis.unrepairableReason, 'Unrepairable reason');
  } else if (repair.diagnosis?.unrepairable && !execution) {
    fail('Close the unrepairable case with a reason instead of continuing repairs.', 409);
  }
  if (['Ready for return', 'Closed - unrepairable', 'Repair unsuccessful'].includes(beforeStatus) && nextStatus !== beforeStatus) fail('This case is already closed or ready for return.', 409);
  if (current && ['Received', 'Assessing'].includes(nextStatus)) fail('A case with a quotation cannot be reset to intake.', 409);
  repair.status = nextStatus;
  await repair.save(); res.json(repair);
}));
app.post('/api/cases/:id/quotation', asyncRoute(async (req, res) => {
  const repair = await getCase(req.params.id);
  requireOpen(repair); requireAssessment(repair);
  const quotation = quotationInput(req.body);
  const current = latestQuote(repair);
  if (!Number.isInteger(req.body.expectedVersion) || req.body.expectedVersion !== (current?.version || 0)) fail('A newer quotation exists. Reopen this case before issuing a revision.', 409);
  if (current?.status === 'Pending') current.status = 'Superseded';
  if (current) current.supersededAt = new Date();
  repair.quotations.push({ ...quotation, version: (current?.version || 0) + 1, status: 'Pending' });
  repair.diagnosis.recommendedWork = quotation.scope;
  repair.diagnosis.estimatedParts = quotation.items.filter(x => x.type === 'Part').reduce((sum, x) => sum + Math.round(x.unitPrice * 100) * x.quantity, 0) / 100;
  repair.diagnosis.estimatedLabour = quotation.items.filter(x => x.type === 'Labour').reduce((sum, x) => sum + Math.round(x.unitPrice * 100) * x.quantity, 0) / 100;
  // Revised work requires a new inspection; preserve earlier results for future rework integration.
  if (current && repair.execution.checks?.length) {
    repair.execution.checkHistory.push({ checks: repair.execution.checks.map(x => x.toObject()), recordedAt: new Date() });
    repair.execution.checks.forEach(check => { check.result = 'Pending'; check.notes = ''; });
  }
  repair.status = 'Awaiting approval';
  await repair.save(); res.json(repair);
}));
app.post('/api/cases/:id/quotation/:version/respond', asyncRoute(async (req, res) => {
  const repair = await getCase(req.params.id);
  requireOpen(repair);
  const quotation = latestQuote(repair);
  if (!quotation || quotation.version !== Number(req.params.version)) fail('Only the latest quotation can receive a decision.', 409);
  if (!['Accepted', 'Rejected'].includes(req.body.decision)) fail('Choose Accepted or Rejected.');
  if (quotation.status !== 'Pending' || repair.status !== 'Awaiting approval') fail('A decision is already recorded or this quotation is no longer pending.', 409);
  if (req.body.decision === 'Accepted' && (!quotation.validUntil || new Date(quotation.validUntil).getTime() <= Date.now())) fail('This quotation has expired. Staff must issue a revised quotation.', 409);
  if (req.body.reason !== undefined && (typeof req.body.reason !== 'string' || req.body.reason.length > 2000)) fail('Decision note must be at most 2000 characters.');
  quotation.status = req.body.decision;
  quotation.respondedAt = new Date(); quotation.decisionNote = (req.body.reason || '').trim();
  repair.status = req.body.decision === 'Accepted' ? 'Approved' : 'Quotation rejected';
  await repair.save(); res.json(repair);
}));
const normaliseSuggestions = items => items.map(s => ({
  label: s.label.trim(),
  confidence: typeof s.confidence === 'string' ? s.confidence : 'N/A',
  originalLabel: s.label.trim(),
  decision: 'Pending',
  reviewed: false
}));

app.post('/api/cases/:id/analyse-image', upload.single('image'), asyncRoute(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: 'Invalid repair case.' });
  const repair = await RepairCase.findById(req.params.id);
  if (!repair) return res.status(404).json({ message: 'Repair case not found.' });
  let image = req.file;
  let photoId = '';
  if (!image && req.body.photoId) {
    const photo = await loadPhoto(req.params.id, req.body.photoId);
    image = { buffer: Buffer.from(photo.data), mimetype: photo.mimeType };
    photoId = String(photo._id);
  }
  if (!image) return res.status(400).json({ message: 'Choose a saved condition photo or upload an image first.' });
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(image.mimetype)) {
    return res.status(400).json({ message: 'Use a JPG, PNG, or WebP image.' });
  }
  if (!process.env.GEMINI_API_KEY) return res.status(503).json({ message: 'Gemini is not configured. Complete a physical inspection or configure the API key.' });
  let suggestions;
  try {
    const gemini = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = gemini.getGenerativeModel({ model: process.env.GEMINI_MODEL || 'gemini-3.8-flash' });
    const prompt = 'Inspect this electronics device photo. Return JSON only: {"suggestions":[{"label":"visible damage or observation","confidence":"high|medium|low"}]}. Return at most 20 observations. Only describe visible evidence. A visual assessment is not a diagnosis. If no useful visible damage observations can be made, return an empty suggestions array.';
    const result = await model.generateContent([prompt, { inlineData: { data: image.buffer.toString('base64'), mimeType: image.mimetype } }]);
    const raw = result.response.text().trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.suggestions) || parsed.suggestions.length > 20 || parsed.suggestions.some(x => !x || typeof x.label !== 'string' || !x.label.trim() || x.label.length > 2000)) {
      throw new Error('Invalid analysis response');
    }
    suggestions = normaliseSuggestions(parsed.suggestions);
  } catch (err) {
    const status = Number(err.status);
    console.error('Gemini diagnostic:', err.name, err.status,
      String(err.message || err)
        .split(process.env.GEMINI_API_KEY || 'NO_KEY').join('[HIDDEN]'));
    const message = status === 403 ? 'Google denied access to Gemini. Check this API key’s project access and quota tier.'
      : status === 429 ? 'Gemini request limit reached. Please try again later.'
      : status === 404 ? 'The configured Gemini model is unavailable. Check GEMINI_MODEL in your server settings.'
      : status === 400 || status === 401 ? 'Gemini could not process the request. Check the API key and image format.'
      : 'Gemini analysis failed or returned an unreadable response. Please try again.';
    return res.status(502).json({ message });
  }
  // A failed analysis leaves the previous saved observations intact.
  repair.aiSuggestions = suggestions;
  repair.aiPhotoId = photoId;
  await repair.save();
  res.json({ suggestions: repair.aiSuggestions, photoId: repair.aiPhotoId });
}));

app.patch('/api/cases/:id/ai-suggestions', asyncRoute(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: 'Invalid repair case.' });
  const repair = await RepairCase.findById(req.params.id);
  if (!repair) return res.status(404).json({ message: 'Repair case not found.' });
  const items = req.body.suggestions;
  const saved = repair.aiSuggestions || [];
  const decisions = ['Pending', 'Accepted', 'Rejected'];
  if (!Array.isArray(items) || items.length !== saved.length || items.some((x, i) =>
    !x || String(x._id) !== String(saved[i]._id) || typeof x.label !== 'string' || !x.label.trim() || x.label.length > 2000 || !decisions.includes(x.decision))) {
    return res.status(400).json({ message: 'Review could not be saved. Keep each observation non-empty and refresh if a newer analysis was uploaded.' });
  }
  items.forEach((x, i) => {
    saved[i].originalLabel = saved[i].originalLabel || saved[i].label;
    saved[i].label = x.label.trim();
    saved[i].decision = x.decision;
    saved[i].reviewed = x.decision !== 'Pending';
  });
  await repair.save();
  res.json({ suggestions: repair.aiSuggestions, photoId: repair.aiPhotoId || '' });
}));
app.use((err, req, res, next) => {
  if (['LIMIT_UNEXPECTED_FILE', 'LIMIT_FILE_COUNT'].includes(err.code)) return res.status(400).json({ message: 'Use the correct photo upload field and attach at most five condition photos.' });
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ message: 'Image must be 5 MB or smaller.' });
  if (err.name === 'VersionError') return res.status(409).json({ message: 'This case changed in another window. Reopen it and try again.' });
  if (err.statusCode) return res.status(err.statusCode).json({ message: err.message });
  if (['ValidationError', 'CastError'].includes(err.name)) return res.status(400).json({ message: 'Some case fields are invalid. Check the entered values.' });
  console.error('RepairLoop request failed:', err.name || 'Error');
  res.status(500).json({ message: 'The server could not save this change. Please try again.' });
});
const port = process.env.PORT || 5001; mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/repairloop').then(() => app.listen(port, () => console.log(`API listening on ${port}`))).catch(e => { console.error('MongoDB connection failed:', e.message); process.exit(1); });
