const fs = require('fs');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data'); // Cần thư viện này để upload file

// --- CẤU HÌNH ---
const CONFIG = {
    IP_IPHONE: "192.168.1.4", // Đổi IP iPhone của bạn vào đây
    PORT: "5000",
    PASSWORD: "naruyuu2203",
    LOCAL_FOLDER: "C:\\Users\\NaruYuu\\Documents\\Mangas", 
    
    CHECK_INTERVAL: 300 * 1000, // 5 phút (khi xong việc)
    RETRY_INTERVAL: 5 * 1000,   // 5 giây (khi lỗi)
    UPLOAD_TIMEOUT: 60000       // 60 giây timeout cho upload
};

const SERVER_URL = `http://${CONFIG.IP_IPHONE}:${CONFIG.PORT}`;

// Hàm ghi log
function log(type, msg) {
    const time = new Date().toLocaleTimeString('vi-VN', { hour12: false });
    const icons = { INFO: 'ℹ️', SUCCESS: '✅', ERROR: '❌', WARN: '⚠️', UPLOAD: '📤' };
    console.log(`[${time}] ${icons[type] || ''} ${msg}`);
}

// Hàm ngủ (để tránh spam server khi upload)
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function syncManga() {
    try {
        log('INFO', 'Bắt đầu quét thư mục...');

        if (!fs.existsSync(CONFIG.LOCAL_FOLDER)) {
            throw new Error(`Thư mục không tồn tại: ${CONFIG.LOCAL_FOLDER}`);
        }

        // 1. Lấy danh sách Truyện (Series)
        const seriesList = fs.readdirSync(CONFIG.LOCAL_FOLDER, { withFileTypes: true })
            .filter(dirent => dirent.isDirectory())
            .map(dirent => dirent.name);

        if (seriesList.length === 0) {
            log('WARN', 'Thư mục trống, không có truyện nào.');
            scheduleNextRun(false); return;
        }

        // 2. Duyệt từng Truyện
        for (const seriesName of seriesList) {
            const seriesPath = path.join(CONFIG.LOCAL_FOLDER, seriesName);
            
            // Lấy danh sách Chương (Chapters)
            const chapters = fs.readdirSync(seriesPath, { withFileTypes: true })
                .filter(dirent => dirent.isDirectory())
                .map(dirent => dirent.name);

            for (const chapName of chapters) {
                const chapPath = path.join(seriesPath, chapName);
                
                // Tạo đường dẫn chuẩn: "TenTruyen/Chap1" (Thay thế \ thành / cho đúng chuẩn web)
                const relPath = `${seriesName}/${chapName}`.replace(/\\/g, '/');

                try {
                    // BƯỚC A: Lấy danh sách file đang có trên Server
                    // (Tương đương: /api/sync/list_files trong Python)
                    const listResp = await axios.post(`${SERVER_URL}/api/sync/list_files`, {
                        password: CONFIG.PASSWORD,
                        path: relPath
                    }, { timeout: 10000 });

                    // Lấy danh sách file từ server trả về
                    const serverFiles = listResp.data.files || [];

                    // BƯỚC B: Quét file trong máy tính
                    const localFiles = fs.readdirSync(chapPath).filter(f => {
                        return ['.jpg', '.png', '.jpeg', '.webp'].includes(path.extname(f).toLowerCase());
                    });

                    // BƯỚC C: Tìm file còn thiếu
                    const missingFiles = localFiles.filter(f => !serverFiles.includes(f));

                    if (missingFiles.length > 0) {
                        log('INFO', `[${relPath}] Thiếu ${missingFiles.length} ảnh. Đang đồng bộ...`);

                        // BƯỚC D: Upload từng file thiếu
                        for (const fileName of missingFiles) {
                            const filePath = path.join(chapPath, fileName);
                            
                            // Chuẩn bị Form Data để upload
                            const form = new FormData();
                            form.append('password', CONFIG.PASSWORD);
                            form.append('path', relPath);
                            form.append('file', fs.createReadStream(filePath)); // Stream file trực tiếp

                            // Upload
                            await axios.post(`${SERVER_URL}/api/sync/upload`, form, {
                                headers: form.getHeaders(), // Header quan trọng cho multipart/form-data
                                timeout: CONFIG.UPLOAD_TIMEOUT
                            });

                            log('UPLOAD', `-> Đã gửi: ${fileName}`);
                            await sleep(50); // Nghỉ 0.05s như Python
                        }
                        log('SUCCESS', `=> Hoàn tất chương: ${relPath}`);
                    }

                } catch (err) {
                    // Nếu lỗi ở chương này thì bỏ qua, chạy chương kế tiếp (giống try-except: continue của Python)
                    // log('WARN', `Lỗi xử lý chương ${relPath}: ${err.message}`);
                    continue; 
                }
            }
        }

        log('SUCCESS', 'Đã đồng bộ xong toàn bộ dữ liệu!');
        scheduleNextRun(false); // Xong việc -> Nghỉ 5 phút

    } catch (error) {
        let msg = error.message;
        if (error.code === 'ECONNREFUSED') msg = `Không kết nối được iPhone (${CONFIG.IP_IPHONE})`;
        
        log('ERROR', `Lỗi tổng quá trình: ${msg}`);
        log('WARN', `Thử lại sau 5 giây...`);
        scheduleNextRun(true); // Lỗi -> Thử lại sau 5s
    }
}

function scheduleNextRun(isError) {
    const delay = isError ? CONFIG.RETRY_INTERVAL : CONFIG.CHECK_INTERVAL;
    setTimeout(syncManga, delay);
}

// --- MAIN ---
log('INFO', `🚀 Tool Sync khởi động. Target: ${SERVER_URL}`);
syncManga();