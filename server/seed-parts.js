import 'dotenv/config';
import mongoose from 'mongoose';
import { createHash } from 'node:crypto';
import { RepairCase } from './models.js';
import { InventoryPart } from './inventory.js';

try {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/repairloop');
  const cases = await RepairCase.find().select('device');
  const devices = new Map();
  for (const repair of cases) {
    const { category, brand, model } = repair.device;
    if (!category || !brand || !model) continue;
    const device = { category, brand, model };
    const key = [category, brand, model].map(value => value.trim().toLowerCase().replace(/\s+/g, ' ')).join('|');
    devices.set(key, device);
  }
  for (const [key, device] of devices) {
    const code = createHash('sha256').update(key).digest('hex').slice(0, 10).toUpperCase();
    for (const [suffix, name, quantity, cost] of [['MODULE', 'Demo replacement module', 5, 100], ['CONNECTOR', 'Demo connector', 3, 25], ['EMPTY', 'Demo out-of-stock component', 0, 50]]) {
      await InventoryPart.updateOne({ stockCode: `DEMO-${code}-${suffix}` }, { $setOnInsert: { stockCode: `DEMO-${code}-${suffix}`, name: `${name} (${device.brand} ${device.model})`, availableQuantity: quantity, unitCost: cost, compatibleDevices: [device], demoOnly: true } }, { upsert: true, runValidators: true });
    }
  }
  console.log(`Demo stock prepared for ${devices.size} device model(s). Existing quantities were not reset.`);
  console.log('These are fictional parts for testing the workflow; their compatibility is demonstration data.');
} catch (err) {
  console.error('Demo stock setup failed:', err.name || 'Error'); process.exitCode = 1;
} finally { await mongoose.disconnect(); }
