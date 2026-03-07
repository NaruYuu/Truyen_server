const fs = require('fs');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data'); // Cần thư viện này để upload file
const dgram = require('dgram'); // THÊM: Thư viện để nghe UDP Broadcast

// --- CẤU HÌNH ---
const CONFIG = {
    IP_IPHONE: "", // Bỏ trống, tool sẽ tự động nhận diện từ iPhone
    PORT: "5000",
    PASSWORD: "naruyuu2203",
    LOCAL_FOLDER: "C:\\Users\\NaruYuu\\Documents\\Mangas", 
    
    CHECK_INTERVAL: 300 * 1000, // 5 phút (khi xong việc)
    RETRY_INTERVAL: 5 * 1000,   // 5 giây (khi lỗi)
    UPLOAD_TIMEOUT: 60000       // 60 giây timeout cho upload
};

// CẬP NHẬT: Đổi từ const sang let để có thể cập nhật IP mới, và thêm biến isSyncing
let SERVER_URL = `http://${CONFIG.IP_IPHONE}:${CONFIG.PORT}`;
let isSyncing = false; 

// Hàm ghi log
function log(type, msg) {
    const time = new Date().toLocaleTimeString('vi-VN', { hour12: false });
    const icons = { INFO: 'ℹ️', SUCCESS: '✅', ERROR: '❌', WARN: '⚠️', UPLOAD: '📤' };
    console.log(`[${time}] ${icons[type] || ''} ${msg}`);
}

// Hàm ngủ (để tránh spam server khi upload)
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// GIỮ NGUYÊN hàm này theo yêu cầu (nhưng không gọi nữa vì đã có UDP)
async function getServerIP() {
    try {
        const ipResp = await axios.get(`${SERVER_URL}/api/get_ip`);
        if (!ipResp || !ipResp.data.ip) {
            log('WARN', 'Không thể lấy được IP từ server.');
            return null;
        }
        return ipResp.data.ip;
    } catch (error) {
        console.error(`Lỗi khi lấy IP mới:`, error);
        return null;
    }
}

// --- THÊM: BỘ LẮNG NGHE TÍN HIỆU TỪ IPHONE ---
function listenForServer() {
    const udpClient = dgram.createSocket('udp4');
    
    udpClient.on('listening', () => {
        log('INFO', 'Đang lắng nghe tín hiệu IP từ mạng LAN...');
    });

    udpClient.on('message', (msg, rinfo) => {
        const text = msg.toString();
        // Nếu nhận đúng tín hiệu từ Server Manga
        if (text.startsWith('MANGA_SERVER|')) {
            const parts = text.split('|');
            const newIP = parts[1];
            const newPort = parts[2];
            
            if (CONFIG.IP_IPHONE !== newIP) {
                CONFIG.IP_IPHONE = newIP;
                SERVER_URL = `http://${CONFIG.IP_IPHONE}:${newPort}`;
                log('SUCCESS', `Đã tìm thấy Server iPhone tại IP: ${newIP}`);
                
                // Kích hoạt đồng bộ ngay khi tìm thấy IP lần đầu (nếu chưa chạy)
                if (!isSyncing) syncManga(); 
            }
        }
    });

    udpClient.bind(5555); // Nghe trên cổng 5555
}

async function syncManga() {
    // THÊM: Chặn không cho chạy nếu chưa có IP hoặc đang trong quá trình sync
    if (!CONFIG.IP_IPHONE) return; 
    if (isSyncing) return;
    isSyncing = true;

    try {
        
        // 1. Lấy danh sách Truyện (Series)
        const seriesList = fs.readdirSync(CONFIG.LOCAL_FOLDER, { withFileTypes: true })
            .filter(dirent => dirent.isDirectory())
            .map(dirent => dirent.name);

        if (seriesList.length === 0) {
            log('WARN', 'Thư mục trống, không có truyện nào.');
            isSyncing = false; scheduleNextRun(false); return; // Cập nhật trạng thái
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
        isSyncing = false; scheduleNextRun(false); // Xong việc -> Nghỉ 5 phút

    } catch (error) {
        let msg = error.message;
        if (error.code === 'ECONNREFUSED') msg = `Không kết nối được iPhone (${CONFIG.IP_IPHONE})`;
        
        log('ERROR', `Lỗi tổng quá trình: ${msg}`);
        log('WARN', `Thử lại sau 5 giây...`);
        isSyncing = false; scheduleNextRun(true); // Lỗi -> Thử lại sau 5s
    }
}

function scheduleNextRun(isError) {
    const delay = isError ? CONFIG.RETRY_INTERVAL : CONFIG.CHECK_INTERVAL;
    setTimeout(syncManga, delay);
}

// --- MAIN ---
log('INFO', `🚀 Tool Sync khởi động. Đang chờ kết nối từ iPhone...`);
listenForServer(); // CẬP NHẬT: Thay vì gọi syncManga(), chúng ta mở cổng để nghe iPhone hét IP