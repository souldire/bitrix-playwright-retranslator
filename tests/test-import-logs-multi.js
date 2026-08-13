import dotenv from 'dotenv';
import BitrixSender from '../bitrix-sender.js';

dotenv.config();

async function main() {
  const sender = new BitrixSender();
  await sender.init();
  try {
    // Два сообщения подряд в одной сессии — логин должен сработать один раз.
    for (const msg of ['тест 1', 'тест 2']) {
      const res = await sender.sendMessage({ chatName: 'IMPORT_LOGS', message: msg });
      console.log('✅', JSON.stringify(res));
    }
  } catch (e) {
    console.error('❌ ERROR:', e.message);
  } finally {
    await sender.close();
  }
}

main();