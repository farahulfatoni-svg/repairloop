import { useEffect, useMemo, useState } from 'react';

const api = (url, options = {}) => fetch(`/api${url}`, { headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }, ...options }).then(async r => { const data = await r.json(); if (!r.ok) throw new Error(data.message || 'Request failed'); return data; });
const initial = { customer: { name: '', email: '', phone: '' }, device: { category: 'Mobile phone', brand: '', model: '', serialNumber: '', accessories: [], reportedFaults: '', photos: [] }, intake: { method: 'Walk-in' } };
const money = n => new Intl.NumberFormat('en-BD', { style: 'currency', currency: 'BDT', minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(n || 0);

function App() {
  const [cases, setCases] = useState([]); const [screen, setScreen] = useState('dashboard'); const [active, setActive] = useState(null); const [notice, setNotice] = useState('');
  const load = async () => { try { setCases(await api('/cases')); } catch (e) { setNotice('Could not connect to the API. Start MongoDB and the server.'); } };
  useEffect(() => { load(); }, []);
  const open = async c => { try { setNotice(''); const fresh = await api(`/cases/${c._id}`); setActive(fresh); setScreen('detail'); } catch (err) { setNotice(err.message || 'Could not open this case.'); } };
  const save = async (id, body) => { const c = await api(`/cases/${id}`, { method: 'PATCH', body: JSON.stringify(body) }); setActive(c); await load(); return c; };
  return <div className="shell"><aside><div className="brand"><i>↻</i><span>RepairLoop</span></div><p className="nav-title">MAIN MENU</p><button className={screen === 'dashboard' ? 'nav on' : 'nav'} onClick={() => setScreen('dashboard')}>▦ <span>Dashboard</span></button><button className={screen === 'new' ? 'nav on' : 'nav'} onClick={() => { setActive(null); setScreen('new'); }}>＋ <span>New repair case</span></button><button className={screen === 'execution' ? 'nav on' : 'nav'} onClick={() => setScreen('execution')}>✓ <span>Repair execution</span></button><div className="side-note"><b>Farah's workspace</b><small>Assessment · Quotation · Quality</small></div></aside><main><header><div><p className="eyebrow">REPAIR CENTRE PORTAL</p><h1>{screen === 'dashboard' ? 'Good morning, Farah' : screen === 'new' ? 'Create repair case' : screen === 'execution' ? 'Repair execution & quality' : active?.caseNumber}</h1></div><div className="avatar">FU</div></header>{notice && <div className="notice">{notice}</div>}{screen === 'dashboard' && <Dashboard cases={cases} open={open} newCase={() => setScreen('new')} />}{screen === 'new' && <NewCase done={c => { setActive(c); load(); setScreen('detail'); }} />}{screen === 'detail' && active && <CaseDetail caseData={active} save={save} reload={load} onUpdate={updated => { setActive(updated); setCases(previous => previous.map(item => item._id === updated._id ? updated : item)); }} />}{screen === 'execution' && <Execution cases={cases} open={open} />}</main></div>;
}

function Dashboard({ cases, open, newCase }) { const awaiting = cases.filter(c => c.status === 'Awaiting approval').length, active = cases.filter(c => ['Approved', 'In repair', 'Quality check'].includes(c.status)).length; return <><section className="hero"><div><span className="pill">OPERATIONS OVERVIEW</span><h2>Make every repair<br/>clear and accountable.</h2><p>From a customer's first report to a tested device ready for return.</p><button className="primary" onClick={newCase}>Create a repair case <b>→</b></button></div><div className="hero-art"><span>⌁</span><em>Every device<br/>deserves another loop.</em></div></section><section className="stats"><Stat label="All repair cases" value={cases.length}/><Stat label="Awaiting approval" value={awaiting}/><Stat label="Active repairs" value={active}/><Stat label="Ready for return" value={cases.filter(c => c.status === 'Ready for return').length}/></section><section className="panel"><div className="panel-head"><div><p className="eyebrow">RECENTLY UPDATED</p><h2>Repair cases</h2></div><button className="text-btn" onClick={newCase}>+ New case</button></div>{cases.length ? <div className="case-list">{cases.map(c => <button className="case-row" onClick={() => open(c)} key={c._id}><div className="device-icon">⌁</div><div><b>{c.device.brand} {c.device.model}</b><small>{c.caseNumber} · {c.customer.name}</small></div><span className={'status ' + c.status.toLowerCase().replaceAll(' ', '-')}>{c.status}</span><span className="arrow">→</span></button>)}</div> : <Empty title="No repair cases yet" text="Start by registering a customer's device and reported issue." action={newCase}/>}</section></> }
function Stat({ label, value }) { return <div className="stat"><span>{label}</span><strong>{value}</strong><i>↗</i></div> }

function IntakePhotoPreview({ file }) {
  const [url, setUrl] = useState('');
  useEffect(() => { const objectUrl = URL.createObjectURL(file); setUrl(objectUrl); return () => URL.revokeObjectURL(objectUrl); }, [file]);
  return <img src={url || undefined} alt={file.name} style={{ width: 120, height: 90, objectFit: 'cover', borderRadius: 4 }}/>;
}
function NewCase({ done }) {
  const [form, setForm] = useState(initial);
  const [accessories, setAccessories] = useState('');
  const [files, setFiles] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const change = (group, key, value) => setForm(previous => ({ ...previous, [group]: { ...previous[group], [key]: value } }));
  const chooseFiles = event => {
    const selected = [...event.target.files]; event.target.value = ''; setError('');
    const combined = [...files, ...selected];
    if (combined.length > 5) { setError('Attach at most five photos. Remove a photo before adding another.'); return; }
    if (combined.some(file => !['image/jpeg', 'image/png', 'image/webp'].includes(file.type))) { setError('Use JPG, PNG, or WebP photos.'); return; }
    if (combined.some(file => file.size > 5 * 1024 * 1024) || combined.reduce((sum, file) => sum + file.size, 0) > 10 * 1024 * 1024) { setError('Each photo must be 5 MB or less; all photos together must be 10 MB or less.'); return; }
    setFiles(combined);
  };
  const submit = async event => {
    event.preventDefault(); setError('');
    const names = accessories.split('\n').map(value => value.trim()).filter(Boolean);
    if (names.length > 20) { setError('Use at most 20 accessories, one per line.'); return; }
    setSaving(true);
    try {
      const body = new FormData();
      body.append('case', JSON.stringify({ ...form, device: { ...form.device, accessories: names } }));
      files.forEach(file => body.append('photos', file));
      const response = await fetch('/api/cases', { method: 'POST', body });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || 'Could not create the repair case.');
      done(result);
    } catch (err) { setError(err.message || 'Could not contact the server.'); }
    finally { setSaving(false); }
  };
  return <form className="form-card" onSubmit={submit}>
    {error && <div className="notice" role="alert" style={{ background: '#fff0ed', color: '#842029' }}>{error}</div>}
    <fieldset disabled={saving} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
      <Step n="01" title="Customer details"/>
      <div className="grid three"><Field label="Full name" value={form.customer.name} onChange={value => change('customer', 'name', value)} required maxLength={200}/><Field label="Email address" type="email" value={form.customer.email} onChange={value => change('customer', 'email', value)} maxLength={200}/><Field label="Phone number" value={form.customer.phone} onChange={value => change('customer', 'phone', value)} maxLength={100}/></div>
      <Step n="02" title="Device & issue"/>
      <div className="grid three"><Select label="Device category" value={form.device.category} onChange={value => change('device', 'category', value)} options={['Mobile phone', 'Laptop', 'Tablet', 'Desktop', 'Other']}/><Field label="Brand" value={form.device.brand} onChange={value => change('device', 'brand', value)} required maxLength={200}/><Field label="Model" value={form.device.model} onChange={value => change('device', 'model', value)} required maxLength={200}/><Field label="Serial / IMEI (optional)" value={form.device.serialNumber} onChange={value => change('device', 'serialNumber', value)} maxLength={200}/><Select label="Arrival method" value={form.intake.method} onChange={value => change('intake', 'method', value)} options={['Walk-in', 'Pickup']}/></div>
      <Field label="Reported faults" area value={form.device.reportedFaults} onChange={value => change('device', 'reportedFaults', value)} required maxLength={4000}/>
      <Step n="03" title="Accessories & condition photos"/>
      <Field label="Accompanying accessories (optional, one per line)" area value={accessories} onChange={setAccessories} placeholder={'Charger\nUSB cable\nProtective case'}/>
      <p><small>Attach up to five JPG, PNG, or WebP photos: 5 MB per photo, 10 MB total. Photos are saved with this case.</small></p>
      <label><span>Add condition photos (optional)</span><input type="file" multiple accept="image/jpeg,image/png,image/webp" onChange={chooseFiles}/></label>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginTop: 16 }}>{files.map((file, index) => <div key={`${file.name}-${index}`} style={{ width: 150 }}><IntakePhotoPreview file={file}/><p style={{ overflowWrap: 'anywhere', fontSize: 12 }}>{file.name}</p><button type="button" className="text-btn" onClick={() => setFiles(previous => previous.filter((_, i) => i !== index))}>Remove photo</button></div>)}</div>
      <div className="form-actions"><button className="primary" type="submit">{saving ? 'Saving request and photos…' : 'Create repair case →'}</button></div>
    </fieldset>
  </form>;
}
function SavedConditionPhotos({ data }) {
  return <section className="panel" style={{ marginBottom: 20 }}>
    <p><b>Accompanying accessories:</b> {data.device?.accessories?.length ? data.device.accessories.join(', ') : 'None recorded'}</p>
    <h3 style={{ marginTop: 16 }}>Condition photos</h3>
    {!data.conditionPhotos?.length ? <p><small>No condition photos were attached at submission.</small></p> : <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18 }}>{data.conditionPhotos.map(photo => <figure key={photo._id} style={{ margin: 0, width: 145 }}><a href={`/api/cases/${data._id}/photos/${photo._id}`} target="_blank" rel="noreferrer"><img src={`/api/cases/${data._id}/photos/${photo._id}`} alt={photo.filename} loading="lazy" style={{ width: 140, height: 105, objectFit: 'cover', borderRadius: 4 }}/></a><figcaption style={{ overflowWrap: 'anywhere', fontSize: 12, marginTop: 6 }}>{photo.filename}</figcaption></figure>)}</div>}
  </section>;
}

