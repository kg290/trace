import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
// @ts-expect-error Vite selects the broken fixture or the working implementation.
import { saveProfile } from '@save';
import './style.css';

function Profile() {
  const [name, setName] = useState('');
  const [message, setMessage] = useState('Loading profile…');
  const [busy, setBusy] = useState(true);
  useEffect(() => { fetch('/api/profile').then(r => { if (!r.ok) throw new Error('load'); return r.json(); }).then(data => { setName(data.displayName); setMessage(''); }).catch(() => setMessage('Could not load your profile. Reload to retry.')).finally(() => setBusy(false)); }, []);
  return <main><p className="eyebrow">TRACE / SEEDED DEMONSTRATION</p><h1>A small change.<br/>A familiar mystery.</h1><p className="intro">Update your profile, save it, then reload the page.</p><form onSubmit={async e => { e.preventDefault(); setBusy(true); try { setMessage(await saveProfile(name)); } catch { setMessage('Could not reach the server. Try again.'); } finally { setBusy(false); } }}><label htmlFor="display-name">Display name</label><input id="display-name" name="displayName" value={name} onChange={e => setName(e.target.value)} disabled={busy} autoComplete="off"/><div className="row"><button disabled={busy} type="submit">{busy ? 'Please wait…' : 'Save profile'}</button><p role="status">{message}</p></div></form><footer>Local test data only · Real Node persistence · Server validation enabled</footer></main>;
}
createRoot(document.getElementById('root')!).render(<Profile/>);
