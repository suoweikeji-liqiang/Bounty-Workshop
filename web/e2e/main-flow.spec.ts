import { expect, test } from '@playwright/test'

test('main workflow: problem -> review -> claim -> deliverable -> acceptance -> reward', async ({
  page,
}) => {
  const suffix = Date.now().toString().slice(-6)
  const problemTitle = `E2E-problem-${suffix}`
  const taskTitle = `E2E-task-${suffix}`

  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Sign In' })).toBeVisible()
  await page.getByRole('button', { name: 'sign in', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Bounty Task Console' })).toBeVisible()

  await page.getByRole('link', { name: 'Problems' }).click()
  const problemForm = page.locator('form.panel.form-grid').first()
  await problemForm.locator('input').first().fill(problemTitle)
  await problemForm.locator('textarea').nth(0).fill('e2e background')
  await problemForm.locator('textarea').nth(1).fill('e2e description')
  await problemForm.locator('textarea').nth(2).fill('e2e value statement')
  await problemForm.locator('button[type="submit"]').click()
  await expect(page.locator('.row', { hasText: problemTitle }).first()).toBeVisible()

  await page.getByRole('link', { name: 'Review' }).click()
  const pendingRow = page.locator('.row.wide-row', { hasText: problemTitle }).first()
  await expect(pendingRow).toBeVisible()
  await pendingRow.getByRole('button').first().click()

  const approveForm = page.locator('form.panel.form-grid').first()
  await approveForm.locator('input').first().fill(taskTitle)
  await approveForm.locator('textarea').nth(0).fill('automation goal')
  await approveForm.locator('textarea').nth(1).fill('scope details')
  await approveForm.locator('input[type="number"]').nth(0).fill('600')
  await approveForm.locator('input[type="number"]').nth(1).fill('0.3')
  await approveForm.locator('input[type="number"]').nth(2).fill('10')
  await approveForm.locator('.acceptance-editor input').first().fill('criteria from e2e')
  await approveForm.locator('button[type="submit"]').click()

  await page.getByRole('link', { name: 'Task Hall' }).click()
  await expect(page.getByRole('heading', { name: 'Task Hall' })).toBeVisible()
  const taskRow = page.locator('.row.wide-row', { hasText: taskTitle }).first()
  await expect(taskRow).toBeVisible()
  await taskRow.getByRole('button', { name: 'quick claim' }).click()
  await page.getByRole('button', { name: 'submit claim' }).click()

  await page.getByRole('link', { name: 'Execution' }).click()
  const claimRow = page.locator('.row.wide-row', { hasText: taskTitle }).first()
  await expect(claimRow).toBeVisible()
  const claimIdText = (await claimRow.locator('span').first().textContent()) ?? ''
  const claimId = claimIdText.replace('#', '').trim()
  expect(claimId).not.toBe('')
  await page.getByLabel('claim_id').fill(claimId)
  await page.getByLabel('summary').fill('E2E deliverable')
  await page.getByRole('button', { name: 'submit deliverable' }).click()
  await expect(page.getByText('deliverable submitted')).toBeVisible()

  await page.getByRole('button', { name: 'acceptance panel' }).first().click()
  await page.getByRole('button', { name: 'submit acceptance' }).first().click()
  await expect(page.getByText('acceptance submitted: approved')).toBeVisible()

  await page.getByRole('button', { name: 'confirm' }).first().click()
  await expect(page.getByText('confirmed').first()).toBeVisible()
})
