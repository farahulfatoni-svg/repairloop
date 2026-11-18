import mongoose from 'mongoose';

const quoteItem = new mongoose.Schema({ description: String, type: { type: String, enum: ['Part', 'Labour'] }, quantity: Number, unitPrice: Number }, { _id: false });
const quotation = new mongoose.Schema({ version: Number, items: [quoteItem], total: Number, validUntil: Date, warrantyTerms: String, scope: String, respondedAt: Date, decisionNote: String, supersededAt: Date, status: { type: String, enum: ['Pending', 'Accepted', 'Rejected', 'Superseded'], default: 'Pending' }, createdAt: { type: Date, default: Date.now } }, { _id: false });
const check = new mongoose.Schema({ name: String, result: { type: String, enum: ['Pending', 'Pass', 'Fail'], default: 'Pending' }, notes: String }, { _id: false });
const task = new mongoose.Schema({ id: String, title: String, status: { type: String, enum: ['Pending', 'In progress', 'Done', 'Blocked'], default: 'Pending' }, notes: String, blockedReason: String, updatedAt: { type: Date, default: Date.now } }, { _id: false });

const conditionPhoto = new mongoose.Schema({ filename: String, mimeType: { type: String, enum: ['image/jpeg', 'image/png', 'image/webp'] }, size: Number, data: { type: Buffer, select: false }, uploadedAt: { type: Date, default: Date.now } });

const caseSchema = new mongoose.Schema({
  caseNumber: { type: String, unique: true }, customer: { name: String, email: String, phone: String },
  device: { category: String, brand: String, model: String, serialNumber: String, accessories: [String], reportedFaults: String, photos: [String] },
  intake: { method: { type: String, enum: ['Walk-in', 'Pickup'], default: 'Walk-in' }, receivedAt: Date, physicalCondition: String },
  conditionPhotos: [conditionPhoto], aiPhotoId: String,
  aiSuggestions: [{ label: String, originalLabel: String, confidence: String, reviewed: { type: Boolean, default: false }, decision: { type: String, enum: ['Accepted', 'Rejected', 'Pending'], default: 'Pending' } }],
  diagnosis: { findings: String, faultyComponents: String, recommendedWork: String, estimatedParts: Number, estimatedLabour: Number, assessedAt: Date, unrepairable: { type: Boolean, default: false }, unrepairableReason: String },
  quotations: [quotation], status: { type: String, enum: ['Submitted', 'Received', 'Assessing', 'Awaiting approval', 'Quotation rejected', 'Approved', 'In repair', 'Quality check', 'Ready for return', 'Closed - unrepairable', 'Repair unsuccessful'], default: 'Submitted' },
  execution: { technician: String, tasks: [task], progress: { type: Number, default: 0, min: 0, max: 100 }, delayReason: String, workNotes: String, stage: { type: String, enum: ['In repair', 'Quality check'] }, workLog: [{ recordedAt: { type: Date, default: Date.now }, technician: String, progress: Number, stage: String, workNotes: String, delayReason: String, outcome: String, outcomeReason: String, tasks: [task], checks: [check] }], partsUsed: [{ partId: String, stockCode: String, partName: String, quantity: Number, compatible: Boolean, unitCost: Number, consumedAt: Date, quotationVersion: Number, operationId: String, withinApprovedScope: Boolean, consumedBy: String }], checks: [check], checkHistory: [{ checks: [check], recordedAt: { type: Date, default: Date.now } }], outcome: { type: String, enum: ['Pending', 'Repaired', 'Unsuccessful', 'Unrepairable'], default: 'Pending' }, outcomeReason: String }
}, { timestamps: true, optimisticConcurrency: true });

caseSchema.set('toJSON', { transform(_doc, result) {
  for (const photo of result.conditionPhotos || []) delete photo.data;
  return result;
} });

caseSchema.pre('validate', async function () { if (!this.caseNumber) this.caseNumber = `RL-${new Date().getFullYear()}-${String(Math.floor(1000 + Math.random() * 9000))}`; });
export const RepairCase = mongoose.model('RepairCase', caseSchema);
