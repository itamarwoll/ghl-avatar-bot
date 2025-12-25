const express = require('express');
const puppeteer = require('puppeteer');
const fs = require('fs');
const axios = require('axios');
const path = require('path');

const app = express();
app.use(express.json({ limit: '50mb' }));

async function downloadImage(url, filepath) {
    console.log(`[DOWNLOAD] Downloading image...`);
    const response = await axios({
        url,
        method: 'GET',
        responseType: 'stream',
        timeout: 15000
    });
    return new Promise((resolve, reject) => {
        const writer = fs.createWriteStream(filepath);
        response.data.pipe(writer);
        let error = null;
        writer.on('error', err => {
            error = err;
            writer.close();
            reject(err);
        });
        writer.on('close', () => {
            if (!error) resolve(true);
        });
    });
}

app.post('/update-avatar', async (req, res) => {
    let { cookies, contactUrl, imageUrl } = req.body;
    let browser = null;

    try {
        console.log(`[START] Processing request for: ${contactUrl}`);
        
        browser = await puppeteer.launch({
            headless: "new",
            // התעלמות מדגלים שמסגירים אוטומציה
            ignoreDefaultArgs: ["--enable-automation"],
            args: [
                "--disable-blink-features=AutomationControlled", // הדגל הכי חשוב להסתרה!
                "--disable-setuid-sandbox",
                "--no-sandbox",
                "--single-process",
                "--no-zygote",
                "--disable-dev-shm-usage",
                "--disable-gpu",
                "--window-size=1920,1080"
            ],
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined
        });

        const page = await browser.newPage();
        page.setDefaultTimeout(60000); 

        // טריק נוסף להסתרת הרובוט
        await page.evaluateOnNewDocument(() => {
            Object.defineProperty(navigator, 'webdriver', {
                get: () => false,
            });
        });

        // הזרקת קוקיז
        if (typeof cookies === 'string') cookies = JSON.parse(cookies);
        await page.setCookie(...cookies);

        // שלב 1: חימום - כניסה לדף הבית של המערכת קודם
        // זה עוזר לעבור בדיקות אבטחה של Cloudflare/GHL
        const domain = new URL(contactUrl).origin; // למשל https://app.stanga.ai
        console.log(`[WARMUP] Navigating to dashboard root first: ${domain}`);
        await page.goto(domain, { waitUntil: 'networkidle2' }); // מחכים שהדף הראשי ייטען
        
        console.log('[WAIT] Sleeping 5s after warmup...');
        await new Promise(r => setTimeout(r, 5000));

        // שלב 2: כניסה לליד
        console.log(`[NAVIGATE] Now going to specific contact URL...`);
        await page.goto(contactUrl, { waitUntil: 'domcontentloaded' });
        
        console.log('[WAIT] Sleeping for 10 seconds to let Contact page render...');
        await new Promise(r => setTimeout(r, 10000));

        // בדיקת מצב הדף
        const pageTitle = await page.title();
        const bodyText = await page.evaluate(() => document.body.innerText.substring(0, 200)); // הצצה לתוכן הדף
        
        console.log(`[STATUS] Page Title: "${pageTitle}"`);
        console.log(`[STATUS] Page Content Preview: "${bodyText.replace(/\n/g, ' ')}..."`);

        if (!pageTitle || pageTitle.trim() === "") {
            throw new Error(`Page loaded but title is empty! The app probably crashed or blocked us.`);
        }

        if (page.url().includes('login')) {
            throw new Error('Redirected to Login Page! Cookies invalid.');
        }

        // הורדת תמונה
        const localImagePath = path.resolve(__dirname, 'temp_avatar.jpg');
        await downloadImage(imageUrl, localImagePath);
        
        // חיפוש Input
        console.log('[UPLOAD] Looking for file input...');
        
        // נסיון למצוא את האינפוט גם אם הוא מוסתר
        // לפעמים ב-GHL האינפוט נוצר רק אחרי שהעכבר זז, אז נזיז אותו קצת
        await page.mouse.move(100, 100);
        await page.mouse.move(200, 200);

        const fileInput = await page.waitForSelector('input[type="file"]', { timeout: 15000 });
        
        if (fileInput) {
            console.log('[UPLOAD] Input found! Uploading...');
            await fileInput.uploadFile(localImagePath);
            
            await new Promise(r => setTimeout(r, 5000));
            
            // ניסיון לשמור
            console.log('[SAVE] Looking for save button...');
            try {
                const saveBtn = await page.$x("//button[contains(., 'Save') or contains(., 'Done') or contains(., 'Upload')]");
                if (saveBtn.length > 0) {
                    await saveBtn[0].click();
                    console.log('[SAVE] Clicked.');
                    await new Promise(r => setTimeout(r, 3000));
                }
            } catch (e) {
                console.log('[SAVE] Skip save click.');
            }
        }

        console.log('[SUCCESS] Finished.');
        res.status(200).send({ status: 'Success', pageTitle });

    } catch (error) {
        console.error('[ERROR]', error.message);
        res.status(500).send({ status: 'Error', error: error.message });
    } finally {
        if (browser) await browser.close();
        if (fs.existsSync('temp_avatar.jpg')) fs.unlinkSync('temp_avatar.jpg');
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});