function Field({ label, value, onChange, area, ...props }) { return <label className={area ? 'wide' : ''}><span>{label}</span>{area ? <textarea value={value} onChange={e => onChange(e.target.value)} {...props}/> : <input value={value} onChange={e => onChange(e.target.value)} {...props}/>}</label> }
function Select({ label, value, onChange, options }) { return <label><span>{label}</span><select value={value} onChange={e => onChange(e.target.value)}>{options.map(x => <option key={x}>{x}</option>)}</select></label> }
function Step({ n, title }) { return <div className="step"><i>{n}</i><h2>{title}</h2></div> }

function CaseDetail({ caseData: c, save, reload, onUpdate }) {
  const [tab, setTab] = useState('assessment');
  const [draft, setDraft] = useState(c);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { setDraft(c); }, [c]);
  const diagnosis = draft.diagnosis || {};
  const intake = draft.intake || {};
  const current = draft.quotations?.[draft.quotations.length - 1];
  const closed = ['Ready for return', 'Closed - unrepairable', 'Repair unsuccessful'].includes(draft.status);
  const approved = current?.status === 'Accepted';
  const patch = (section, key, value) => setDraft(previous => ({ ...previous, [section]: { ...previous[section], [key]: value } }));
  const apply = updated => { setDraft(updated); onUpdate(updated); };
  const request = async (action, success) => {
    setBusy(true); setError(''); setMessage('');
    try { const result = await action(); apply(result); setMessage(success); return result; }
    catch (err) { setError(err.message || 'This change could not be saved.'); return null; }
    finally { setBusy(false); }
  };
  const saveAssessment = () => request(() => save(c._id, {
    intake, diagnosis: { ...diagnosis, assessedAt: new Date().toISOString() },
    status: diagnosis.unrepairable ? 'Closed - unrepairable' : draft.status === 'Submitted' && intake.receivedAt ? 'Assessing' : draft.status
  }), diagnosis.unrepairable ? 'Case closed as unrepairable. No quotation was issued.' : 'Assessment saved.');
  const issueQuotation = body => request(() => api(`/cases/${c._id}/quotation`, {
    method: 'POST', body: JSON.stringify({ ...body, expectedVersion: current?.version || 0 })
  }), 'Quotation issued. Record the customer decision below; repair work requires acceptance.');
  const respond = (version, decision, reason) => request(() => api(`/cases/${c._id}/quotation/${version}/respond`, {
    method: 'POST', body: JSON.stringify({ decision, reason })
  }), decision === 'Accepted' ? 'Quotation accepted. Repair work is now authorised.' : 'Quotation rejected. Repair work is not authorised.');
  const saveExecution = (overrides = {}) => request(() => save(c._id, {
    execution: overrides.execution || draft.execution,
    status: overrides.status || draft.execution?.stage || (draft.status === 'Quality check' ? 'Quality check' : 'In repair')
  }), overrides.execution?.outcome === 'Unsuccessful' ? 'Repair closed as unsuccessful. Actual quality results were retained for return and follow-up.' : overrides.execution?.outcome === 'Unrepairable' ? 'Repair closed as unrepairable. Actual quality results were retained for return and follow-up.' : overrides.status === 'Ready for return' ? 'All required checks passed. Device is ready for return.' : 'Repair progress saved.');
  const localDateTime = value => {
    if (!value) return '';
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '';
  };
  return <>
    <div className="crumb">Repair cases / <b>{c.caseNumber}</b></div>
    <div className="case-heading"><div className="device-icon large">⌁</div><div><h2>{c.device.brand} {c.device.model}</h2><p>{c.device.category} · {c.customer.name} · {c.device.reportedFaults}</p></div></div>
    <div className="tabs">{[['assessment', 'Assessment'], ['quotation', 'Quotation'], ['execution', 'Execution & quality']].map(([value, label]) => <button key={value} className={tab === value ? 'active' : ''} onClick={() => { setTab(value); setMessage(''); setError(''); }}>{label}</button>)}</div>
    {message && <div className="notice" role="status">{message}</div>}
    {error && <div className="notice" role="alert" style={{ color: '#842029', background: '#fff0ed' }}>{error}</div>}
    {tab === 'assessment' && <>
      <SavedConditionPhotos data={draft}/>
      <div className="section-title"><div><p className="eyebrow">INTAKE & DIAGNOSIS</p><h2>Assessment record</h2></div><span className="status">{draft.status}</span></div>
      {approved && <div className="notice">Approved scope and prices are locked. Use Quotation → Issue revised quotation to propose changes.</div>}
      <div className="detail-grid"><div className="form-card compact">
        <fieldset disabled={busy || closed} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
          <Step n="01" title="Physical receipt"/>
          <Field label="Received at the repair centre" type="datetime-local" value={localDateTime(intake.receivedAt)} onChange={value => patch('intake', 'receivedAt', value ? new Date(value).toISOString() : null)}/>
          <p><small>Confirm actual arrival before issuing a quotation. An existing receipt date cannot be removed.</small></p>
          <Field label="Physical condition" area value={intake.physicalCondition || ''} onChange={value => patch('intake', 'physicalCondition', value)}/>
          <Step n="02" title="Diagnostic findings"/>
          <Field label="Findings" area value={diagnosis.findings || ''} onChange={value => patch('diagnosis', 'findings', value)}/>
          <Field label="Faulty components" value={diagnosis.faultyComponents || ''} onChange={value => patch('diagnosis', 'faultyComponents', value)}/>
          <Field label="Recommended work" area value={diagnosis.recommendedWork || ''} onChange={value => patch('diagnosis', 'recommendedWork', value)} disabled={approved}/>
          <div className="grid two"><Field label="Estimated parts (BDT)" type="number" min="0" step="0.01" value={diagnosis.estimatedParts ?? ''} onChange={value => patch('diagnosis', 'estimatedParts', value === '' ? 0 : Number(value))} disabled={approved}/><Field label="Estimated labour (BDT)" type="number" min="0" step="0.01" value={diagnosis.estimatedLabour ?? ''} onChange={value => patch('diagnosis', 'estimatedLabour', value === '' ? 0 : Number(value))} disabled={approved}/></div>
          {!draft.quotations?.length && <div style={{ marginTop: 20 }}><label style={{ display: 'flex', alignItems: 'center', gap: 8 }}><input type="checkbox" style={{ width: 'auto' }} checked={!!diagnosis.unrepairable} onChange={event => patch('diagnosis', 'unrepairable', event.target.checked)}/><span>Assessment found this device unrepairable</span></label>{diagnosis.unrepairable && <Field label="Reason the device cannot be repaired" area value={diagnosis.unrepairableReason || ''} onChange={value => patch('diagnosis', 'unrepairableReason', value)}/>}</div>}
          <div className="form-actions"><button type="button" className="secondary" onClick={() => saveAssessment()}>{busy ? 'Saving…' : diagnosis.unrepairable ? 'Close unrepairable case' : 'Save assessment'}</button>{!diagnosis.unrepairable && <button className="primary" type="button" onClick={() => { setTab('quotation'); setMessage('Save your assessment before issuing a quotation.'); }}>Quotation →</button>}</div>
        </fieldset>
      </div><AiCard caseId={c._id} suggestions={draft.aiSuggestions || []} savedPhotos={draft.conditionPhotos || []} sourcePhotoId={draft.aiPhotoId || ''} onResult={(items, photoId) => { setDraft(previous => ({ ...previous, aiSuggestions: items, aiPhotoId: photoId })); reload(); }}/></div>
    </>}
    {tab === 'quotation' && <QuotationPanel key={c._id} data={draft} busy={busy} issue={issueQuotation} respond={respond} closed={closed}/>}
    {tab === 'execution' && <>
      {(!approved || closed) && <div className="notice">{closed ? 'This case is closed or ready for return. Its execution record is shown below.' : 'Repair work is locked until the latest quotation is accepted.'}</div>}
      <fieldset disabled={busy || !approved || closed} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}><RepairPanel data={draft} patch={patch} persist={saveExecution} savedTaskCount={c.execution?.tasks?.length || 0}/></fieldset>
      <PartsPanel data={draft} enabled={approved && !closed} onRecorded={updated => { setDraft(previous => ({ ...previous, execution: { ...previous.execution, partsUsed: updated.execution.partsUsed } })); reload(); }}/>
    </>}
  </>;
}

