const express = require('express');
const puppeteer = require('puppeteer');
const fs = require('fs');
const axios = require('axios');
const path = require('path');

const app = express();

// הגדלת המגבלה כדי שנוכל לקבל JSON ענק של קוקיז
app.use(express.json({ limit: '50mb' }));

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
    // שים לב: אנחנו לא מבקשים יותר מייל וסיסמה
    let { cookies, contactUrl, imageUrl } = req.body;

    if (!cookies || !contactUrl || !imageUrl) {
        return res.status(400).send({ error: 'Missing parameters: cookies, contactUrl, or imageUrl' });
    }

    console.log(`[START] Processing with Cookies for: ${contactUrl}`);
    
    let browser = null;
    try {
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
        
        // --- שלב 1: הזרקת הקוקיז ---
        console.log('Injecting cookies...');
        
        // אם הקוקיז הגיעו כסטרינג (קורה לפעמים במייק), נהפוך אותם לאובייקט
        if (typeof cookies === 'string') {
            try {
                cookies = JSON.parse(cookies);
            } catch (e) {
                console.error('Warning: Cookies came as string, parsing...');
            }
        }

        if (Array.isArray(cookies)) {
            await page.setCookie(...cookies);
        } else {
            throw new Error('Invalid cookies format. Must be an array.');
        }

        // --- שלב 2: כניסה ישירה (בלי לוגין) ---
        console.log(`Navigating directly to contact...`);
        // מגדירים User Agent כדי להיראות אנושיים
        await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36');
        
        await page.goto(contactUrl, { waitUntil: 'networkidle2', timeout: 60000 });

        // בדיקת בטיחות: האם נזרקנו לדף לוגין למרות הקוקיז?
        if (page.url().includes('login')) {
            throw new Error('Cookies rejected - Redirected to login page');
        }

        // --- שלב 3: הורדת התמונה ---
        const localImagePath = path.resolve(__dirname, 'temp_avatar.jpg');
        await downloadImage(imageUrl, localImagePath);
        console.log('Image downloaded.');

        // --- שלב 4: העלאה ---
        console.log('Uploading image...');
        const fileInput = await page.$('input[type="file"]');
        
        if (fileInput) {
            await fileInput.uploadFile(localImagePath);
            console.log('File uploaded.');
            
            // המתנה לעיבוד
            await new Promise(r => setTimeout(r, 5000));
            
            // לחיצה על כפתור שמירה/קרופ אם יש
            try {
                const saveButtons = await page.$x("//button[contains(., 'Save') or contains(., 'Done') or contains(., 'Upload')]");
                if (saveButtons.length > 0) {
                    await saveButtons[0].click();
                    await new Promise(r => setTimeout(r, 3000));
                }
            } catch (e) {}

        } else {
            throw new Error('File input not found. Are you sure the page loaded correctly?');
        }

        console.log('[SUCCESS] Done.');
        res.status(200).send({ status: 'Success', message: 'Image updated successfully' });

    } catch (error) {
        console.error('[ERROR]', error);
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
