import { expect, test } from '@playwright/test'

test('smoke flow: login and submit a problem', async ({ page }) => {
  const suffix = Date.now().toString().slice(-6)
  const problemTitle = `E2E-Problem-${suffix}`

  await page.goto('/')
  await page.locator('.login-card button[type="submit"]').click()
  await expect(page.locator('.topbar h1')).toBeVisible()

  await page.locator('a[href="#/problems"]').click()
  const submitForm = page.locator('form').first()
  await expect(submitForm.locator('input').first()).toBeVisible()
  await submitForm.locator('input').first().fill(problemTitle)
  const textareas = submitForm.locator('textarea')
  await textareas.nth(0).fill('e2e background')
  await textareas.nth(1).fill('e2e description')
  await textareas.nth(2).fill('e2e value statement')
  await submitForm.locator('button.primary-btn').first().click()

  await expect(page.locator('.panel .row', { hasText: problemTitle }).first()).toBeVisible()

  await page.locator('a[href="#/tasks"]').click()
  await expect(page.locator('section.page-wrap')).toBeVisible()
  await page.locator('a[href="#/execution"]').click()
  await expect(page.locator('section.page-wrap')).toBeVisible()
})
