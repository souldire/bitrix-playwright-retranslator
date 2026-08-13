import dotenv from 'dotenv';
import BitrixSender from '../bitrix-sender.js';

dotenv.config();

async function main() {
  const sender = new BitrixSender();
  await sender.init();
  try {
    const res = await sender.sendMessage({ chatName: 'IMPORT_LOGS', message: 'тест' });
    console.log('✅ RESULT:', JSON.stringify(res));
  } catch (e) {
    console.error('❌ ERROR:', e.message);
    await sender.close();
  }
}

main();