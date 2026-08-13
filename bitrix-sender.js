import { chromium } from 'playwright';
import fs from 'fs/promises';

// Файл, куда сохраняются куки/storageState Битрикс24.
// Позволяет не логиниться паролем при каждом запуске — сессия восстанавливается.
const STORAGE_STATE_FILE = 'auth-state.json';

class BitrixSender {
  constructor() {
    this.browser = null;
    this.context = null;
    this.page = null;
    this.isAuthenticated = false;
  }

  async init() {
    const launchOptions = {
      headless: process.env.HEADLESS?.toLowerCase() === 'true'
    };

    // Используем системный Google Chrome вместо встроенного Chromium,
    // если в .env задано USE_SYSTEM_CHROME=true
    if (process.env.USE_SYSTEM_CHROME?.toLowerCase() === 'true') {
      launchOptions.channel = 'chrome';
    }

    this.browser = await chromium.launch(launchOptions);

    // Пытаемся восстановить сохранённую сессию (куки + localStorage),
    // чтобы не логиниться паролем каждый запуск.
    const contextOptions = {};
    const savedState = await this._loadStorageState();
    if (savedState) {
      contextOptions.storageState = savedState;
      console.log('Восстановлена сохранённая сессия Битрикс24');
    }

    this.context = await this.browser.newContext(contextOptions);
    this.page = await this.context.newPage();
  }

  async _loadStorageState() {
    try {
      const raw = await fs.readFile(STORAGE_STATE_FILE, 'utf-8');
      const state = JSON.parse(raw);
      if (state && state.cookies) return state;
    } catch {
      // файла нет или битый — логинимся с нуля
    }
    return null;
  }

  async _saveStorageState() {
    try {
      const state = await this.context.storageState();
      await fs.writeFile(STORAGE_STATE_FILE, JSON.stringify(state, null, 2));
    } catch (error) {
      console.warn(`Не удалось сохранить сессию: ${error.message}`);
    }
  }

  // На странице есть форма входа? (значит сессия протухла)
  async _isOnLoginPage() {
    try {
      await this.page.waitForSelector('input[name="USER_LOGIN"]', { timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }

  async login() {
    if (this.isAuthenticated) return;

    await this.page.goto(process.env.BITRIX_URL, { waitUntil: 'domcontentloaded' });

    if (await this._isOnLoginPage()) {
      // Сессии нет или она истекла — логинимся паролем
      await this.page.fill('input[name="USER_LOGIN"]', process.env.BITRIX_LOGIN);
      await this.page.fill('input[name="USER_PASSWORD"]', process.env.BITRIX_PASSWORD);
      await this.page.click('button[type="submit"]');

      // Ждём, пока форма входа исчезнет (значит, вошли)
      await this.page
        .waitForSelector('input[name="USER_LOGIN"]', { state: 'hidden', timeout: 20000 })
        .catch(() => {});
      console.log('Выполнен вход паролем');
    } else {
      console.log('Сессия жива, логин паролем не требуется');
    }

    this.isAuthenticated = true;
    // Сохраняем куки для следующих запусков
    await this._saveStorageState();
  }

  // Браузер/страница ещё живы? Если упали — пересоздаём с нуля
  // (сессия восстановится из auth-state.json, пароль нужен только если протух).
  async _ensureBrowser() {
    if (this.browser && this.browser.isConnected() && this.page && !this.page.isClosed()) return;
    console.log('Браузер недоступен, переинициализируем...');
    await this.close();
    await this.init();
  }

  async sendMessage({ chatName, message }) {
    await this._ensureBrowser();
    if (!this.isAuthenticated) {
      await this.login();
    }

    try {
      // Убеждаемся, что мы на странице мессенджера
      const currentUrl = this.page.url();
      if (!currentUrl.includes('/online/')) {
        const base = process.env.BITRIX_URL.replace(/\/$/, '');
        await this.page.goto(`${base}/online/`, { waitUntil: 'domcontentloaded' });
      }

      // Ищем чат по ТОЧНОМУ имени, чтобы "Оповещения" не совпадало с "Тестовые оповещения"
      const chat = this.page.getByText(chatName, { exact: true }).first();
      await chat.waitFor({ state: 'visible', timeout: 15000 });
      await chat.click();

      // Ждём появления поля ввода в открывшемся чате
      const messageInput = this.page.locator('textarea, [contenteditable="true"]').first();
      await messageInput.waitFor({ state: 'visible', timeout: 15000 });
      await messageInput.fill(message);
      await this.page.keyboard.press('Enter');

      // Даём немного времени на очистку поля (признак, что сообщение ушло).
      // Браузер НЕ закрываем — сессия переиспользуется для следующих сообщений очереди.
      await this.page.waitForTimeout(500);

      return { success: true, chatName, message };
    } catch (error) {
      // Браузер оставляем открытым (переиспользуем), но сбрасываем флаг авторизации,
      // чтобы при повторной попытке очередь заново проверила/восстановила сессию.
      this.isAuthenticated = false;
      throw new Error(`Ошибка отправки: ${error.message}`);
    }
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.context = null;
      this.page = null;
    }
    this.isAuthenticated = false;
  }
}

export default BitrixSender;