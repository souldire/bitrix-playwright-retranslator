import fs from 'fs/promises';
import path from 'path';

// Пауза между попытками, когда не удаётся авторизоваться (капча, неверный пароль,
// ручной вход не завершён). Повторные попытки без паузы «долбят» форму входа
// и продлевают капчу на стороне Битрикс24. По умолчанию 10 минут.
const AUTH_RETRY_DELAY_MS = Number(process.env.AUTH_RETRY_DELAY_MS) || 10 * 60 * 1000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class MessageQueue {
  constructor(queueFile = 'queue.json') {
    this.queueFile = queueFile;
    this.processing = false;
    this.queue = [];
  }

  async init() {
    try {
      const data = await fs.readFile(this.queueFile, 'utf-8');
      this.queue = JSON.parse(data);
      console.log(`Загружено ${this.queue.length} сообщений из очереди`);
    } catch (error) {
      this.queue = [];
    }
  }

  async save() {
    await fs.writeFile(this.queueFile, JSON.stringify(this.queue, null, 2));
  }

  async add(message) {
    const queueItem = {
      id: Date.now() + Math.random(),
      chatName: message.chatName,
      message: message.message,
      status: 'pending',
      createdAt: new Date().toISOString(),
      attempts: 0
    };
    
    this.queue.push(queueItem);
    await this.save();
    
    return queueItem;
  }

  async process(sender) {
    if (this.processing) return;
    
    this.processing = true;
    
    while (this.queue.length > 0) {
      const item = this.queue[0];
      
      if (item.status === 'pending') {
        try {
          console.log(`Обработка сообщения ${item.id} для чата "${item.chatName}"`);
          
          if (!sender.browser) {
            await sender.init();
          }
          
          await sender.sendMessage({
            chatName: item.chatName,
            message: item.message
          });
          
          item.status = 'sent';
          item.sentAt = new Date().toISOString();
          console.log(`✅ Сообщение ${item.id} отправлено`);
          
        } catch (error) {
          item.attempts++;
          item.lastError = error.message;

          if (item.attempts >= 3) {
            item.status = 'failed';
            console.error(`❌ Сообщение ${item.id} не удалось отправить после 3 попыток`);
          } else {
            if (error.auth) {
              // Проблема авторизации: ретраим не сразу, а после паузы.
              const minutes = Math.round(AUTH_RETRY_DELAY_MS / 60000);
              console.error(
                `⚠️ Проблема авторизации. Повторная попытка для ${item.id} через ${minutes} мин`
              );
              await sleep(AUTH_RETRY_DELAY_MS);
            }
            console.error(`⚠️ Ошибка отправки ${item.id}, попытка ${item.attempts}/3`);
          }
        }
        
        await this.save();
      }
      
      // Удаляем обработанное сообщение
      if (item.status === 'sent' || item.status === 'failed') {
        this.queue.shift();
        await this.save();
      }
    }
    
    this.processing = false;
  }

  getStatus() {
    return {
      total: this.queue.length,
      pending: this.queue.filter(m => m.status === 'pending').length,
      processing: this.processing
    };
  }
}

export default MessageQueue;
