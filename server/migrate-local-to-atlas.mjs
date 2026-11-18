import 'dotenv/config';
import mongoose from 'mongoose';
import { mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const { EJSON } = mongoose.mongo.BSON;
export const COLLECTIONS = ['repaircases', 'repairloopparts'];
const stop = message => { throw Object.assign(new Error(message), { safeMessage: message }); };
const sortKeys = value => Array.isArray(value) ? value.map(sortKeys) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, sortKeys(value[key])])) : value;
export const canonical = value => JSON.stringify(sortKeys(EJSON.serialize(value, { relaxed: false })));
const canonicalDocuments = docs => docs.map(canonical).sort().join('\n');
export async function snapshotDatabase(db) {
  const snapshot = {};
  for (const name of COLLECTIONS) snapshot[name] = await db.collection(name).find({}).toArray();
  return snapshot;
}
export async function assertSourceUnchanged(sourceDb, snapshot) {
  const current = await snapshotDatabase(sourceDb);
  if (COLLECTIONS.some(name => canonicalDocuments(current[name]) !== canonicalDocuments(snapshot[name]))) {
    stop('Local data changed during migration. Stop every RepairLoop server and rerun. No source records were changed by this script.');
  }
}
export function planCollection(name, source, existing) {
  const byId = new Map(existing.map(doc => [String(doc._id), doc]));
  const key = name === 'repaircases' ? 'caseNumber' : 'stockCode';
  const byKey = new Map(existing.filter(doc => doc[key]).map(doc => [doc[key], doc]));
  const inserts = [];
  let unchanged = 0;
  for (const doc of source) {
    const sameId = byId.get(String(doc._id));
    if (sameId) {
      if (canonical(sameId) !== canonical(doc)) stop(`Conflict in ${name}: Atlas has a different version of an existing record. Nothing will be overwritten. Ask for help before continuing.`);
      unchanged++; continue;
    }
    if (doc[key] && byKey.has(doc[key])) stop(`Conflict in ${name}: Atlas already uses one of the local ${key} values for a different record. Nothing will be overwritten. Ask for help before continuing.`);
    inserts.push(doc);
  }
  return { inserts, unchanged };
}
export async function copySnapshot(targetDb, snapshot, session, sourceCheck = async () => {}) {
  const plans = {};
  // Check both collections before inserting either of them.
  for (const name of COLLECTIONS) {
    const existing = await targetDb.collection(name).find({}, { session }).toArray();
    plans[name] = planCollection(name, snapshot[name], existing);
  }
  for (const name of COLLECTIONS) if (plans[name].inserts.length) await targetDb.collection(name).insertMany(plans[name].inserts, { session, ordered: true });
  for (const name of COLLECTIONS) {
    const copied = await targetDb.collection(name).find({}, { session }).toArray();
    const byId = new Map(copied.map(doc => [String(doc._id), doc]));
    if (snapshot[name].some(doc => !byId.has(String(doc._id)) || canonical(doc) !== canonical(byId.get(String(doc._id))))) stop('The destination verification failed. The transaction will be rolled back.');
  }
  await sourceCheck();
  return Object.fromEntries(COLLECTIONS.map(name => [name, { inserted: plans[name].inserts.length, alreadyPresent: plans[name].unchanged, verified: snapshot[name].length }]));
}

export async function main() {
  let source, target, session;
  try {
    const uri = process.env.MONGODB_URI;
    if (!uri) stop('MONGODB_URI is still missing from .env. Run this command from the repairloop project folder.');
    source = await mongoose.createConnection('mongodb://127.0.0.1:27017/repairloop', { serverSelectionTimeoutMS: 10000 }).asPromise();
    target = await mongoose.createConnection(uri, { serverSelectionTimeoutMS: 15000 }).asPromise();
    const info = await target.db.admin().command({ hello: 1 });
    if (!info.setName && info.msg !== 'isdbgrid') stop('The configured destination is standalone MongoDB. Copy your personal Atlas connection string into MONGODB_URI first.');
    if (target.db.databaseName !== 'repairloop') stop('The Atlas connection must select /repairloop as its database for this migration.');
    if (target.host === source.host && target.port === source.port) stop('Source and destination appear to be the same server. Check the Atlas URI.');
    console.log('Destination connection verified: transaction-capable database.');
    const snapshot = await snapshotDatabase(source.db);
    console.log(`Local data: ${snapshot.repaircases.length} repair case(s), ${snapshot.repairloopparts.length} stock item(s).`);
    const directory = path.join(homedir(), 'Documents', 'RepairLoop_Backups');
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const filename = path.join(directory, `repairloop-before-atlas-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    await writeFile(filename, JSON.stringify(EJSON.serialize({ createdAt: new Date(), collections: snapshot }, { relaxed: false }), null, 2), { mode: 0o600, flag: 'wx' });
    console.log(`Backup saved: ${filename}`);
    await assertSourceUnchanged(source.db, snapshot);
    // Create only the expected collections/indexes; no dropping or replacing.
    const present = new Set((await target.db.listCollections({}, { nameOnly: true }).toArray()).map(item => item.name));
    for (const name of COLLECTIONS) if (!present.has(name)) await target.db.createCollection(name);
    await target.db.collection('repaircases').createIndex({ caseNumber: 1 }, { unique: true });
    await target.db.collection('repairloopparts').createIndex({ stockCode: 1 }, { unique: true });
    session = target.getClient().startSession();
    let summary;
    await session.withTransaction(async () => {
      summary = await copySnapshot(target.db, snapshot, session, () => assertSourceUnchanged(source.db, snapshot));
    }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' }, readPreference: 'primary' });
    for (const name of COLLECTIONS) console.log(`${name}: ${summary[name].inserted} copied, ${summary[name].alreadyPresent} already present, ${summary[name].verified} verified.`);
    console.log('MIGRATION COMPLETE. Local data is unchanged. Start RepairLoop to use Atlas.');
  } catch (err) {
    if (err.safeMessage) console.error(err.safeMessage);
    else if (err.code === 18 || err.code === 8000) console.error('Atlas authentication failed. Check the database username and password in .env.');
    else if (err.name === 'MongoServerSelectionError' || err.name === 'MongooseServerSelectionError') console.error('Could not reach a database. Check local MongoDB, your internet connection, and the current IP entry in Atlas Network Access.');
    else if (err.name === 'MongoParseError') console.error('The MongoDB connection string is malformed. Check .env and encode special password characters.');
    else if (err.code === 11000) console.error('An Atlas uniqueness conflict was found. No case or stock records were overwritten.');
    else console.error('Migration failed:', err.name || 'Error', err.code || '', 'No source data was changed. Send this error code for help.');
    process.exitCode = 1;
  } finally {
    if (session) await session.endSession();
    if (source) await source.close();
    if (target) await target.close();
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main();