function QuotationPanel({ data, busy, issue, respond, closed }) {
  const quotations = data.quotations || [];
  const latest = quotations[quotations.length - 1];
  const [editing, setEditing] = useState(false);
  const [reason, setReason] = useState('');
  const issueAndClose = async body => { const result = await issue(body); if (result) setEditing(false); return result; };
  return <section className="panel quotes">
    <div className="panel-head"><div><p className="eyebrow">QUOTATION & CUSTOMER DECISION</p><h2>Repair quotation</h2></div><span className="status">{data.status}</span></div>
    <p style={{ marginBottom: 20 }}>Customer decision controls are available here for the university demo. A separate customer login is not included yet.</p>
    {!closed && !data.diagnosis?.unrepairable && latest && !editing && <button type="button" className="secondary" onClick={() => setEditing(true)}>Issue revised quotation</button>}
    {!closed && !data.diagnosis?.unrepairable && (!latest || editing) && <QuotationEditor key={`${data._id}-${latest?.version || 0}`} data={data} busy={busy} issue={issueAndClose} cancel={latest ? () => setEditing(false) : null}/>}
    {data.diagnosis?.unrepairable && <div className="notice">No quotation can be issued for a device assessed as unrepairable.</div>}
    {!latest && closed && <p>No quotation was issued for this case.</p>}
    {[...quotations].reverse().map(quotation => {
      const isLatest = quotation.version === latest?.version;
      const expired = quotation.status === 'Pending' && new Date(quotation.validUntil).getTime() <= Date.now();
      return <article key={quotation.version} className="form-card compact" style={{ marginTop: 20 }}>
        <div className="section-title"><div><span className="pill">VERSION {quotation.version}{!isLatest ? ' · HISTORY' : ''}</span><h2>{money(quotation.total)}</h2></div><span className="status">{expired ? 'Expired' : quotation.status}</span></div>
        <p><b>Approved work / proposed scope:</b> {quotation.scope || 'Scope was not captured for this older quotation.'}</p>
        <div style={{ overflowX: 'auto', marginTop: 16 }}><table style={{ width: '100%', textAlign: 'left', borderCollapse: 'collapse' }}><thead><tr><th>Description</th><th>Type</th><th>Qty</th><th>Unit price</th><th>Amount</th></tr></thead><tbody>{quotation.items.map((item, index) => <tr key={index}><td style={{ padding: '12px 8px 12px 0' }}>{item.description}</td><td>{item.type}</td><td>{item.quantity}</td><td>{money(item.unitPrice)}</td><td>{money(Math.round(item.unitPrice * 100) * item.quantity / 100)}</td></tr>)}</tbody></table></div>
        <p><b>Valid until:</b> {new Date(quotation.validUntil).toLocaleString()}</p><p><b>Warranty:</b> {quotation.warrantyTerms}</p>
        {quotation.respondedAt && <p><small>Decision recorded: {new Date(quotation.respondedAt).toLocaleString()}</small></p>}
        {quotation.decisionNote && <p><b>Customer note:</b> {quotation.decisionNote}</p>}
        {isLatest && quotation.status === 'Pending' && !closed && <>
          {expired && <div className="notice">This quotation has expired. Issue a revised quotation before acceptance.</div>}
          <Field label="Customer decision note (optional)" area value={reason} onChange={setReason} maxLength={2000} disabled={busy}/>
          <div className="form-actions"><button type="button" className="secondary" disabled={busy} onClick={() => respond(quotation.version, 'Rejected', reason)}>Reject quotation</button><button type="button" className="primary" disabled={busy || expired} onClick={() => respond(quotation.version, 'Accepted', reason)}>Accept quotation</button></div>
        </>}
        {isLatest && quotation.status === 'Rejected' && <div className="notice">Customer rejected this quotation. Repair work stays locked. Staff can issue a new proposal.</div>}
        {isLatest && quotation.status === 'Accepted' && <div className="notice">This version is accepted. Changes to prices, terms, or work must be issued as a new version.</div>}
      </article>;
    })}
  </section>;
}

