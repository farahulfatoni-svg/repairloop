import mongoose from 'mongoose';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { readFile, writeFile, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export function makeConnection(template, password) {
  if (typeof template !== 'string' || !template.trim().startsWith('mongodb+srv://')) throw new Error('Copy the mongodb+srv:// connection template from your personal Atlas cluster.');
  let uri;
  try { uri = new URL(template.trim()); } catch { throw new Error('Could not read the connection template. Copy it again from Atlas.'); }
  if (!uri.hostname.endsWith('.mongodb.net')) throw new Error('This helper expects your MongoDB Atlas cluster hostname.');
  if (!uri.username || /db_username|your_username/i.test(decodeURIComponent(uri.username))) throw new Error('Select your actual database user in Atlas before copying the template.');
  if (typeof password !== 'string' || !password.length) throw new Error('A database-user password is required.');
  uri.password = encodeURIComponent(password);
  uri.pathname = '/repairloop';
  return uri.href;
}
export function updateEnvironment(text, uri) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter(line => !/^\s*(?:export\s+)?MONGODB_URI\s*=/.test(line));
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  return lines.join('\n') + '\nMONGODB_URI=' + uri + '\n';
}
export async function main() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) { console.error('Run this helper directly in your Mac Terminal so secrets can be entered privately.'); process.exitCode = 1; return; }
  const hiddenOutput = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
  // Node puts a terminal readline session in raw mode; its echo output is muted.
  const rl = createInterface({ input: process.stdin, output: hiddenOutput, terminal: true });
  const ask = async label => { process.stdout.write(label); const value = await rl.question(''); process.stdout.write('\n'); return value; };
  let connection;
  let temporary;
  try {
    console.log('Open your PERSONAL Atlas project → Connect → Drivers.');
    console.log('Copy the connection template for the database user whose password you know.');
    console.log('Both entries below are hidden while you type or paste.');
    const template = await ask('Paste the Atlas connection template, then press Return: ');
    const password = await ask('Enter that database user’s RAW password, then press Return: ');
    const uri = makeConnection(template, password);
    console.log('Verifying Atlas credentials…');
    connection = await mongoose.createConnection(uri, { serverSelectionTimeoutMS: 15000 }).asPromise();
    const info = await connection.db.admin().command({ hello: 1 });
    if (!info.setName && info.msg !== 'isdbgrid') throw new Error('Destination is not transaction-capable.');
    const envPath = path.resolve('.env');
    const oldText = await readFile(envPath, 'utf8').catch(err => { if (err.code === 'ENOENT') return ''; throw err; });
    temporary = path.resolve(`.env-atlas-${process.pid}.tmp`);
    await writeFile(temporary, updateEnvironment(oldText, uri), { mode: 0o600, flag: 'wx' });
    await rename(temporary, envPath); temporary = null;
    console.log('ATLAS VERIFIED. MONGODB_URI saved in .env; other settings preserved.');
    console.log('No repair cases, photos or stock records were modified.');
    if (process.env.MONGODB_URI && process.env.MONGODB_URI !== uri) console.log('Your shell has an older MONGODB_URI. Run: unset MONGODB_URI');
    console.log('Next run: node server/migrate-local-to-atlas.mjs');
  } catch (err) {
    if (err.code === 18 || err.code === 8000) console.error('Atlas rejected this database username/password. Check the user listed in this cluster’s Database Access and reset THAT user’s password, then retry. .env was not changed.');
    else if (['MongoServerSelectionError', 'MongooseServerSelectionError'].includes(err.name)) console.error('Could not reach Atlas. Check internet access and add your current IP in this project’s Network Access. .env was not changed.');
    else if (err.name === 'MongoParseError') console.error('Connection template was invalid. Copy it again from Atlas. .env was not changed.');
    else if (err.constructor === Error && !err.code && /^(Copy |Could not read |This helper |Select your |A database|Destination)/.test(err.message)) console.error(err.message);
    else console.error('Setup failed:', err.name || 'Error', err.code || '', 'Credentials were not displayed.');
    process.exitCode = 1;
  } finally {
    rl.close(); hiddenOutput.end();
    if (temporary) await unlink(temporary).catch(() => {});
    if (connection) await connection.close();
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main();
