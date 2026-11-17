// Seeded demonstration: this intentionally submits the wrong field and ignores rejection.
export async function saveProfile(displayName: string) {
  await fetch('/api/profile', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ display_name: displayName }) });
  return 'Saved';
}
