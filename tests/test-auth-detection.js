// Тест детекта неудачного входа и капчи на локальном мок-сервере
// (к реальному Битрикс24 не обращается).
//
// Проверяет:
// 1. Успешный вход паролем: уход со страницы входа распознаётся как успех.
// 2. Капча после неудачного входа: login() кидает ошибку с флагом auth.
// 3. Повторная попытка больше не отправляет пароль (чтобы не продлевать капчу).
//
// Запуск: npm run test:auth

import assert from 'node:assert';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import dotenv from 'dotenv';

dotenv.config();

// Настраиваем окружение ДО импорта bitrix-sender.js — часть переменных читается на уровне модуля.
process.env.INTERACTIVE_LOGIN = 'false'; // ручной вход не тестируем, чтобы не открывать окно
process.env.HEADLESS = 'true';
process.env.IDLE_TIMEOUT_MS = '0';

// Мок страницы входа Битрикс24: POST при loginShouldFail=true возвращает форму
// с капчей, иначе ставит куку сессии и редиректит на «портал».
let loginShouldFail = true;
let submitCount = 0;

const loginPage = (withCaptcha) => `<!doctype html><html><body>
  ${withCaptcha ? '<img src="/captcha.png" width="120" height="50">' : ''}
  <form method="post" action="/">
    <input name="USER_LOGIN" type="text">
    <input name="USER_PASSWORD" type="password">
    <button type="submit">Войти</button>
  </form>
</body></html>`;

const portalPage = '<!doctype html><html><body><h1>Портал</h1></body></html>';

const server = http.createServer((req, res) => {
  if (req.url === '/captcha.png') {
    res.writeHead(200, { 'content-type': 'image/png' });
    res.end(
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
        'base64'
      )
    );
    return;
  }

  const authed = /SESSION=ok/.test(req.headers.cookie || '');

  if (req.method === 'POST') {
    submitCount++;
    if (!loginShouldFail) {
      res.writeHead(302, { 'set-cookie': 'SESSION=ok', location: '/' });
      res.end();
    } else {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(loginPage(true));
    }
    return;
  }

  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(authed ? portalPage : loginPage(false));
});

// Каждый сценарий работает в своей временной папке,
// чтобы тест не перезаписал настоящий auth-state.json в корне проекта.
function freshWorkdir() {
  process.chdir(fs.mkdtempSync(path.join(os.tmpdir(), 'bitrix-sender-test-')));
}

async function main() {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  process.env.BITRIX_URL = `http://127.0.0.1:${port}`;
  process.env.BITRIX_LOGIN = 'user@example.com';
  process.env.BITRIX_PASSWORD = 'secret';

  const { default: BitrixSender } = await import('../bitrix-sender.js');

  // 1. Успешный вход
  {
    freshWorkdir();
    loginShouldFail = false;
    const sender = new BitrixSender();
    await sender.init();
    await sender.login();
    assert.ok(sender.isAuthenticated, 'успешный вход должен ставить isAuthenticated');
    assert.strictEqual(submitCount, 1, 'форма входа должна быть отправлена один раз');
    await sender.close();
    console.log('✅ Успешный вход распознан');
  }

  // 2. Капча и 3. отказ от повторной отправки пароля
  {
    freshWorkdir();
    loginShouldFail = true;
    const sender = new BitrixSender();
    await sender.init();

    await assert.rejects(
      () => sender.login(),
      (error) => error.auth === true && /капча/i.test(error.message),
      'после капчи login() должен кидать auth-ошибку'
    );
    console.log('✅ Капча распознана, ошибка помечена флагом auth');

    await assert.rejects(
      () => sender.login(),
      (error) => error.auth === true,
      'повторный login тоже должен кидать auth-ошибку'
    );
    assert.strictEqual(submitCount, 2, 'повторный login не должен отправлять форму входа');
    await sender.close();
    console.log('✅ Повторная попытка не отправляет пароль снова');
  }

  server.close();
  console.log('✅ Все проверки пройдены');
  process.exit(0);
}

main().catch((error) => {
  console.error('❌ Тест провален:', error);
  process.exit(1);
});
