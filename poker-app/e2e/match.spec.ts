import { expect, test, type Page } from '@playwright/test';

const shot = (page: Page, name: string) =>
  process.env.E2E_SCREENSHOTS ? page.screenshot({ path: `${process.env.E2E_SCREENSHOTS}/${name}.png`, fullPage: true }) : null;

/** 手番のプレイヤーがいれば、オールインまたはコールで進める。 */
async function playStep(page: Page): Promise<boolean> {
  const allIn = page.getByRole('button', { name: '全額' });
  if (await allIn.isVisible()) {
    await allIn.click();
    await page.getByRole('button', { name: /^オールイン/ }).click();
    return true;
  }
  for (const name of [/^コール/, /^チェック/]) {
    const b = page.getByRole('button', { name });
    if (await b.isVisible()) {
      await b.click();
      return true;
    }
  }
  return false;
}

test('two players create, configure, play and rematch a match', async ({ browser }) => {
  const hostCtx = await browser.newContext({ ...test.info().project.use });
  const guestCtx = await browser.newContext({ ...test.info().project.use });
  const host = await hostCtx.newPage();
  const guest = await guestCtx.newPage();

  // ホストが部屋を作る
  await host.goto('/');
  await shot(host, '01-home');
  await host.getByRole('button', { name: '部屋を作る' }).click();
  await host.getByLabel(/ニックネーム/).fill('ホスト太郎');
  await host.getByRole('button', { name: '作成する' }).click();
  await expect(host.getByRole('heading', { name: 'ロビー' })).toBeVisible();
  const roomUrl = await host.locator('#share-url').inputValue();
  expect(roomUrl).toMatch(/\/r\/[A-Za-z0-9]{10}$/);

  // ホストが設定を変える
  await host.getByRole('button', { name: /ターボ/ }).click();
  await host.getByLabel('初期スタック', { exact: true }).fill('2000');
  await host.getByRole('button', { name: 'BBアンテ' }).click();
  await expect(host.getByText('編集済み')).toBeVisible();

  // ゲストが参加して、同じ設定が見える
  await guest.goto(new URL(roomUrl).pathname);
  await expect(guest.getByRole('heading', { name: 'ホスト太郎さんの部屋に参加' })).toBeVisible();
  await guest.getByLabel(/ニックネーム/).fill('ゲスト花子');
  await guest.getByRole('button', { name: '参加する' }).click();
  await expect(guest.getByLabel('初期スタック', { exact: true })).toHaveValue('2,000');
  await expect(guest.getByLabel('初期スタック', { exact: true })).toBeDisabled();
  await expect(host.getByText('ゲスト花子', { exact: true })).toBeVisible();
  await shot(host, '02-lobby-host');
  await shot(guest, '03-lobby-guest');

  // 3人目は入れない
  const thirdCtx = await browser.newContext({ ...test.info().project.use });
  const third = await thirdCtx.newPage();
  await third.goto(new URL(roomUrl).pathname);
  await expect(third.getByRole('heading', { name: 'この部屋は満席です' })).toBeVisible();
  await thirdCtx.close();

  // 準備OK → カウントダウン → 対戦開始
  await guest.getByRole('button', { name: '準備OK' }).click();
  await expect(host.getByText('まもなく対戦開始')).toBeVisible();
  await expect(host.getByText('Lv.1', { exact: true })).toBeVisible();
  await expect(guest.getByText('Lv.1', { exact: true })).toBeVisible();
  await expect(host.getByText('#1')).toBeVisible();

  // 自分の手札は見え、相手の手札は伏せられている
  await expect(host.locator('.seat.self .card:not(.back)')).toHaveCount(2);
  await expect(host.locator('.seat.opponent .card.back')).toHaveCount(2);
  await shot(host, '04-game-host');
  await shot(guest, '05-game-guest');

  // 一時停止と再開
  await host.getByRole('button', { name: 'メニュー' }).click();
  await host.getByRole('button', { name: '一時停止' }).click();
  await expect(guest.getByRole('heading', { name: '一時停止中' })).toBeVisible();
  await shot(guest, '06-paused');
  await guest.getByRole('button', { name: '再開する' }).click();
  await expect(guest.getByRole('heading', { name: '一時停止中' })).toBeHidden({ timeout: 10_000 });

  // 決着がつくまでオールインとコールを繰り返す
  let sawRunout = false;
  for (let i = 0; i < 400; i++) {
    if (await host.getByText('試合終了').isVisible()) break;
    const acted = (await playStep(host)) || (await playStep(guest));
    if (!sawRunout && (await host.locator('.board-banner.allin').isVisible())) {
      sawRunout = true;
      await shot(host, '07-allin-runout');
    }
    if (!acted) await host.waitForTimeout(250);
  }
  await expect(host.getByText('試合終了')).toBeVisible();
  await expect(guest.getByText('試合終了')).toBeVisible();
  await shot(host, '08-result-host');

  // ハンド履歴
  await host.getByRole('button', { name: 'ハンド履歴' }).click();
  await expect(host.getByRole('dialog', { name: 'ハンド履歴' })).toBeVisible();
  await host.locator('.history-summary').first().click();
  await expect(host.locator('.history-detail')).toBeVisible();
  await shot(host, '09-history');
  await host.getByRole('button', { name: '閉じる' }).click();

  // リマッチでロビーに戻る（設定はそのまま）
  await host.getByRole('button', { name: 'リマッチ' }).click();
  await expect(guest.getByText('ホスト太郎さんがリマッチを希望しています')).toBeVisible();
  await guest.getByRole('button', { name: 'リマッチを受ける' }).click();
  await expect(host.getByRole('heading', { name: 'ロビー' })).toBeVisible();
  await expect(guest.getByLabel('初期スタック', { exact: true })).toHaveValue('2,000');

  // リロードしても同じ席に戻る
  await guest.reload();
  await expect(guest.getByRole('button', { name: '準備OK' })).toBeVisible();

  await hostCtx.close();
  await guestCtx.close();
});
