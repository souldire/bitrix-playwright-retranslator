# Bitrix Playwright Sender

Маленький локальный сервер на Node.js, который отправляет сообщения в Битрикс24 через Playwright.

Полезен, когда нужно писать в чаты Битрикс24 из внешних скриптов, но нет желания возиться с публичным API.

## Что умеет

- Принимает сообщения по HTTP API и ставит их в очередь.
- Отправляет сообщения в фоне через настоящий браузер.
- Ищет чат по названию, пишет в него текст.
- Сохраняет очередь в файл, чтобы ничего не терялось при перезапуске.

## Быстрый старт

```bash
npm install
npx playwright install chromium

cp .env.example .env
# отредактируй .env

npm start
```

Сервер запускается на `http://localhost:3456` (или на порту из `PORT`).

## Настройка

Создай `.env` рядом с `package.json`:

```env
PORT=3456
BITRIX_URL=https://your-company.bitrix24.ru
BITRIX_LOGIN=your-email@example.com
BITRIX_PASSWORD=your-password
HEADLESS=true
USE_SYSTEM_CHROME=false
```

| Переменная | Описание |
|---|---|
| `PORT` | Порт сервера. По умолчанию 3456. |
| `BITRIX_URL` | URL вашего портала Битрикс24. |
| `BITRIX_LOGIN` | Почта или логин для входа. |
| `BITRIX_PASSWORD` | Пароль. |
| `HEADLESS` | `true` — браузер без окна, `false` — видимый. |
| `USE_SYSTEM_CHROME` | `true` — использовать системный Chrome, `false` — Chromium от Playwright. |

Если не хочется качать Chromium и в системе установлен Google Chrome, поставь `USE_SYSTEM_CHROME=true`.

## Использование

Отправить сообщение:

```bash
curl -X POST http://localhost:3456/api/send \
  -H "Content-Type: application/json" \
  -d '{"chatName": "Иван Петров", "message": "Привет, как дела?"}'
```

Или из PowerShell:

```powershell
Invoke-RestMethod -Uri "http://localhost:3456/api/send" `
  -Method Post -ContentType "application/json" `
  -Body '{"chatName": "Иван Петров", "message": "Привет"}'
```

Проверить очередь:

```bash
curl http://localhost:3456/api/queue
```

Проверить, что сервер жив:

```bash
curl http://localhost:3456/health
```

## API

### `POST /api/send`

Добавляет сообщение в очередь.

Тело:

```json
{
  "chatName": "Название чата или имя контакта",
  "message": "Текст сообщения"
}
```

Ответ:

```json
{
  "success": true,
  "queueId": "uuid"
}
```

### `GET /api/queue`

Текущее состояние очереди: сколько всего, сколько ждёт, идёт ли обработка.

### `GET /health`

Простая проверка доступности сервера и состояния авторизации.

## Ручной запуск

Для разработки или теста:

```bash
npm start
```

Или без npm:

```bash
node server.js
```

В Windows также можно использовать `autostart/start-service.bat`, который перейдёт в корень проекта и запустит сервер.

## Тесты

Проверить авторизацию и отправку:

```bash
npm run test:login
```

Проверить API на параллельных запросах:

```bash
npm run test:api
```

## Как это работает

1. Приложение на Express принимает запросы.
2. Сообщения падают в локальную очередь и сохраняются в `queue.json`.
3. `BitrixSender` открывает браузер, логинится в Битрикс24 и отправляет сообщения по одному.
4. При ошибке делает несколько попыток, потом помечает задачу как проваленную.

## Структура

```
├── server.js           # HTTP API
├── bitrix-sender.js    # Playwright-логика
├── message-queue.js    # Очередь и сохранение на диск
├── autostart/
│   └── start-service.bat
├── tests/
│   ├── test-login.js
│   └── test-api.ps1
├── .env.example
└── queue.json          # создаётся автоматически
```

## Ограничения

- Селекторы Битрикс24 могут устареть со временем — тогда придётся поправить `bitrix-sender.js`.
- Авторизация обычная, по паролю. Двухфакторная аутентификация может потребовать доработки.
- Чат ищется по точному совпадению названия в списке чатов.

