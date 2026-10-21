'use strict';
exports.navigate = async (page, id) => {
  const { NAV } = await import('../src/renderer/navigation.mjs');
  const group = NAV.find(g => g.pages.some(([key]) => key === id));
  if (!group) throw new Error('Unknown test route: ' + id);
  await page.click(`[data-group="${group.id}"]`);
  await page.click(`[data-view="${id}"]`);
};
exports.confirmOperation = async (page, accept = true) => {
  await page.locator('[data-confirm-operation]').waitFor();
  await page.locator('#feature-dialog').getByRole('button', { name: accept ? '确认执行' : '返回', exact: true }).click();
};
