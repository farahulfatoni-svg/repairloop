import 'dotenv/config';
import mongoose from 'mongoose';
import { RepairCase } from './models.js';

const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/repairloop';

const samples = [
  {
    caseNumber: 'RL-2026-1042', customer: { name: 'Ayesha Rahman', email: 'ayesha@example.com', phone: '01700000001' },
    device: { category: 'Mobile phone', brand: 'Samsung', model: 'Galaxy S22', serialNumber: 'SM-S901', accessories: ['USB-C cable'], reportedFaults: 'Screen flickers and the phone restarts unexpectedly.' },
    intake: { method: 'Walk-in', receivedAt: new Date(), physicalCondition: 'Minor frame scuffs; screen has a hairline crack in the lower corner.' },
    diagnosis: { findings: 'Display assembly shows intermittent connection. Battery health is reduced.', faultyComponents: 'Display flex cable, battery', recommendedWork: 'Replace display flex assembly and battery; perform a full function test.', estimatedParts: 5500, estimatedLabour: 1200, assessedAt: new Date() },
    quotations: [{ version: 1, items: [{ description: 'Display assembly', type: 'Part', quantity: 1, unitPrice: 3500 }, { description: 'Battery', type: 'Part', quantity: 1, unitPrice: 2000 }, { description: 'Repair labour', type: 'Labour', quantity: 1, unitPrice: 1200 }], total: 6700, validUntil: new Date(Date.now() + 7 * 86400000), warrantyTerms: '90 days warranty on completed repair work.', status: 'Accepted' }],
    status: 'Approved', execution: { technician: 'Nabila Sultana', progress: 0, tasks: [], partsUsed: [], checks: [], outcome: 'Pending' }
  },
  {
    caseNumber: 'RL-2026-1043', customer: { name: 'Mahin Islam', email: 'mahin@example.com', phone: '01700000002' },
    device: { category: 'Laptop', brand: 'Dell', model: 'Inspiron 15', serialNumber: 'DL-3511', accessories: ['Charger'], reportedFaults: 'Laptop does not charge consistently.' },
    intake: { method: 'Pickup', receivedAt: new Date(), physicalCondition: 'Good condition; charger cable insulation is worn.' },
    status: 'Assessing', execution: { progress: 0, tasks: [], partsUsed: [], checks: [], outcome: 'Pending' }
  }
];

try {
  await mongoose.connect(uri);
  const count = await RepairCase.countDocuments();
  if (count) console.log(`Database already contains ${count} repair case(s); seed skipped.`);
  else { await RepairCase.insertMany(samples); console.log('Created RepairLoop database sample cases.'); }
} finally { await mongoose.disconnect(); }