function QuotationEditor({ data, busy, issue, cancel }) {
  const latest = data.quotations?.[data.quotations.length - 1];
  const [items, setItems] = useState(() => latest?.items?.length ? latest.items.map(item => ({ description: item.description, type: item.type, quantity: item.quantity, unitPrice: item.unitPrice })) : [
    { description: 'Required replacement part', type: 'Part', quantity: 1, unitPrice: data.diagnosis?.estimatedParts || 0 },
    { description: 'Repair labour', type: 'Labour', quantity: 1, unitPrice: data.diagnosis?.estimatedLabour || 0 }
  ]);
  const [scope, setScope] = useState(latest?.scope || data.diagnosis?.recommendedWork || '');
  const [warranty, setWarranty] = useState(latest?.warrantyTerms || '90 days warranty on completed repair work.');
  const [validUntil, setValidUntil] = useState(() => { const date = new Date(Date.now() + 7 * 86400000); return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10); });
  const updateItem = (index, key, value) => setItems(previous => previous.map((item, i) => i === index ? { ...item, [key]: value } : item));
  const total = items.reduce((sum, item) => sum + Math.round(Number(item.unitPrice || 0) * 100) * Number(item.quantity || 0), 0) / 100;
  const submit = async event => {
    event.preventDefault();
    await issue({ scope, warrantyTerms: warranty, validUntil: new Date(`${validUntil}T23:59:59.999`).toISOString(), items: items.map(item => ({ ...item, quantity: Number(item.quantity), unitPrice: Number(item.unitPrice) })) });
  };
  return <form onSubmit={submit} className="form-card compact" style={{ marginTop: 20 }}><fieldset disabled={busy} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
    <h3>{latest ? `Propose version ${latest.version + 1}` : 'Prepare quotation'}</h3>
    <p>First save physical receipt, condition, and diagnostic findings in Assessment. Issuing a revision pauses repairs until the customer accepts it.</p>
    <Field label="Repair scope" area value={scope} onChange={setScope} required maxLength={4000}/>
    {items.map((item, index) => <div key={index} style={{ padding: '16px 0', borderBottom: '1px solid #ead6c7' }}>
      <Field label={`Item ${index + 1}: description`} value={item.description} onChange={value => updateItem(index, 'description', value)} required maxLength={500}/>
      <div className="grid three"><Select label="Type" value={item.type} onChange={value => updateItem(index, 'type', value)} options={['Part', 'Labour']}/><Field label="Quantity" type="number" min="1" max="1000000" step="1" required value={item.quantity} onChange={value => updateItem(index, 'quantity', value)}/><Field label="Unit price (BDT)" type="number" min="0" max="1000000000" step="0.01" required value={item.unitPrice} onChange={value => updateItem(index, 'unitPrice', value)}/></div>
      <button type="button" className="text-btn" disabled={items.length <= 1} onClick={() => setItems(previous => previous.filter((_, i) => i !== index))}>Remove item</button>
    </div>)}
    <button type="button" className="secondary" disabled={items.length >= 50} style={{ marginTop: 16 }} onClick={() => setItems(previous => [...previous, { description: '', type: 'Part', quantity: 1, unitPrice: 0 }])}>+ Add item</button>
    <Field label="Valid through" type="date" value={validUntil} onChange={setValidUntil} required/>
    <Field label="Warranty duration and coverage terms" area value={warranty} onChange={setWarranty} required maxLength={4000}/>
    <h3>Total: {money(total)}</h3><div className="form-actions">{cancel && <button type="button" className="secondary" onClick={cancel}>Cancel revision</button>}<button type="submit" className="primary">{busy ? 'Issuing…' : latest ? 'Issue revised quotation' : 'Send for approval'}</button></div>
  </fieldset></form>;
}

