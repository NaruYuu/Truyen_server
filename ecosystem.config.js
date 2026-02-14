module.exports = {
  apps : [
    {
      name: "Truyen-Downloader", // Tên hiển thị trong PM2
      script: "./server.js",
      watch: false,
      autorestart: true
    },
    {
      name: "Manga-Sync-Auto",   // Tên hiển thị trong PM2
      script: "./sync-manga.js",
      watch: false,
      autorestart: true
    }
  ]
};