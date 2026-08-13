import dotenv from 'dotenv';
import BitrixSender from '../bitrix-sender.js';

dotenv.config();

async function main() {
  const sender = new BitrixSender();
  await sender.init();
  console.log('init, connected:', sender.browser.isConnected());

  const res = await sender.sendMessage({ chatName: 'IMPORT_LOGS', message: 'тест idle' });
  console.log('✅ отправлено:', JSON.stringify(res));
  console.log('сразу после отправки, browser:', !!sender.browser, 'connected:', sender.browser?.isConnected());

  const wait = Number(process.env.IDLE_TIMEOUT_MS) + 2500;
  console.log(`ждём ${wait} мс (idle timeout = ${process.env.IDLE_TIMEOUT_MS})...`);
  await new Promise(r => setTimeout(r, wait));
  console.log('после ожидания, browser:', !!sender.browser);

  console.log('--- второе сообщение (ожидаем re-init) ---');
  const res2 = await sender.sendMessage({ chatName: 'IMPORT_LOGS', message: 'тест idle 2' });
  console.log('✅ отправлено:', JSON.stringify(res2));

  await sender.close();
}

main();