function AiCard({ caseId, suggestions, onResult, savedPhotos = [], sourcePhotoId = '' }) {
  const [items, setItems] = useState(suggestions || []);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [dirty, setDirty] = useState(false);
  const [selectedPhoto, setSelectedPhoto] = useState(savedPhotos[0]?._id || '');
  const [analysedPhoto, setAnalysedPhoto] = useState(sourcePhotoId);
  useEffect(() => { setItems(suggestions || []); setDirty(false); }, [caseId, suggestions]);
  useEffect(() => { setError(''); setMessage(''); }, [caseId]);
  useEffect(() => { setAnalysedPhoto(sourcePhotoId); }, [caseId, sourcePhotoId]);
  useEffect(() => { setSelectedPhoto(previous => savedPhotos.some(photo => photo._id === previous) ? previous : savedPhotos[0]?._id || ''); }, [caseId, savedPhotos]);
  const update = (index, key, value) => { setItems(previous => previous.map((item, i) => i === index ? { ...item, [key]: value } : item)); setDirty(true); setMessage(''); };
  const runAnalysis = async body => {
    if ((dirty || items.length > 0) && !window.confirm('A successful new analysis will replace these observations and their review decisions. Continue?')) return;
    setError(''); setMessage(''); setLoading(true);
    try {
      const response = await fetch(`/api/cases/${caseId}/analyse-image`, { method: 'POST', body });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || 'Image analysis failed.');
      if (!Array.isArray(result.suggestions)) throw new Error('Unexpected response. Please try again.');
      setItems(result.suggestions); setAnalysedPhoto(result.photoId || ''); onResult(result.suggestions, result.photoId || ''); setDirty(false);
      setMessage(result.suggestions.length ? 'Analysis saved. Review each observation below.' : 'No visible-damage observations returned. Complete a physical inspection.');
    } catch (err) { setError(err.message || 'Could not contact the server.'); }
    finally { setLoading(false); }
  };
  const analyseUpload = async event => {
    const image = event.target.files?.[0]; event.target.value = '';
    if (!image) return;
    setError(''); setMessage('');
    if (image.size > 5 * 1024 * 1024) { setError('Image must be 5 MB or smaller.'); return; }
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(image.type)) { setError('Use a JPG, PNG, or WebP image.'); return; }
    const body = new FormData(); body.append('image', image); await runAnalysis(body);
  };
  const analyseSaved = () => { const body = new FormData(); body.append('photoId', selectedPhoto); return runAnalysis(body); };
  const saveReview = async () => {
    setSaving(true); setError(''); setMessage('');
    try {
      const result = await api(`/cases/${caseId}/ai-suggestions`, { method: 'PATCH', body: JSON.stringify({ suggestions: items }) });
      setItems(result.suggestions); onResult(result.suggestions, result.photoId || ''); setDirty(false);
      setMessage('Review saved. Accepted observations still require physical inspection.');
    } catch (err) { setError(err.message || 'Review could not be saved.'); }
    finally { setSaving(false); }
  };
  const busy = loading || saving;
  return <aside className="ai-card"><div className="ai-mark">✦</div><p className="eyebrow">GEMINI ASSIST</p><h2>Visual damage check</h2><p>Analyse a saved condition photo or upload a JPG, PNG, or WebP image up to 5 MB. Verify observations physically.</p>
    {savedPhotos.length > 0 && <div style={{ marginTop: 16 }}><label><span style={{ color: '#ffeac8' }}>Saved condition photo</span><select value={selectedPhoto} onChange={event => setSelectedPhoto(event.target.value)} disabled={busy}>{savedPhotos.map(photo => <option key={photo._id} value={photo._id}>{photo.filename}</option>)}</select></label><button type="button" className="primary" style={{ marginTop: 10 }} disabled={busy || !selectedPhoto} onClick={analyseSaved}>{loading ? 'Analysing…' : 'Analyse saved photo'}</button></div>}
    <label className="upload">{loading ? 'Analysing…' : 'Upload a photo for analysis'}<input type="file" accept="image/jpeg,image/png,image/webp" onChange={analyseUpload} disabled={busy}/></label>
    <p><small>Attach permanent condition photos when creating the repair case. This analysis upload only saves the observations.</small></p>
    {error && <p role="alert" style={{ background: '#fff0ed', color: '#842029', padding: 12, borderRadius: 8 }}>{error}</p>}
    {message && <p role="status">{message}</p>}
    {analysedPhoto && <p><b>Observations for:</b> {savedPhotos.find(photo => photo._id === analysedPhoto)?.filename || 'Saved condition photo'}</p>}
    {items.map((item, i) => <div className="suggestion" key={item._id || i}><Field label={`Observation ${i + 1}`} area value={item.label} onChange={value => update(i, 'label', value)} disabled={busy} maxLength={2000}/><small>Confidence: {item.confidence}</small>{item.originalLabel && item.originalLabel !== item.label && <small>Original: {item.originalLabel}</small>}<label><span style={{ color: '#ffeac8' }}>Technician decision</span><select value={item.decision || 'Pending'} onChange={event => update(i, 'decision', event.target.value)} disabled={busy}><option value="Pending">Pending review</option><option value="Accepted">Accept</option><option value="Rejected">Reject</option></select></label></div>)}
    {items.length > 0 && <><button type="button" className="primary" onClick={saveReview} disabled={busy || !dirty || items.some(item => !item.label.trim())}>{saving ? 'Saving…' : 'Save review'}</button>{dirty && <small style={{ display: 'block', marginTop: 8 }}>Unsaved review changes</small>}</>}
  </aside>;
}

