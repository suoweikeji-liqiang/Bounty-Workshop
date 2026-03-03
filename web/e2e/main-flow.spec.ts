import { expect, test } from '@playwright/test'

test('smoke flow: login and submit a problem', async ({ page }) => {
  const suffix = Date.now().toString().slice(-6)
  const problemTitle = `E2E-Problem-${suffix}`
  const editedProblemTitle = `${problemTitle}-Edited`

  await page.goto('/')
  await page.locator('.login-card button.ghost-btn').first().click()
  await page.locator('.login-card input[type="text"]').fill('admin')
  await page.locator('.login-card input[type="password"]').fill('e2e-admin-123')
  await page.locator('.login-card button[type="submit"]').click()
  await expect(page.locator('.topbar h1')).toBeVisible()

  await page.locator('a[href="#/problems"]').click()
  const filterHeading = page.getByRole('heading', { name: '问题筛选' })
  const listHeading = page.getByRole('heading', { name: '问题列表' })
  await expect(filterHeading).toBeVisible()
  await expect(listHeading).toBeVisible()
  const filterBox = await filterHeading.boundingBox()
  const listBox = await listHeading.boundingBox()
  expect(filterBox && listBox && filterBox.y < listBox.y).toBeTruthy()

  await page.getByRole('button', { name: '新建草稿' }).click()
  await expect(page).toHaveURL(/#\/problems\/new/)

  const submitForm = page.locator('form.panel').first()
  await expect(submitForm).toBeVisible()
  await submitForm.getByLabel('标题').fill(problemTitle)
  const textareas = submitForm.locator('textarea')
  await textareas.nth(0).fill('e2e background')
  await textareas.nth(1).fill('e2e description')
  await textareas.nth(2).fill('e2e value statement')
  await submitForm.getByRole('button', { name: '创建草稿' }).click()
  await expect(page).toHaveURL(/#\/problems(?:\?|$)/)

  await expect(page.locator('.panel .row', { hasText: problemTitle }).first()).toBeVisible()
  await page.locator('.row.problems-row', { hasText: problemTitle }).first().getByRole('button', { name: '编辑' }).click()
  await expect(page).toHaveURL(/#\/problems\/\d+\/edit/)

  const editForm = page.locator('form.panel').first()
  await editForm.getByLabel('标题').fill(editedProblemTitle)
  const editTextareas = editForm.locator('textarea')
  await editTextareas.nth(0).fill('e2e background edited')
  await editTextareas.nth(1).fill('e2e description edited')
  await editTextareas.nth(2).fill('e2e value statement edited')
  await editForm.getByRole('button', { name: '保存草稿' }).click()
  await expect(page).toHaveURL(/#\/problems(?:\?|$)/)
  await expect(page.locator('.panel .row', { hasText: editedProblemTitle }).first()).toBeVisible()

  await page.locator('a[href="#/tasks"]').click()
  await expect(page.locator('section.page-wrap')).toBeVisible()
  await page.locator('a[href="#/execution"]').click()
  await expect(page.locator('section.page-wrap')).toBeVisible()
})
