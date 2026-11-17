export async function saveProfile(displayName: string) {
  const response = await fetch('/api/profile', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ displayName }) });
  const result = await response.json().catch(() => null);
  return response.ok ? 'Saved' : result?.error || 'Could not save your profile. Try again.';
}