function RepairPanel({ data, patch, persist, savedTaskCount = 0 }) {
  const execution = data.execution || {};
  const tasks = execution.tasks || [];
  const requiredNames = ['Power-on and charging', 'Core functionality', 'Final visual inspection'];
  const existing = execution.checks || [];
  const checks = [...existing, ...requiredNames.filter(name => !existing.some(check => check.name === name)).map(name => ({ name, result: 'Pending', notes: '' }))];
  const allPass = checks.length > 0 && checks.every(check => check.result === 'Pass');
  const tasksDone = tasks.every(task => task.status === 'Done');
  const technicianSet = !!execution.technician?.trim();
  const closed = ['Ready for return', 'Closed - unrepairable', 'Repair unsuccessful'].includes(data.status);
  const [closeOutcome, setCloseOutcome] = useState(execution.outcome === 'Unrepairable' ? 'Unrepairable' : 'Unsuccessful');
  const [closeReason, setCloseReason] = useState(execution.outcomeReason || '');
  useEffect(() => { setCloseOutcome(execution.outcome === 'Unrepairable' ? 'Unrepairable' : 'Unsuccessful'); setCloseReason(execution.outcomeReason || ''); }, [data._id, execution.outcome, execution.outcomeReason]);
  const changeTask = (index, key, value) => patch('execution', 'tasks', tasks.map((task, i) => i === index ? { ...task, [key]: value } : task));
  const changeCheck = (index, key, value) => patch('execution', 'checks', checks.map((check, i) => i === index ? { ...check, [key]: value } : check));
  const saveProgress = () => persist({ execution: { ...execution, tasks, checks, outcome: 'Pending' } });
  const finish = () => {
    if (!window.confirm('Mark this device successfully repaired and ready for return? The execution record will become read-only.')) return;
    return persist({ execution: { ...execution, tasks, checks, outcome: 'Repaired' }, status: 'Ready for return' });
  };
  const closeRepair = () => {
    if (!window.confirm(`Close this repair as ${closeOutcome.toLowerCase()}? Current task and quality results will be retained and the record will become read-only.`)) return;
    return persist({ execution: { ...execution, tasks, checks, outcome: closeOutcome, outcomeReason: closeReason }, status: closeOutcome === 'Unrepairable' ? 'Closed - unrepairable' : 'Repair unsuccessful' });
  };
  return <section className="execution-card">
    <div className="section-title"><div><p className="eyebrow">FEATURE 5</p><h2>Repair execution & quality verification</h2></div><span className="status">{data.status}</span></div>
    <div className="notice"><b>Authorised work:</b> {data.quotations?.[data.quotations.length - 1]?.scope || data.diagnosis?.recommendedWork || 'See the approved quotation.'}</div>
    {closed && <div className="notice"><b>Outcome:</b> {execution.outcome}{execution.outcomeReason && <p>{execution.outcomeReason}</p>}{execution.outcome !== 'Repaired' && <p>This device is closed for return unrepaired. Failed checks below remain recorded.</p>}</div>}
    <div className="grid two"><Field label="Assigned technician" value={execution.technician || ''} onChange={value => patch('execution', 'technician', value)} maxLength={200}/><Field label="Progress (%)" type="number" min="0" max="100" value={execution.progress ?? 0} onChange={value => patch('execution', 'progress', Number(value))}/></div>
    <div style={{ marginTop: 16 }}><Select label="Work stage" value={execution.stage || (data.status === 'Quality check' ? 'Quality check' : 'In repair')} onChange={value => patch('execution', 'stage', value)} options={['In repair', 'Quality check']}/></div>
    <Field label="Work notes" area value={execution.workNotes || ''} onChange={value => patch('execution', 'workNotes', value)} maxLength={8000} placeholder="Work performed and observations during this repair..."/>
    <Field label="Delay reason (if delayed)" area value={execution.delayReason || ''} onChange={value => patch('execution', 'delayReason', value)} maxLength={4000} placeholder="Explain the delay. Each blocked task also needs its own reason."/>
    <h3>Repair tasks</h3>
    <p><small>{tasks.filter(task => task.status === 'Done').length} of {tasks.length} completed · {tasks.filter(task => task.status === 'Blocked').length} blocked</small></p>
    {tasks.length === 0 && <p>No repair tasks recorded yet.</p>}
    {tasks.map((task, index) => <div key={task.id || index} style={{ border: '1px solid #ead9cb', padding: 16, marginBottom: 16 }}>
      <Field label={`Task ${index + 1}`} value={task.title} onChange={value => changeTask(index, 'title', value)} maxLength={300}/>
      <Select label="Task status" value={task.status} onChange={value => changeTask(index, 'status', value)} options={['Pending', 'In progress', 'Done', 'Blocked']}/>
      <Field label="Task notes" area value={task.notes || ''} onChange={value => changeTask(index, 'notes', value)} maxLength={4000}/>
      {(task.status === 'Blocked' || task.blockedReason) && <Field label={task.status === 'Blocked' ? 'Blocking reason (required)' : 'Previous blocking reason'} area value={task.blockedReason || ''} onChange={value => changeTask(index, 'blockedReason', value)} maxLength={4000}/>}
      {task.updatedAt && <p><small>Last updated: {new Date(task.updatedAt).toLocaleString()}</small></p>}
      {index >= savedTaskCount && !task.id && <button type="button" className="text-btn" onClick={() => patch('execution', 'tasks', tasks.filter((_, i) => i !== index))}>Remove unsaved task</button>}
    </div>)}
    {!closed && <button type="button" className="secondary" disabled={tasks.length >= 100} onClick={() => patch('execution', 'tasks', [...tasks, { title: '', status: 'Pending', notes: '', blockedReason: '' }])}>+ Add repair task</button>}
    <h3>Quality checklist</h3>
    {checks.map((check, index) => <div className="check" key={check.name}><b>{check.name}</b><select aria-label={`${check.name} result`} value={check.result} onChange={event => changeCheck(index, 'result', event.target.value)}><option>Pending</option><option>Pass</option><option>Fail</option></select><input aria-label={`${check.name} notes`} value={check.notes || ''} onChange={event => changeCheck(index, 'notes', event.target.value)} placeholder="Supporting notes" maxLength={4000}/></div>)}
    {!closed && <><div className="form-actions"><button type="button" className="secondary" onClick={saveProgress}>Save progress</button><button type="button" className="primary" disabled={!allPass || !tasksDone || !technicianSet} onClick={finish}>Mark ready for return →</button></div><p><small>Successful completion requires an assigned technician, every recorded task done, and every required quality check passed.</small></p>
      <div style={{ borderTop: '1px solid #ead9cb', marginTop: 28, paddingTop: 12 }}><h3>Close an unrepaired device</h3><p>Use this if the approved repair cannot be completed. The current checks and task statuses will stay recorded.</p><Select label="Repair outcome" value={closeOutcome} onChange={setCloseOutcome} options={['Unsuccessful', 'Unrepairable']}/><Field label="Closure reason (required)" area value={closeReason} onChange={setCloseReason} maxLength={4000}/><div className="form-actions"><button type="button" className="secondary" disabled={!technicianSet || !closeReason.trim()} onClick={closeRepair}>Close repair as {closeOutcome.toLowerCase()}</button></div></div>
    </>}
    <h3>Inspection history</h3>
    {!(execution.checkHistory || []).length && <p><small>No earlier inspection snapshots recorded.</small></p>}
    {[...(execution.checkHistory || [])].reverse().map((attempt, index) => <details key={attempt._id || index} style={{ padding: '12px 0', borderTop: '1px solid #ead9cb' }}><summary>Earlier inspection · {new Date(attempt.recordedAt).toLocaleString()}</summary>{attempt.checks.map((check, i) => <p key={i}><b>{check.name}:</b> {check.result}{check.notes ? ` — ${check.notes}` : ''}</p>)}</details>)}
    <h3>Saved work history</h3>
    {!(execution.workLog || []).length && <p><small>Progress history will appear after saving work with this update.</small></p>}
    {[...(execution.workLog || [])].reverse().map((entry, index) => <details key={entry._id || index} style={{ padding: '12px 0', borderTop: '1px solid #ead9cb' }}><summary>{new Date(entry.recordedAt).toLocaleString()} · {entry.progress}% · {entry.outcome === 'Pending' ? entry.stage : entry.outcome}</summary><p><b>Technician:</b> {entry.technician}</p>{entry.workNotes && <p><b>Work:</b> {entry.workNotes}</p>}{entry.delayReason && <p><b>Delay:</b> {entry.delayReason}</p>}{entry.outcomeReason && <p><b>Outcome reason:</b> {entry.outcomeReason}</p>}{entry.tasks?.map((task, i) => <p key={task.id || i}><b>{task.title}:</b> {task.status}{task.blockedReason ? ` — ${task.blockedReason}` : ''}{task.notes ? ` · ${task.notes}` : ''}</p>)}{entry.checks?.map((check, i) => <p key={i}><b>{check.name}:</b> {check.result}{check.notes ? ` — ${check.notes}` : ''}</p>)}</details>)}
  </section>;
}

