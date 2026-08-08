require('dotenv').config();
const express = require('express');
const cron = require('node-cron');
const https = require('https');
const http = require('http');

const { client, getQR, getStatus, getLastError, getLastPingSuccess, initializeClient, restartClient, pingFSN } = require('./waClient');
const { runScheduleCheck } = require('./scheduler');

const app = express();
const PORT = process.env.PORT || 8080;

// ── Global Error Handlers ──────────────────────────────────────────────────────
process.on('uncaughtException', (err) => {
    console.error('[Process] uncaughtException (bot tetap berjalan):', err.message);
});

process.on('unhandledRejection', (reason) => {
    console.error('[Process] unhandledRejection (bot tetap berjalan):', reason?.message || reason);
});

// ── Health Check ───────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
    res.json({
        status: 'ok',
        service: 'WA Bot OMAETEE COURSE',
        engine: 'FSN API',
        wa_status: getStatus(),
        timestamp: new Date().toISOString()
    });
});

app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        uptime: process.uptime(),
        wa_status: getStatus(),
        last_ping_success: getLastPingSuccess(),
        last_error: getLastError()
    });
});

// ── QR Code Endpoint (FSN tidak perlu QR, tampilkan status) ───────────────────
app.get('/qr', (req, res) => {
    const waStatus = getStatus();
    res.send(`
        <html><head><title>Status WA Bot - FSN</title></head>
        <body style="font-family:sans-serif;text-align:center;padding:40px;background:#f8fafc">
            <h2>📱 WA Bot — FSN API Mode</h2>
            <div style="display:inline-block;border:4px solid #e2e8f0;border-radius:12px;margin:20px 0;padding:30px;background:#fff">
                ${waStatus === 'ready'
                    ? '<h3 style="color:#16a34a">✅ FSN API Terkoneksi</h3><p>Bot siap mengirim pesan WhatsApp.</p>'
                    : `<h3 style="color:#dc2626">⚠️ Status: ${waStatus}</h3><p>Periksa log server atau klik tombol di bawah.</p>`
                }
            </div>
            <div style="margin-top:20px;">
                <button onclick="doRestart()" style="padding:10px 20px;background:#2563eb;color:white;border:none;border-radius:6px;cursor:pointer;font-size:14px;margin:5px;">
                    🔄 Restart & Re-check FSN
                </button>
                <button onclick="location.reload()" style="padding:10px 20px;background:#64748b;color:white;border:none;border-radius:6px;cursor:pointer;font-size:14px;margin:5px;">
                    ↻ Refresh Halaman
                </button>
            </div>
            <p id="msg" style="color:#64748b;margin-top:15px;"></p>
            <script>
                async function doRestart() {
                    document.getElementById('msg').innerText = 'Merestart, tunggu sebentar...';
                    await fetch('/restart-wa');
                    setTimeout(() => location.reload(), 3000);
                }
            </script>
        </body></html>
    `);
});

app.get('/restart-wa', async (req, res) => {
    await restartClient();
    res.json({ success: true, message: 'FSN re-check selesai', status: getStatus() });
});

app.get('/qr-text', (req, res) => {
    res.json({
        status: getStatus(),
        qr: getQR(), // selalu null di FSN mode
        engine: 'FSN API'
    });
});

// ── Status Endpoint ────────────────────────────────────────────────────────────
app.get('/status', (req, res) => {
    const waStatus = getStatus();
    res.json({
        wa_status: waStatus,
        engine: 'FSN API',
        uptime_seconds: Math.floor(process.uptime()),
        last_ping_success: getLastPingSuccess(),
        last_error: getLastError(),
        message: waStatus === 'ready'
            ? 'Bot aktif dan siap mengirim pesan via FSN API ✅'
            : `Bot belum siap. Status: ${waStatus}. Error: ${getLastError() || '-'}`
    });
});

// ── Manual Trigger — untuk testing ────────────────────────────────────────────
app.get('/run', async (req, res) => {
    if (getStatus() !== 'ready') {
        return res.status(503).json({
            success: false,
            error: `WA Client belum siap (status: ${getStatus()}). Cek /status untuk detail.`
        });
    }
    try {
        const result = await runScheduleCheck(client);
        res.json({ success: true, result });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ── Keep-Alive: Ping diri sendiri setiap 14 menit ─────────────────────────────
function keepAlive() {
    const url = process.env.RENDER_EXTERNAL_URL;
    if (!url) {
        console.log('[Keep-Alive] RENDER_EXTERNAL_URL tidak diset, skip ping.');
        return;
    }
    const target = `${url}/health`;
    const lib = target.startsWith('https') ? https : http;
    lib.get(target, (res) => {
        console.log(`[Keep-Alive] Ping ke ${target} → status ${res.statusCode}`);
    }).on('error', (err) => {
        console.error('[Keep-Alive] Ping gagal:', err.message);
    });
}

setTimeout(() => {
    keepAlive();
    setInterval(keepAlive, 14 * 60 * 1000);
}, 30000);

// ── Start HTTP Server ──────────────────────────────────────────────────────────
app.listen(PORT, () => {
    console.log(`[Server] Berjalan di port ${PORT}`);
    console.log(`[Server] Engine: FSN API — Buka /status untuk cek koneksi`);
});

// ── Init WA Client ─────────────────────────────────────────────────────────────
console.log('[WA] Memulai WhatsApp client via FSN API...');
initializeClient();

// ── Cron 1: Pengecekan Jadwal — setiap menit ───────────────────────────────────
cron.schedule('* * * * *', async () => {
    if (getStatus() !== 'ready') {
        console.log('[Cron] WA belum siap, skip pengecekan jadwal.');
        return;
    }
    try {
        await runScheduleCheck(client);
    } catch (error) {
        console.error('[Cron] Error jadwal:', error.message);
    }
}, { timezone: 'Asia/Jakarta' });

// ── Cron 2: Health-check FSN — setiap 5 menit ──────────────────────────────────
// Mengatasi masalah "Chrome menutup" / FSN disconnect:
// Jika status disconnected, otomatis re-ping FSN API.
cron.schedule('*/5 * * * *', async () => {
    const currentStatus = getStatus();
    console.log(`[Health-Cron] Cek status FSN API... (saat ini: ${currentStatus})`);

    if (currentStatus !== 'ready') {
        console.log('[Health-Cron] Status bukan ready — mencoba reconnect ke FSN API...');
        try {
            const ok = await pingFSN();
            if (ok) {
                console.log('[Health-Cron] ✅ FSN API kembali terhubung!');
            } else {
                console.warn('[Health-Cron] ⚠️ FSN API masih tidak dapat dijangkau, akan coba lagi dalam 5 menit.');
            }
        } catch (err) {
            console.error('[Health-Cron] Error saat reconnect:', err.message);
        }
    } else {
        // Tetap ping periodik meski sudah ready (detect silent failures)
        try {
            await pingFSN();
        } catch (err) {
            console.warn('[Health-Cron] Silent ping gagal:', err.message);
        }
    }
}, { timezone: 'Asia/Jakarta' });
