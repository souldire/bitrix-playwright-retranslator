import { chromium } from 'playwright';
import fs from 'fs/promises';

// Файл, куда сохраняются куки/storageState Битрикс24.
// Позволяет не логиниться паролем при каждом запуске — сессия восстанавливается.
const STORAGE_STATE_FILE = 'auth-state.json';

// Сколько миллисекунд браузер может простаивать без сообщений, прежде чем закрыться.
// 0 — не закрывать (живёт постоянно). По умолчанию 5 минут.
const IDLE_TIMEOUT_MS = Number(process.env.IDLE_TIMEOUT_MS) || 5 * 60 * 1000;

// Сколько миллисекунд ждать ручного входа пользователя в видимом браузере,
// если автоматический вход не удался (капча, неверный пароль). По умолчанию 5 минут.
const INTERACTIVE_LOGIN_TIMEOUT_MS =
  Number(process.env.INTERACTIVE_LOGIN_TIMEOUT_MS) || 5 * 60 * 1000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class BitrixSender {
  constructor() {
    this.browser = null;
    this.context = null;
    this.page = null;
    this.isAuthenticated = false;
    // Автоматический вход паролем уже не проходил (капча/ошибка) —
    // больше не отправляем пароль сами, ждём ручного входа.
    this._skipPasswordLogin = false;
    // Видимый браузер ручного входа уже открывали в этом запуске —
    // сам больше не открываем (только по запросу через /api/auth).
    this._interactiveTried = false;
    this._interactivePromise = null;
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

  // Мы всё ещё на странице входа? (форма видна или URL — страница авторизации)
  async _isAuthActive() {
    const onAuthUrl = /[?&]login=yes|\/auth\//.test(this.page.url());
    const formVisible = await this.page
      .locator('input[name="USER_LOGIN"]')
      .isVisible()
      .catch(() => false);
    return onAuthUrl || formVisible;
  }

  async _isCaptchaVisible() {
    return this.page
      .locator(
        'iframe[src*="recaptcha"], .g-recaptcha, img[src*="captcha"], input[name="captcha_word"]'
      )
      .first()
      .isVisible()
      .catch(() => false);
  }

  async _isLoginErrorVisible() {
    // Алерт на странице входа после отправки формы ≈ неверный логин/пароль.
    return this.page
      .locator('.alert, .ui-alert, [class*="auth-error"]')
      .first()
      .isVisible()
      .catch(() => false);
  }

  // Ошибка авторизации: по флагу auth очередь делает длинную паузу перед повтором,
  // чтобы повторные попытки не «долбили» форму входа и не продлевали капчу.
  _authError(message) {
    const error = new Error(message);
    error.auth = true;
    return error;
  }

  _interactiveLoginEnabled() {
    return process.env.INTERACTIVE_LOGIN?.toLowerCase() !== 'false';
  }

  async login() {
    if (this.isAuthenticated) return;

    // Идёт ручной вход из другого вызова (например, /api/auth) — ждём его,
    // а не ломимся в форму параллельно.
    if (this._interactivePromise) {
      await this._interactivePromise.catch(() => {});
      if (this.isAuthenticated) return;
    }

    await this.page.goto(process.env.BITRIX_URL, { waitUntil: 'domcontentloaded' });

    if (!(await this._isOnLoginPage())) {
      console.log('Сессия жива, логин паролем не требуется');
    } else if (this._skipPasswordLogin) {
      // Раньше автологин уже не проходил (капча/ошибка) — пароль больше
      // не отправляем. Окно ручного входа сами открываем только один раз,
      // чтобы не мучить пользователя всплывающими браузерами по кругу.
      if (!this._interactiveLoginEnabled() || this._interactiveTried) {
        throw this._authError(
          'Автоматический вход отключён до ручного входа. ' +
            `Открыть окно входа вручную: GET http://localhost:${process.env.PORT || 3456}/api/auth`
        );
      }
      await this._interactiveLogin('Автоматический вход ранее не удался (капча или ошибка)');
    } else {
      await this._loginWithPassword();
    }

    this._skipPasswordLogin = false;
    this.isAuthenticated = true;
    // Сохраняем куки для следующих запусков
    await this._saveStorageState();
  }

  async _loginWithPassword() {
    await this.page.fill('input[name="USER_LOGIN"]', process.env.BITRIX_LOGIN);
    await this.page.fill('input[name="USER_PASSWORD"]', process.env.BITRIX_PASSWORD);
    await this.page.click('button[type="submit"]');

    const failureReason = await this._waitForLoginResult();
    if (!failureReason) {
      console.log('Выполнен вход паролем');
      return;
    }

    // Вход не удался — пароль повторно не отправляем.
    this._skipPasswordLogin = true;

    if (!this._interactiveLoginEnabled() || this._interactiveTried) {
      throw this._authError(
        `Вход паролем не удался: ${failureReason}. ` +
          `Открыть окно ручного входа: GET http://localhost:${process.env.PORT || 3456}/api/auth`
      );
    }
    await this._interactiveLogin(failureReason);
  }

  // Ждём итог автологина: либо ушли со страницы входа (успех), либо появилась
  // капча/ошибка, либо форма так и не исчезла (перехода в портал не было).
  // Возвращает null при успехе или текстовую причину неудачи.
  async _waitForLoginResult() {
    const timeoutMs = 20000;
    const start = Date.now();
    let stableSuccessTicks = 0;

    while (Date.now() - start < timeoutMs) {
      if (await this._isCaptchaVisible()) return 'потребовалась капча';
      if (await this._isLoginErrorVisible()) return 'ошибка входа (неверный логин или пароль?)';

      if (await this._isAuthActive()) {
        stableSuccessTicks = 0;
      } else {
        // Успех подтверждаем несколькими опросами подряд: при перезагрузке формы
        // после неудачного входа страница может на миг остаться без формы.
        stableSuccessTicks += 1;
        if (stableSuccessTicks >= 3) return null;
      }

      await sleep(500);
    }

    return 'форма входа не исчезла — перехода в портал не произошло';
  }

  // Ручной вход по явному запросу (эндпоинт GET /api/auth): открывает видимый
  // браузер независимо от того, сколько раз он открывался автоматически.
  async manualLogin() {
    return this._interactiveLogin('Ручной вход по запросу');
  }

  // Гарантирует один незакрытый ручной вход: параллельные вызовы (очередь +
  // /api/auth) ждут один и тот же браузер, а не открывают несколько.
  async _interactiveLogin(reason) {
    if (this._interactivePromise) return this._interactivePromise;
    this._interactiveTried = true;
    this._interactivePromise = this._doInteractiveLogin(reason).finally(() => {
      this._interactivePromise = null;
    });
    return this._interactivePromise;
  }

  // Открывает видимый (не headless) браузер, чтобы пользователь вошёл и решил
  // капчу вручную. Сервис сам НЕ решает, когда вход выполнен (на редиректах
  // страницы такой детект ловит ложные срабатывания): он периодически сохраняет
  // куки и ждёт, пока пользователь закроет окно. После закрытия поднимается
  // обычный браузер и по auth-state.json проверяется, что сессия жива.
  async _doInteractiveLogin(reason) {
    const waitMinutes = Math.round(INTERACTIVE_LOGIN_TIMEOUT_MS / 60000);
    console.warn(`⚠️  ${reason}`);
    console.warn('Открываю видимый браузер: войди вручную и реши капчу, если она появится.');
    console.warn(`Закончишь — закрой окно браузера сам. Жду до ${waitMinutes} мин.`);

    // Headless-браузер для ручного входа не подходит — пересоздаём его видимым,
    // сохранив имеющиеся куки.
    await this.close();

    const launchOptions = { headless: false };
    if (process.env.USE_SYSTEM_CHROME?.toLowerCase() === 'true') {
      launchOptions.channel = 'chrome';
    }
    this.browser = await chromium.launch(launchOptions);

    const contextOptions = {};
    const savedState = await this._loadStorageState();
    if (savedState) contextOptions.storageState = savedState;
    this.context = await this.browser.newContext(contextOptions);
    this.page = await this.context.newPage();

    await this.page.goto(process.env.BITRIX_URL, { waitUntil: 'domcontentloaded' });

    if (await this._isOnLoginPage()) {
      // Подставляем логин и пароль, но «Войти» не нажимаем:
      // капчу должен решить и подтвердить вход человек.
      await this.page
        .fill('input[name="USER_LOGIN"]', process.env.BITRIX_LOGIN)
        .catch(() => {});
      await this.page
        .fill('input[name="USER_PASSWORD"]', process.env.BITRIX_PASSWORD)
        .catch(() => {});
    }

    // Периодически снимаем куки: когда пользователь закроет окно, контекст
    // станет недоступен, и сохранить сессию будет уже нечем.
    const snapshotTimer = setInterval(() => {
      this._saveStorageState();
    }, 2000);

    let hinted = false;
    const start = Date.now();
    while (Date.now() - start < INTERACTIVE_LOGIN_TIMEOUT_MS) {
      if (!this.browser.isConnected()) break; // пользователь закрыл окно

      if (!hinted && this._isPortalUrl(this.page.url())) {
        hinted = true;
        console.log('Похоже, вход выполнен. Закрой окно браузера — сервис продолжит работу.');
      }

      await sleep(1000);
    }

    clearInterval(snapshotTimer);
    const closedByUser = !this.browser.isConnected();

    // Окно закрыто (пользователем или по таймауту). Поднимаем обычный браузер
    // и проверяем по сохранённым кукам, что сессия действительно жива.
    await this.close();
    console.log('Проверяю обновлённую сессию...');
    await this.init();

    await this.page.goto(process.env.BITRIX_URL, { waitUntil: 'domcontentloaded' });
    if (await this._isOnLoginPage()) {
      // Сессия не обновилась (окно закрыли без входа) — пароль по-прежнему не шлём.
      throw this._authError(
        closedByUser
          ? 'Окно ручного входа закрыто, но вход не был выполнен'
          : `Ручной вход не выполнен за ${waitMinutes} мин`
      );
    }

    this._skipPasswordLogin = false;
    this.isAuthenticated = true;
    console.log('Ручной вход выполнен, сессия обновлена');
  }

  // URL ведёт в раздел портала (а не на страницу входа)?
  _isPortalUrl(url) {
    return /\/(online|stream|company|crm|contacts|market|settings)\//.test(url);
  }

  // Браузер/страница ещё живы? Если упали — пересоздаём с нуля
  // (сессия восстановится из auth-state.json, пароль нужен только если протух).
  async _ensureBrowser() {
    if (this.browser && this.browser.isConnected() && this.page && !this.page.isClosed()) return;
    console.log('Браузер недоступен, переинициализируем...');
    await this.close();
    await this.init();
  }

  // Запланировать закрытие браузера после периода простоя.
  _scheduleIdleClose() {
    this._cancelIdleClose();
    if (!IDLE_TIMEOUT_MS || !this.browser) return;
    this._idleTimer = setTimeout(() => {
      console.log(`Браузер простаивает ${IDLE_TIMEOUT_MS} мс, закрываем...`);
      this.close();
    }, IDLE_TIMEOUT_MS);
  }

  _cancelIdleClose() {
    if (this._idleTimer) {
      clearTimeout(this._idleTimer);
      this._idleTimer = null;
    }
  }

  async sendMessage({ chatName, message }) {
    await this._ensureBrowser();
    this._cancelIdleClose();
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
      await this.page.waitForTimeout(500);

      // Запускаем таймер простоя — закроет браузер, если сообщений не будет.
      this._scheduleIdleClose();
      return { success: true, chatName, message };
    } catch (error) {
      // Браузер оставляем открытым (переиспользуем), но сбрасываем флаг авторизации,
      // чтобы при повторной попытке очередь заново проверила/восстановила сессию.
      this.isAuthenticated = false;
      this._scheduleIdleClose();
      throw new Error(`Ошибка отправки: ${error.message}`);
    }
  }

  async close() {
    this._cancelIdleClose();
    if (this.browser) {
      const b = this.browser;
      // Обнуляем ссылки синхронно, чтобы параллельный sendMessage увидел null и переинициализировал.
      this.browser = null;
      this.context = null;
      this.page = null;
      this.isAuthenticated = false;
      try {
        await b.close();
      } catch {
        // браузер уже мог быть закрыт
      }
    }
    this.isAuthenticated = false;
  }
}

export default BitrixSender;