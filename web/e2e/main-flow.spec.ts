import { expect, test } from '@playwright/test'

test('main workflow: problem -> review -> claim -> deliverable -> acceptance -> reward', async ({
  page,
}) => {
  const suffix = Date.now().toString().slice(-6)
  const problemTitle = `E2E问题-${suffix}`
  const taskTitle = `E2E任务-${suffix}`

  await page.goto('/')
  await expect(page.getByRole('heading', { name: '揭榜挂帅前端控制台' })).toBeVisible()

  await page.getByRole('link', { name: '问题池' }).click()
  await page.getByLabel('标题').fill(problemTitle)
  await page.getByLabel('背景').fill('端到端测试背景')
  await page.getByLabel('问题描述').fill('端到端测试问题描述')
  await page.getByLabel('价值说明').fill('端到端测试价值说明')
  await page.getByRole('button', { name: '提交问题' }).click()
  await expect(page.getByText('问题已提交')).toBeVisible()

  await page.getByRole('link', { name: '审核立项' }).click()
  await expect(page.getByRole('heading', { name: '问题审核与任务定义' })).toBeVisible()
  const pendingRow = page.locator('.row.wide-row', { hasText: problemTitle }).first()
  await expect(pendingRow).toBeVisible()
  await pendingRow.getByRole('button', { name: '选择' }).click()

  await page.getByLabel('任务标题').fill(taskTitle)
  await page.getByLabel('任务目标').fill('自动化目标')
  await page.getByLabel('范围（做什么/不做什么）').fill('范围说明')
  await page.getByLabel('激励总额').fill('600')
  await page.getByLabel('提出人比例（0.2-0.3）').fill('0.3')
  await page.getByLabel('积分').fill('10')
  const criteriaInput = page.locator('.acceptance-editor').first().getByLabel('描述')
  await criteriaInput.fill('验收项：流程可复现')
  await page.getByRole('button', { name: '立项并生成任务' }).click()
  await expect(page.getByText('已立项')).toBeVisible()

  await page.getByRole('link', { name: '任务大厅' }).click()
  await expect(page.getByRole('heading', { name: '任务大厅' })).toBeVisible()
  const taskRow = page.locator('.row.wide-row', { hasText: taskTitle }).first()
  await expect(taskRow).toBeVisible()
  await taskRow.getByRole('button', { name: '个人揭榜' }).click()
  await page.getByRole('button', { name: '提交揭榜' }).click()
  await expect(page.getByText('揭榜成功')).toBeVisible()

  const claimMessage = (await page.locator('.ok-text').first().textContent()) ?? ''
  const claimMatch = claimMessage.match(/claim_id=(\d+)/)
  expect(claimMatch).not.toBeNull()
  const claimId = claimMatch?.[1] ?? ''

  await page.getByRole('link', { name: '执行闭环' }).click()
  await expect(page.getByRole('heading', { name: '执行闭环' })).toBeVisible()
  await page.getByLabel('claim_id').fill(claimId)
  await page.getByLabel('summary').fill('E2E 成果提交')
  await page.getByRole('button', { name: 'submit deliverable' }).click()
  await expect(page.getByText('deliverable submitted')).toBeVisible()

  const pendingSection = page.locator('article.panel', { hasText: '待我验收' })
  const acceptanceRow = pendingSection.locator('.row.wide-row', { hasText: `#${claimId}` }).first()
  await expect(acceptanceRow).toBeVisible()
  await acceptanceRow.getByRole('button', { name: 'acceptance panel' }).click()
  await pendingSection.getByRole('button', { name: 'submit acceptance' }).first().click()
  await expect(page.getByText('acceptance submitted: approved')).toBeVisible()

  const rewardSection = page.locator('article.panel', { hasText: '激励确认' })
  await rewardSection.getByRole('button', { name: 'confirm' }).first().click()
  await expect(rewardSection.getByText('confirmed').first()).toBeVisible()
})
