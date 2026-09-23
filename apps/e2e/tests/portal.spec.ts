import { expect, test } from '@playwright/test';

test('opens a private portal route through its real session gate', async ({ page }) => {
  await page.goto('/messages');

  await expect(page).toHaveURL(/\/messages$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Messages' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Sign in' })).toHaveCount(0);
});
