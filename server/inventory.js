import mongoose from 'mongoose';
import { RepairCase } from './models.js';
import { fail, requireOpen, requireApproval, latestQuote } from './workflow.js';

// Minimal Feature 5 adapter. Replace these inventory reads/updates with the
// teammate's Feature 2 service at integration time; no purchasing module here.
const compatibleDevice = new mongoose.Schema({ category: String, brand: String, model: String }, { _id: false });
const partSchema = new mongoose.Schema({
  stockCode: { type: String, unique: true, required: true }, name: { type: String, required: true },
  availableQuantity: { type: Number, required: true, min: 0, validate: Number.isInteger },
  unitCost: { type: Number, default: 0, min: 0 }, compatibleDevices: [compatibleDevice],
  demoOnly: { type: Boolean, default: false }
}, { timestamps: true });
export const InventoryPart = mongoose.model('RepairLoopPart', partSchema);
const normal = value => String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
export const compatibleWith = (part, device) => !!device?.brand && !!device?.model && part.compatibleDevices.some(item => ['category', 'brand', 'model'].every(key => normal(item[key]) === normal(device[key])));
export async function caseParts(caseId) {
  if (!mongoose.isValidObjectId(caseId)) fail('Invalid repair case ID.');
  const repair = await RepairCase.findById(caseId);
  if (!repair) fail('Repair case not found.', 404);
  const parts = await InventoryPart.find().sort({ stockCode: 1 }).limit(100);
  return parts.map(part => ({ ...part.toObject(), compatible: compatibleWith(part, repair.device) }));
}
export async function consumePart(caseId, body) {
  if (!mongoose.isValidObjectId(caseId) || !mongoose.isValidObjectId(body.partId)) fail('Choose a valid case and stock part.');
  if (!Number.isInteger(body.quantity) || body.quantity < 1 || body.quantity > 1000) fail('Consumption quantity must be a whole number between 1 and 1000.');
  if (typeof body.operationId !== 'string' || !/^[a-zA-Z0-9-]{8,80}$/.test(body.operationId)) fail('A valid consumption request identifier is required.');
  if (body.withinApprovedScope !== true) fail('Confirm that the part is within the approved repair scope. Otherwise issue a revised quotation.');
  const session = await mongoose.startSession();
  let result;
  try {
    await session.withTransaction(async () => {
      const repair = await RepairCase.findById(caseId).session(session);
      if (!repair) fail('Repair case not found.', 404);
      const existing = repair.execution.partsUsed.find(item => item.operationId === body.operationId);
      if (existing) {
        if (String(existing.partId) !== body.partId || existing.quantity !== body.quantity) fail('This request identifier was already used for different parts.', 409);
        result = repair; return;
      }
      requireOpen(repair); requireApproval(repair);
      if (!repair.execution.technician?.trim()) fail('Save the assigned technician before recording parts consumption.', 409);
      const part = await InventoryPart.findById(body.partId).session(session);
      if (!part) fail('Stock part not found.', 404);
      if (!compatibleWith(part, repair.device)) fail('This part is not recorded as compatible with the device category, brand and model.', 409);
      const changed = await InventoryPart.findOneAndUpdate({ _id: part._id, availableQuantity: { $gte: body.quantity } }, { $inc: { availableQuantity: -body.quantity } }, { new: true, runValidators: true, session });
      if (!changed) fail('Not enough stock. Refresh the available quantities and try again.', 409);
      repair.execution.partsUsed.push({ partId: String(part._id), stockCode: part.stockCode, partName: part.name, quantity: body.quantity, compatible: true, unitCost: part.unitCost, consumedAt: new Date(), quotationVersion: latestQuote(repair).version, operationId: body.operationId, withinApprovedScope: true, consumedBy: repair.execution.technician });
      await repair.save({ session });
      result = repair;
    });
    return result;
  } catch (err) {
    if (err.code === 20 || /Transaction numbers are only allowed/.test(err.message || '')) fail('Parts consumption requires MongoDB Atlas or another replica set supporting transactions.', 503);
    throw err;
  } finally { await session.endSession(); }
}
