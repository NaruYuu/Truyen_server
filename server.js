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

async function getFileStat(filePath) {
    try {
        const stat = await fs.stat(filePath);
        return stat.isFile() ? stat : null;
    } catch (e) {
        return null;
    }
}

async function groupFilesByBase(folder) {
    const items = await fs.readdir(folder);
    const groups = {};

    for (const fileName of items) {
        const fullPath = path.join(folder, fileName);
        const stat = await getFileStat(fullPath);
        if (!stat) continue;
        const base = path.basename(fileName, path.extname(fileName));
        if (!groups[base]) groups[base] = [];
        groups[base].push({ path: fullPath, size: stat.size, name: fileName });
    }

    return groups;
}

async function dedupeFolder(folder) {
    const groups = await groupFilesByBase(folder);

    for (const base in groups) {
        const files = groups[base];
        if (files.length <= 1) continue;

        files.sort((a, b) => b.size - a.size);
        const keep = files[0];
        const removeList = files.slice(1);

        for (const item of removeList) {
            try {
                await fs.remove(item.path);
                console.log(`🗑️ Xóa file trùng trong folder: ${item.name} (${item.size} bytes)`);
            } catch (err) {
                console.warn(`⚠️ Không xóa được ${item.path}: ${err.message}`);
            }
        }

        if (removeList.length > 0) {
            console.log(`✅ Giữ bản tốt nhất cho '${base}': ${keep.name} (${keep.size} bytes)`);
        }
    }
}

async function resolveDuplicateQuality(savePath, tempPath) {
    const folder = path.dirname(savePath);
    const baseName = path.basename(savePath, path.extname(savePath));

    const items = await fs.readdir(folder);
    const candidates = [];

    for (const fileName of items) {
        if (path.basename(fileName, path.extname(fileName)) !== baseName) continue;
        const fullPath = path.join(folder, fileName);
        const stat = await getFileStat(fullPath);
        if (stat) candidates.push({ path: fullPath, size: stat.size, isTemp: false });
    }

    const tempStat = await getFileStat(tempPath);
    if (tempStat) candidates.push({ path: tempPath, size: tempStat.size, isTemp: true });

    if (candidates.length === 0) {
        // Không có file nào để so sánh, giữ tạm file tải xuống
        if (await fs.pathExists(tempPath)) {
            await fs.move(tempPath, savePath, { overwrite: true });
        }
        return;
    }

    candidates.sort((a, b) => b.size - a.size);
    const best = candidates[0];

    for (const item of candidates.slice(1)) {
        try {
            await fs.remove(item.path);
            console.log(`🗑️ Xóa file trùng kém hơn: ${path.basename(item.path)} (${item.size} bytes)`);
        } catch (err) {
            console.warn(`⚠️ Không xóa được ${item.path}: ${err.message}`);
        }
    }

    if (best.isTemp) {
        await fs.move(best.path, savePath, { overwrite: true });
        console.log(`✅ Giữ bản tải mới chất lượng cao nhất: ${path.basename(savePath)} (${best.size} bytes)`);
    } else {
        if (await fs.pathExists(tempPath)) {
            await fs.remove(tempPath);
        }
        console.log(`✅ Giữ bản hiện có chất lượng tốt hơn: ${path.basename(best.path)} (${best.size} bytes)`);
    }

    await dedupeFolder(folder);
}

app.post('/download', async (req, res) => {
    try {
        const { imageUrl, savePath, referer, cookies, mangaTitle, chapterTitle, pageIndex } = req.body;

        if (!imageUrl || !savePath) {
            console.log("❌ Request thiếu dữ liệu!");
            return res.status(400).send('Thiếu thông tin');
        }

        await fs.ensureDir(path.dirname(savePath));

        const tempPath = `${savePath}.${Date.now()}.tmp`;
        const headers = {
            'Referer': referer,
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        };
        
        if (cookies) headers['Cookie'] = cookies;

        const entry = `${mangaTitle || 'Unknown Manga'}/${chapterTitle || 'Unknown Chap'} - ${path.basename(savePath)}`;
        console.log(`⬇️ [DOWNLOAD] ${entry}`);
        
        await downloadWithRetry(imageUrl, tempPath, headers);
        await resolveDuplicateQuality(savePath, tempPath);

        res.status(200).send({ status: 'success' });

    } catch (error) {
        console.error(`❌ LỖI: ${error.message}`);
        res.status(500).send({ error: error.message });
    }
});

// --- [MỚI] API KIỂM TRA FILE
app.post('/api/sync/check_file', async (req, res) => {
    try {
        const { savePath } = req.body;

        if (!savePath) {
            console.log("❌ Request thiếu dữ liệu!");
            return res.status(400).send('Thiếu thông tin');
        }

        const fileExists = fs.existsSync(savePath);

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
