const express = require('express');
const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = 3000;

// Cấu hình CORS mở rộng tối đa để Extension dễ thở
app.use(cors({
    origin: '*', 
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type']
}));

app.use(express.json({ limit: '50mb' }));

// --- [MỚI] BỘ GHI LOG (AI GỌI LÀ HIỆN LÊN MÀN HÌNH) ---
app.use((req, res, next) => {
    console.log(`[${new Date().toLocaleTimeString()}] 📞 Có kết nối tới: ${req.method} ${req.url}`);
    next();
});

// --- [MỚI] TRANG CHÀO MỪNG (ĐỂ TEST TRÌNH DUYỆT) ---
app.get('/', (req, res) => {
    res.send("✅ Server đang chạy ngon lành! Hãy gửi POST request vào /download");
});

console.log('🚀 Server đang chạy tại http://127.0.0.1:3000');

// Hàm ngủ (Sleep)
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Hàm tải thông minh
async function downloadWithRetry(imageUrl, savePath, headers, attempt = 1) {
    try {
        const response = await axios({
            method: 'GET',
            url: imageUrl,
            responseType: 'stream',
            headers: headers,
            timeout: 15000
        });

        const writer = fs.createWriteStream(savePath);
        response.data.pipe(writer);

        return new Promise((resolve, reject) => {
            writer.on('finish', resolve);
            writer.on('error', reject);
        });

    } catch (error) {
        if (attempt <= 5) {
            const status = error.response ? error.response.status : 'Unknown';
            console.warn(`⚠️ Lỗi ${status} - Thử lại lần ${attempt}/5...`);
            await sleep(3000); 
            return downloadWithRetry(imageUrl, savePath, headers, attempt + 1);
        } else {
            console.error(`❌ BỎ CUỘC: ${imageUrl}`);
            throw error;
        }
    }
}

app.post('/download', async (req, res) => {
    try {
        const { imageUrl, savePath, referer, cookies } = req.body;

        if (!imageUrl || !savePath) {
            console.log("❌ Request thiếu dữ liệu!");
            return res.status(400).send('Thiếu thông tin');
        }

        await fs.ensureDir(path.dirname(savePath));

        const headers = {
            'Referer': referer,
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        };
        
        if (cookies) headers['Cookie'] = cookies;

        console.log(`⬇️ [DOWNLOAD] ${path.basename(savePath)}`);
        
        await downloadWithRetry(imageUrl, savePath, headers);

        res.status(200).send({ status: 'success' });

    } catch (error) {
        console.error(`❌ LỖI: ${error.message}`);
        res.status(500).send({ error: error.message });
    }
});

// --- [MỚI] API KIỂM TRA FILE
app.post('/api/sync/check_file', async (req, res) => {
    try {
        const { filePath } = req.body;

        if (!filePath) {
            console.log("❌ Request thiếu dữ liệu!");
            return res.status(400).send('Thiếu thông tin');
        }

        const fileExists = fs.existsSync(path.join(__dirname, 'path/to/your/manga', filePath));

        res.status(200).send({ exists: fileExists });

    } catch (error) {
        console.error(`❌ LỖI: ${error.message}`);
        res.status(500).send({ error: error.message });
    }
});

// --- [MỚI] API UPLOAD FILE
app.post('/api/sync/upload', async (req, res) => {
    try {
        const form = new FormData(req);
        const file = form.get('file');

        if (!form.has('password') || !form.has('path') || !file) {
            console.log("❌ Request thiếu dữ liệu!");
            return res.status(400).send('Thiếu thông tin');
        }

        const password = form.get('password');
        const path = form.get('path');

        // Kiểm tra mật khẩu
        if (password !== CONFIG.PASSWORD) {
            return res.status(403).send('Mật khẩu không đúng');
        }

        await fs.ensureDir(path);
        const savePath = path.join(__dirname, 'path/to/your/manga', path);

        // Tạo đường dẫn lưu file
        const fileName = file.name;
        const filePath = path.join(savePath, fileName);

        // Lưu file vào máy tính
        await new Promise((resolve, reject) => {
            file.createReadStream().pipe(fs.createWriteStream(filePath))
                .on('finish', resolve)
                .on('error', reject);
        });

        res.status(200).send({ status: 'success' });

    } catch (error) {
        console.error(`❌ LỖI: ${error.message}`);
        res.status(500).send({ error: error.message });
    }
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on port ${PORT}`);
});
