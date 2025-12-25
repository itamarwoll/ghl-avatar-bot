const express = require('express');
const puppeteer = require('puppeteer');
const fs = require('fs');
const axios = require('axios');
const path = require('path');

const app = express();
app.use(express.json());

// פונקציית עזר להורדת התמונה
async function downloadImage(url, filepath) {
    const response = await axios({
        url,
        method: 'GET',
        responseType: 'stream'
    });
    return new Promise((resolve, reject) => {
        response.data.pipe(fs.createWriteStream(filepath))
            .on('error', reject)
            .once('close', resolve);
    });
}

app.post('/update-avatar', async (req, res) => {
    // שליפת הנתונים מהבקשה של Make
    const { email, password, contactUrl, imageUrl } = req.body;

    if (!email || !password || !contactUrl || !imageUrl) {
        return res.status(400).send({ error: 'Missing parameters: email, password, contactUrl, or imageUrl' });
    }

    console.log(`[START] Processing for URL: ${contactUrl}`);
    
    let browser = null;
    try {
        // הרצת הדפדפן (מותאם גם לשרת וגם ללוקאלי)
        browser = await puppeteer.launch({
            headless: "new",
            args: [
                "--disable-setuid-sandbox",
                "--no-sandbox",
                "--single-process",
                "--no-zygote",
            ],
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined
        });

        const page = await browser.newPage();
        // הגדרת User Agent כדי לא להיראות חשודים
        await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36');

        // --- שלב 1: לוגין ---
        console.log('Logging in...');
        await page.goto('https://app.gohighlevel.com/', { waitUntil: 'networkidle2', timeout: 60000 });
        
        await page.type('input[type="email"]', email);
        await page.type('input[type="password"]', password);
        
        // לחיצה על כפתור הלוגין והמתנה לניווט
        await Promise.all([
            page.waitForNavigation({ waitUntil: 'networkidle2' }),
            page.click('button[type="submit"]')
        ]);

        console.log('Login successful, waiting for dashboard...');
        // השהיה קטנה לוודא שהקוקיז נשמרו
        await new Promise(r => setTimeout(r, 3000));

        // --- שלב 2: כניסה לכרטיס ---
        console.log(`Navigating to contact: ${contactUrl}`);
        await page.goto(contactUrl, { waitUntil: 'networkidle2', timeout: 60000 });

        // --- שלב 3: הכנת התמונה ---
        const localImagePath = path.resolve(__dirname, 'temp_avatar.jpg');
        await downloadImage(imageUrl, localImagePath);
        console.log('Image downloaded locally.');

        // --- שלב 4: העלאה ---
        console.log('Attempting to upload...');
        
        // איתור ה-Input הנסתר של הקובץ
        // ב-GHL זה בדרך כלל input[type="file"] שחבוי בתוך האלמנטים
        const fileInput = await page.$('input[type="file"]');
        
        if (fileInput) {
            await fileInput.uploadFile(localImagePath);
            console.log('File injected into input.');

            // המתנה ל-Upload שיתבצע
            await new Promise(r => setTimeout(r, 5000));
            
            // לחיצה על כפתור שמירה בחלון הקרופ (אם קיים)
            // ננסה למצוא כפתור שמכיל את המילה Save או Confirm
            try {
                const saveButtons = await page.$x("//button[contains(., 'Save') or contains(., 'Done') or contains(., 'Upload')]");
                if (saveButtons.length > 0) {
                    await saveButtons[0].click();
                    console.log('Clicked Save/Crop button.');
                    await new Promise(r => setTimeout(r, 3000));
                }
            } catch (e) {
                console.log('No extra Save button found or needed.');
            }
            
        } else {
            throw new Error('Could not find file input element on the page.');
        }

        console.log('[SUCCESS] Image updated!');
        res.status(200).send({ status: 'Success', message: 'Image updated successfully' });

    } catch (error) {
        console.error('[ERROR]', error);
        // צילום מסך במקרה של שגיאה (עוזר לדיבאג בלוגים)
        if (browser) {
            try {
                const page = (await browser.pages())[0];
                const screenshotBuffer = await page.screenshot({ encoding: 'base64' });
                console.log('Screenshot (Base64 error debug):', screenshotBuffer.substring(0, 100) + '...');
            } catch (e) {}
        }
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
