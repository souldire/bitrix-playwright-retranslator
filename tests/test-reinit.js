import dotenv from 'dotenv';
import BitrixSender from '../bitrix-sender.js';

dotenv.config();

async function main() {
  const sender = new BitrixSender();
  await sender.init();
  console.log('init готов, browser connected:', sender.browser.isConnected());

  // Эмулируем крах браузера: закрываем процесс, но оставляем ссылки мёртвыми
  await sender.browser.close();
  console.log('браузер убит, connected:', sender.browser.isConnected(), 'page closed:', sender.page.isClosed());

  try {
    const res = await sender.sendMessage({ chatName: 'IMPORT_LOGS', message: 'тест re-init' });
    console.log('✅', JSON.stringify(res));
  } catch (e) {
    console.error('❌ ERROR:', e.message);
  } finally {
    await sender.close();
  }
}

main();