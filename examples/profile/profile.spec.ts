// Independent regression test: requires only Playwright Test and the running local demo.
import { test, expect } from '@playwright/test';
const origin = process.env.PROFILE_URL || 'http://127.0.0.1:5173';
test('profile update survives reload; rejected updates preserve the saved name', async ({ page, request }) => {
  await page.goto(origin);
  await page.getByLabel('Display name').fill('Casey Morgan');
  await page.getByRole('button', { name: 'Save profile' }).click();
  await expect(page.getByRole('status')).toHaveText('Saved');
  await page.reload(); await expect(page.getByLabel('Display name')).toHaveValue('Casey Morgan');
  await page.getByLabel('Display name').fill('');
  await page.getByRole('button', { name: 'Save profile' }).click();
  await expect(page.getByRole('status')).toHaveText('Enter a display name between 2 and 50 characters.');
  await page.reload(); await expect(page.getByLabel('Display name')).toHaveValue('Casey Morgan');
  const forbidden = await request.patch(origin + '/api/profile', { data: { displayName: 'Unauthorized edit' }, headers: { Origin: origin } });
  expect(forbidden.status()).toBe(403);
  await page.reload(); await expect(page.getByLabel('Display name')).toHaveValue('Casey Morgan');
});
