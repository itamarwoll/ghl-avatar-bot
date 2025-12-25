const express = require('express');
const puppeteer = require('puppeteer');
const fs = require('fs');
const axios = require('axios');
const path = require('path');

const app = express();
app.use(express.json({ limit: '50mb' }));

// פונקציה להורדת תמונה עם Timeout קצר כדי שלא נתקע
async function downloadImage(url, filepath) {
    console.log(`[DOWNLOAD] Starting download from: ${url}`);
    const response = await axios({
        url,
        method: 'GET',
        responseType: 'stream',
        timeout: 10000 // 10 שניות מקסימום להורדה
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

    console.log(`[START] New Request for: ${contactUrl}`);

    if (!cookies || !contactUrl || !imageUrl) {
        return res.status(400).send({ error: 'Missing parameters' });
    }

    let browser = null;
    try {
        console.log('[BROWSER] Launching...');
        browser = await puppeteer.launch({
            headless: "new",
            args: [
                "--disable-setuid-sandbox",
                "--no-sandbox",
                "--single-process",
                "--no-zygote",
                "--disable-dev-shm-usage", // חשוב לשרתים חינמיים
                "--disable-gpu"
            ],
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined
        });

        const page = await browser.newPage();
        
        // הגדרת זמן מקסימלי לכל פעולה בדף (60 שניות)
        page.setDefaultTimeout(60000);

        // הזרקת קוקיז
        console.log('[COOKIES] Parsing and injecting...');
        if (typeof cookies === 'string') cookies = JSON.parse(cookies);
        await page.setCookie(...cookies);

        // ניווט - השינוי הגדול: לא מחכים ל-networkidle
        console.log(`[NAVIGATE] Going to URL...`);
        await page.goto(contactUrl, { waitUntil: 'domcontentloaded' });
        console.log('[NAVIGATE] Page loaded (DOM ready).');

        // בדיקת לוגין
        if (page.url().includes('login')) throw new Error('Redirected to Login - Cookies invalid');

        // הורדת תמונה
        const localImagePath = path.resolve(__dirname, 'temp_avatar.jpg');
        await downloadImage(imageUrl, localImagePath);
        console.log('[IMAGE] Downloaded to server.');

        // חיפוש ה-Input
        console.log('[UPLOAD] Looking for file input...');
        // מחכים שהאלמנט יהיה קיים בדף
        const fileInput = await page.waitForSelector('input[type="file"]', { timeout: 15000 });
        
        if (fileInput) {
            console.log('[UPLOAD] Input found, uploading...');
            await fileInput.uploadFile(localImagePath);
            
            // המתנה קצרה לוודא שהקובץ נקלט
            await new Promise(r => setTimeout(r, 3000));
            
            // לחיצה על שמירה
            console.log('[SAVE] Looking for save button...');
            try {
                // מנסים למצוא כפתור שמירה (בלולאה קצרה)
                const saveBtn = await page.$x("//button[contains(., 'Save') or contains(., 'Done') or contains(., 'Upload')]");
                if (saveBtn.length > 0) {
                    await saveBtn[0].click();
                    console.log('[SAVE] Button clicked.');
                    await new Promise(r => setTimeout(r, 3000));
                } else {
                    console.log('[SAVE] No explicit save button found (might have auto-saved).');
                }
            } catch (e) {
                console.log('[SAVE] Skip: ' + e.message);
            }
        }

        console.log('[SUCCESS] Finished.');
        res.status(200).send({ status: 'Success' });

    } catch (error) {
        console.error('[ERROR] ', error.message);
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
