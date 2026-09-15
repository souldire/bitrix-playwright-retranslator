import express from 'express';
import dotenv from 'dotenv';
import BitrixSender from './bitrix-sender.js';
import MessageQueue from './message-queue.js';

dotenv.config();

const app = express();
app.use(express.json());

const sender = new BitrixSender();
const queue = new MessageQueue();

// Загружаем очередь при старте
await queue.init();

// Если есть сообщения в очереди, начинаем обработку
if (queue.queue.length > 0) {
  console.log('Запускаем обработку очереди...');
  queue.process(sender).catch(console.error);
}

app.post('/api/send', async (req, res) => {
  try {
    const { chatName, message } = req.body;
    
    if (!chatName || !message) {
      return res.status(400).json({ 
        error: 'Требуются поля: chatName и message' 
      });
    }

    // Добавляем в очередь
    const queueItem = await queue.add({ chatName, message });
    
    // Запускаем обработку если не запущена
    if (!queue.processing) {
      queue.process(sender).catch(console.error);
    }
    
    res.json({ 
      success: true, 
      queueId: queueItem.id,
      message: 'Сообщение добавлено в очередь'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/queue', (req, res) => {
  res.json(queue.getStatus());
});

// Ручной вход: открывает видимый браузер с формой входа Битрикс24.
// Нужен, когда автологин упёрся в капчу, а окно ручного входа уже
// автоматически не открывается (это происходит не чаще одного раза за запуск).
// Запрос висит, пока окно не закроют (или не истечёт INTERACTIVE_LOGIN_TIMEOUT_MS).
app.get('/api/auth', async (req, res) => {
  try {
    if (sender.isAuthenticated) {
      return res.json({ success: true, authenticated: true, note: 'Сессия уже жива' });
    }
    await sender.manualLogin();
    res.json({ success: true, authenticated: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    authenticated: sender.isAuthenticated,
    queue: queue.getStatus()
  });
});

const PORT = process.env.PORT || 3456;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`Сервер запущен на http://${HOST}:${PORT}`);
  console.log(`Доступен в локальной сети на http://<your-ip>:${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', async () => {
  await sender.close();
  process.exit(0);
});
