import { chromium } from 'playwright';
import dotenv from 'dotenv';

dotenv.config();

async function testLogin() {
  console.log('Запускаем браузер...');
  
  const browser = await chromium.launch({
    headless: false,
    slowMo: 500 // Замедляем действия чтобы видеть что происходит
  });
  
  const context = await browser.newContext();
  const page = await context.newPage();
  
  try {
    console.log(`Переходим на ${process.env.BITRIX_URL}`);
    await page.goto(process.env.BITRIX_URL);
    
    console.log('Ждем 3 секунды...');
    await page.waitForTimeout(3000);
    
    console.log('Вводим логин...');
    await page.fill('input[name="USER_LOGIN"]', process.env.BITRIX_LOGIN);
    
    console.log('Вводим пароль...');
    await page.fill('input[name="USER_PASSWORD"]', process.env.BITRIX_PASSWORD);
    
    console.log('Нажимаем кнопку входа...');
    await page.click('button[type="submit"]');
    
    console.log('Ждем загрузки...');
    await page.waitForTimeout(5000);
    
    console.log('Дополнительное ожидание после логина...');
    await page.waitForTimeout(3000);
    
    console.log('Ищем чат "test"...');
    // Ищем в списке чатов слева
    await page.click('text=test');
    
    console.log('Открыли чат, ждем загрузки...');
    await page.waitForTimeout(3000);
    
    console.log('Ищем поле ввода сообщения...');
    // Ищем поле ввода (может быть textarea или contenteditable div)
    const messageInput = page.locator('textarea, [contenteditable="true"]').first();
    await messageInput.fill('тест');
    
    console.log('Отправляем сообщение...');
    await page.keyboard.press('Enter');
    
    console.log('✅ Сообщение отправлено! Браузер останется открытым, закрой его сам когда нужно...');
    console.log('Нажми Ctrl+C в терминале чтобы завершить скрипт');
    
    // Ждем бесконечно, пока не закроешь вручную
    await page.waitForTimeout(999999999);
    
  } catch (error) {
    console.error('❌ Ошибка:', error.message);
    console.log('Браузер останется открытым для проверки. Нажми Ctrl+C чтобы завершить');
    await page.waitForTimeout(999999999);
  }
}

testLogin();
