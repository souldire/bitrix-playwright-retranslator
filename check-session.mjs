// Одноразовая проверка: жива ли сессия из auth-state.json.
// Запуск: node check-session.mjs — браузер headless, никаких окон не открывает.
import { chromium } from 'playwright';
import fs from 'fs/promises';
import dotenv from 'dotenv';

dotenv.config();

const state = JSON.parse(await fs.readFile('auth-state.json', 'utf-8'));
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ storageState: state });
  const page = await context.newPage();
  await page.goto(process.env.BITRIX_URL, { waitUntil: 'domcontentloaded' });

  let loginFormVisible = false;
  try {
    await page.waitForSelector('input[name="USER_LOGIN"]', { timeout: 8000 });
    loginFormVisible = true;
  } catch {}

  console.log('URL:', page.url());
  console.log(loginFormVisible ? 'SESSION_DEAD' : 'SESSION_ALIVE');
} finally {
  await browser.close();
}