function PartsPanel({ data, enabled, onRecorded }) {
  const [parts, setParts] = useState([]);
  const [selected, setSelected] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [confirmed, setConfirmed] = useState(false);
  const [showOthers, setShowOthers] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [requestId, setRequestId] = useState('');
  const load = async () => {
    setLoading(true);
    try {
      const result = await api(`/cases/${data._id}/parts`);
      setParts(result); setSelected(previous => result.some(part => part._id === previous && part.compatible) ? previous : result.find(part => part.compatible && part.availableQuantity > 0)?._id || '');
    } catch (err) { setError(err.message || 'Could not load stock.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [data._id]);
  const part = parts.find(item => item._id === selected);
  const used = data.execution?.partsUsed || [];
  const record = async () => {
    setError(''); setMessage('');
    if (!part || !confirmed || !Number.isInteger(Number(quantity)) || Number(quantity) < 1) { setError('Choose a part, whole-number quantity and confirm the approved scope.'); return; }
    if (!window.confirm(`Record ${quantity} unit(s) of ${part.name} as used? Available stock will decrease.`)) return;
    const operationId = requestId || crypto.randomUUID(); setRequestId(operationId); setSaving(true);
    try {
      const updated = await api(`/cases/${data._id}/parts/consume`, { method: 'POST', body: JSON.stringify({ partId: selected, quantity: Number(quantity), operationId, withinApprovedScope: confirmed }) });
      onRecorded(updated); setMessage('Parts consumption saved and stock reduced.'); setRequestId(''); setConfirmed(false); await load();
    } catch (err) { setError(err.message || 'Parts consumption could not be saved.'); }
    finally { setSaving(false); }
  };
  return <section className="execution-card">
    <div className="section-title"><div><p className="eyebrow">PARTS FOR THIS REPAIR</p><h2>Compatibility & consumption</h2></div><button type="button" className="text-btn" disabled={loading || saving} onClick={() => { setError(''); load(); }}>Refresh stock</button></div>
    <p>Device: <b>{data.device.category} · {data.device.brand} {data.device.model}</b></p>
    <p><small>Compatibility uses the device category, brand and model recorded in stock. Staff must also verify the actual part and approved repair scope.</small></p>
    {parts.some(item => item.demoOnly) && <div className="notice">Demo-labelled items are fictional test stock. Their compatibility and quantities are for this university demonstration.</div>}
    {error && <div className="notice" role="alert" style={{ background: '#fff0ed', color: '#842029' }}>{error}</div>}
    {message && <div className="notice" role="status">{message}</div>}
    {loading && <p>Loading stock…</p>}
    {!loading && !parts.some(item => item.compatible) && <p>No compatible stock is recorded for this device. Inventory staff must add the correct compatibility records.</p>}
    <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}><input type="checkbox" style={{ width: 'auto' }} checked={showOthers} onChange={event => setShowOthers(event.target.checked)}/><span>Show parts for other device models</span></label>
    <div style={{ overflowX: 'auto' }}><table style={{ width: '100%', textAlign: 'left' }}><thead><tr><th>Part / stock code</th><th>Available</th><th>Compatibility</th></tr></thead><tbody>{parts.filter(item => showOthers || item.compatible).map(item => <tr key={item._id}><td style={{ padding: '10px 8px 10px 0' }}>{item.name}<br/><small>{item.stockCode}{item.demoOnly ? ' · DEMO' : ''}</small></td><td>{item.availableQuantity}</td><td>{item.compatible ? 'Recorded match' : 'Incompatible'}</td></tr>)}</tbody></table></div>
    {!enabled && <div className="notice">Parts consumption requires an active repair with the latest quotation accepted.</div>}
    <fieldset disabled={!enabled || saving || loading} style={{ border: 0, padding: 0, margin: '18px 0 0', minWidth: 0 }}>
      <label><span>Compatible part to record as used</span><select value={selected} onChange={event => { setSelected(event.target.value); setConfirmed(false); setRequestId(''); }}><option value="">Choose a part</option>{parts.filter(item => item.compatible).map(item => <option key={item._id} value={item._id} disabled={item.availableQuantity < 1}>{item.name} — {item.availableQuantity} available</option>)}</select></label>
      <Field label="Quantity used" type="number" min="1" max={Math.min(part?.availableQuantity || 1, 1000)} step="1" value={quantity} onChange={value => { setQuantity(Number(value)); setConfirmed(false); setRequestId(''); }}/>
      <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginTop: 16 }}><input type="checkbox" style={{ width: 'auto', marginTop: 3 }} checked={confirmed} onChange={event => setConfirmed(event.target.checked)}/><span>I verified this part is included in the approved repair scope. Additional work requires a revised quotation.</span></label>
      <div className="form-actions"><button type="button" className="primary" disabled={!part || !confirmed || quantity < 1 || !Number.isInteger(quantity) || quantity > (part?.availableQuantity || 0) || !data.execution?.technician?.trim()} onClick={record}>{saving ? 'Recording…' : 'Record parts consumption'}</button></div>
      {!data.execution?.technician?.trim() && <p><small>Assign a technician and save repair progress first.</small></p>}
    </fieldset>
    <h3>Parts recorded against this case</h3>
    {!used.length && <p><small>No parts consumed yet.</small></p>}
    {used.map((item, index) => <div key={item._id || index} style={{ padding: '12px 0', borderTop: '1px solid #ead9cb' }}><b>{item.partName}</b><p>Quantity: {item.quantity} · {item.stockCode || 'Legacy entry'}{item.quotationVersion ? ` · Quotation v${item.quotationVersion}` : ''}</p>{item.consumedAt && <small>{new Date(item.consumedAt).toLocaleString()} · {item.consumedBy || 'Technician'}</small>}</div>)}
  </section>;
}

function Execution({ cases, open }) { const ready = cases.filter(c => ['Approved','In repair','Quality check'].includes(c.status)); return <section className="panel"><div className="panel-head"><div><p className="eyebrow">APPROVED REPAIRS</p><h2>Work queue</h2></div></div>{ready.length ? <div className="case-list">{ready.map(c=><button className="case-row" onClick={()=>open(c)} key={c._id}><div className="device-icon">⌁</div><div><b>{c.device.brand} {c.device.model}</b><small>{c.caseNumber} · {c.customer.name}</small></div><span className={'status '+c.status.toLowerCase().replaceAll(' ','-')}>{c.status}</span><span className="arrow">→</span></button>)}</div> : <Empty title="No approved repairs in queue" text="Once a customer accepts a quotation, their case will appear here."/>}</section> }
function Empty({ title, text, action }) { return <div className="empty"><div>⌁</div><h3>{title}</h3><p>{text}</p>{action && <button className="primary" onClick={action}>Create repair case →</button>}</div> }
export default App;
