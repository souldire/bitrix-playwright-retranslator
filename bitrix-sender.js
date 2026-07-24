import { chromium } from 'playwright';

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
    this.context = await this.browser.newContext();
    this.page = await this.context.newPage();
  }


  async login() {
    try {
      await this.page.goto(process.env.BITRIX_URL);
      await this.page.fill('input[name="USER_LOGIN"]', process.env.BITRIX_LOGIN);
      await this.page.fill('input[name="USER_PASSWORD"]', process.env.BITRIX_PASSWORD);
      await this.page.click('button[type="submit"]');
      
      await this.page.waitForTimeout(5000);
      this.isAuthenticated = true;
    } catch (error) {
      throw new Error(`Ошибка авторизации: ${error.message}`);
    }
  }

  async sendMessage({ chatName, message }) {
    if (!this.isAuthenticated) {
      await this.login();
      await this.page.waitForTimeout(3000);
    }
    
    try {
      // Проверяем, что мы на странице с чатами
      const currentUrl = this.page.url();
      if (!currentUrl.includes('/online/')) {
        await this.page.goto(process.env.BITRIX_URL + '/online/');
        await this.page.waitForTimeout(3000);
      }
      
      // Ищем чат по ТОЧНОМУ имени, чтобы "Оповещения" не совпадало с "Тестовые оповещения"
      const chat = this.page.getByText(chatName, { exact: true }).first();
      await chat.waitFor({ state: 'visible', timeout: 10000 });
      await chat.click();
      await this.page.waitForTimeout(2000);

      
      // Находим поле ввода и отправляем сообщение
      const messageInput = this.page.locator('textarea, [contenteditable="true"]').first();
      await messageInput.fill(message);
      await this.page.keyboard.press('Enter');
      
      await this.page.waitForTimeout(1000);
      
      // Закрываем браузер после отправки
      await this.close();
      this.isAuthenticated = false;
      
      return { success: true, chatName, message };
    } catch (error) {
      await this.close();
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
  }
}

export default BitrixSender;
