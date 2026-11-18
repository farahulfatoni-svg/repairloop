import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import multer from 'multer';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { RepairCase } from './models.js';

const app = express(); const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
app.use(cors()); app.use(express.json());
const asyncRoute = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

app.get('/api/cases', asyncRoute(async (req, res) => res.json(await RepairCase.find().sort({ updatedAt: -1 }))));
app.get('/api/cases/:id', asyncRoute(async (req, res) => res.json(await RepairCase.findById(req.params.id))));
app.post('/api/cases', asyncRoute(async (req, res) => res.status(201).json(await RepairCase.create(req.body))));
app.patch('/api/cases/:id', asyncRoute(async (req, res) => res.json(await RepairCase.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true }))));
app.post('/api/cases/:id/quotation', asyncRoute(async (req, res) => { const c = await RepairCase.findById(req.params.id); const versions = c.quotations.length + 1; if (c.quotations.length) c.quotations[c.quotations.length - 1].status = 'Superseded'; const items = req.body.items || []; c.quotations.push({ ...req.body, version: versions, items, total: items.reduce((s, x) => s + Number(x.quantity || 0) * Number(x.unitPrice || 0), 0) }); c.status = 'Awaiting approval'; await c.save(); res.json(c); }));
app.post('/api/cases/:id/quotation/:version/respond', asyncRoute(async (req, res) => { const c = await RepairCase.findById(req.params.id); const q = c.quotations.find(x => x.version === Number(req.params.version)); q.status = req.body.decision; c.status = req.body.decision === 'Accepted' ? 'Approved' : 'Awaiting approval'; await c.save(); res.json(c); }));
app.post('/api/cases/:id/analyse-image', upload.single('image'), asyncRoute(async (req, res) => { if (!req.file) return res.status(400).json({ message: 'An image is required.' }); if (!process.env.GEMINI_API_KEY) return res.json({ suggestions: [{ label: 'Gemini API key is not configured. Complete a physical inspection.', confidence: 'N/A' }] }); const gemini = new GoogleGenerativeAI(process.env.GEMINI_API_KEY); const model = gemini.getGenerativeModel({ model: 'gemini-3.8-flash' }); const prompt = 'Inspect this electronics device photo. Return JSON only: {"suggestions":[{"label":"visible damage or observation","confidence":"high|medium|low"}]}. Be cautious: visual assessment is not a diagnosis.'; const result = await model.generateContent([prompt, { inlineData: { data: req.file.buffer.toString('base64'), mimeType: req.file.mimetype } }]); const text = result.response.text().replace(/```json|```/g, ''); res.json(JSON.parse(text)); }));
app.use((err, req, res, next) => { console.error(err); res.status(500).json({ message: err.message || 'Something went wrong' }); });
const port = process.env.PORT || 5001; mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/repairloop').then(() => app.listen(port, () => console.log(`API listening on ${port}`))).catch(e => { console.error('MongoDB connection failed:', e.message); process.exit(1); });
