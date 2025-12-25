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
        
        // השקה של הדפדפן
        browser = await puppeteer.launch({
            headless: "new",
            args: [
                "--disable-setuid-sandbox",
                "--no-sandbox",
                "--single-process",
                "--no-zygote",
                "--disable-dev-shm-usage",
                "--disable-gpu",
                "--window-size=1920,1080" // פותחים חלון גדול כדי שאלמנטים לא יהיו מוסתרים
            ],
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined
        });

        const page = await browser.newPage();
        // נותנים לבוט זמן המתנה ארוך לפני שהוא מתייאש (60 שניות)
        page.setDefaultTimeout(60000); 

        // הזרקת קוקיז
        if (typeof cookies === 'string') cookies = JSON.parse(cookies);
        await page.setCookie(...cookies);

        // ניווט לדף
        console.log(`[NAVIGATE] Going to URL...`);
        await page.goto(contactUrl, { waitUntil: 'domcontentloaded' });
        
        // *** תוספת קריטית: המתנה "טיפשה" של 10 שניות ***
        // נותנים ל-React של GHL לסיים לרנדר את כל הדף
        console.log('[WAIT] Sleeping for 10 seconds to let GHL render...');
        await new Promise(r => setTimeout(r, 10000));

        // בדיקה: איפה אנחנו נמצאים?
        const currentUrl = page.url();
        const pageTitle = await page.title();
        console.log(`[STATUS] Current Page Title: "${pageTitle}"`);
        console.log(`[STATUS] Current URL: "${currentUrl}"`);

        if (currentUrl.includes('login')) {
            throw new Error(`Redirected to Login Page! Cookies might be invalid or expired. Title: ${pageTitle}`);
        }

        // הורדת תמונה
        const localImagePath = path.resolve(__dirname, 'temp_avatar.jpg');
        await downloadImage(imageUrl, localImagePath);
        
        // חיפוש כפתור ההעלאה
        console.log('[UPLOAD] Looking for file input...');
        // מנסים לחפש שוב עם זמן נדיב
        const fileInput = await page.waitForSelector('input[type="file"]', { timeout: 20000 });
        
        if (fileInput) {
            console.log('[UPLOAD] Input found! Uploading file...');
            await fileInput.uploadFile(localImagePath);
            
            await new Promise(r => setTimeout(r, 5000)); // מחכים שההעלאה תתפוס
            
            // לחיצה על כפתור שמירה אם קיים
            console.log('[SAVE] Looking for save button...');
            try {
                const saveBtn = await page.$x("//button[contains(., 'Save') or contains(., 'Done') or contains(., 'Upload')]");
                if (saveBtn.length > 0) {
                    await saveBtn[0].click();
                    console.log('[SAVE] Save button clicked.');
                    await new Promise(r => setTimeout(r, 3000));
                }
            } catch (e) {
                console.log('[SAVE] Info: No explicit save button clicked (might be auto-save).');
            }
        } else {
            throw new Error(`File input not found on page: "${pageTitle}"`);
        }

        console.log('[SUCCESS] Finished successfully.');
        res.status(200).send({ 
            status: 'Success', 
            pageTitle: pageTitle,
            finalUrl: currentUrl 
        });

    } catch (error) {
        console.error('[ERROR]', error.message);
        res.status(500).send({ 
            status: 'Error', 
            error: error.message,
            // מחזירים את הפרטים כדי שנדע ב-Make מה קרה
            debugInfo: {
                details: "Check Render logs for more info"
            }
        });
    } finally {
        if (browser) await browser.close();
        if (fs.existsSync('temp_avatar.jpg')) fs.unlinkSync('temp_avatar.jpg');
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});
