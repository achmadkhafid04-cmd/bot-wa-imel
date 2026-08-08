/**
 * waClient.js — WA Client via FSN API (FullStackNotes)
 *
 * Tidak ada Chrome/Chromium di sini. Semua pengiriman pesan
 * dilakukan via HTTP request ke FSN API endpoint.
 *
 * Status koneksi dipantau dengan ping ke FSN API setiap beberapa menit
 * (diatur via cronjob di index.js).
 */

const https = require('https');
const http = require('http');

const FSN_API_URL = process.env.WA_API_URL || 'https://api.fullstacknotes.org/api/v1/messages/send';
const FSN_API_TOKEN = process.env.WA_API_TOKEN;

let clientStatus = 'initializing'; // initializing | ready | disconnected | error
let lastError = null;
let lastPingSuccess = null;

// ── Helper: HTTP POST via Node built-in ───────────────────────────────────────
function httpPost(url, token, payload) {
    return new Promise((resolve, reject) => {
        const body = JSON.stringify(payload);
        const parsed = new URL(url);
        const lib = parsed.protocol === 'https:' ? https : http;

        const options = {
            hostname: parsed.hostname,
            port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
            path: parsed.pathname + parsed.search,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`,
                'Content-Length': Buffer.byteLength(body)
            },
            timeout: 15000
        };

        const req = lib.request(options, (res) => {
            let data = '';
            res.on('data', chunk => { data += chunk; });
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    try { resolve(JSON.parse(data)); }
                    catch { resolve({ raw: data }); }
                } else {
                    reject(new Error(`FSN API error: HTTP ${res.statusCode} — ${data}`));
                }
            });
        });

        req.on('timeout', () => {
            req.destroy();
            reject(new Error('FSN API timeout (15s)'));
        });

        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

// ── Health Check: ping ke FSN API ─────────────────────────────────────────────
async function pingFSN() {
    if (!FSN_API_TOKEN) {
        console.warn('[WA] WA_API_TOKEN belum diset di environment!');
        clientStatus = 'error';
        lastError = 'WA_API_TOKEN missing';
        return false;
    }

    try {
        // Ping dengan nomor dummy — FSN akan return error validasi tapi server reachable
        // Kita cukup pastikan tidak dapat network error / timeout
        const parsed = new URL(FSN_API_URL);
        const lib = parsed.protocol === 'https:' ? https : http;

        await new Promise((resolve, reject) => {
            const req = lib.get({
                hostname: parsed.hostname,
                path: '/',
                timeout: 8000
            }, res => resolve(res));
            req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
            req.on('error', reject);
        });

        clientStatus = 'ready';
        lastPingSuccess = new Date().toISOString();
        lastError = null;
        console.log('[WA] FSN API reachable — status: ready ✅');
        return true;
    } catch (err) {
        clientStatus = 'disconnected';
        lastError = err.message;
        console.warn(`[WA] FSN API tidak dapat dijangkau: ${err.message}`);
        return false;
    }
}

// ── Initialize Client ──────────────────────────────────────────────────────────
async function initializeClient() {
    console.log('[WA] Memulai WA Client via FSN API...');

    if (!FSN_API_TOKEN) {
        console.error('[WA] FATAL: WA_API_TOKEN tidak ditemukan di environment!');
        clientStatus = 'error';
        lastError = 'WA_API_TOKEN missing';
        return;
    }

    // Pertama kali ping untuk set status awal
    const ok = await pingFSN();
    if (ok) {
        console.log('[WA] WA Client siap! Menggunakan FSN API ✅');
    }
}

// ── Restart: untuk kompatibilitas endpoint /restart-wa ────────────────────────
async function restartClient() {
    console.log('[WA] Restart WA Client (FSN API mode) — melakukan re-check...');
    clientStatus = 'initializing';
    await pingFSN();
}

// ── Send Message ──────────────────────────────────────────────────────────────
const client = {
    /**
     * Kirim pesan WhatsApp via FSN API.
     * @param {string} to - Nomor WA format internasional, e.g. "628123456789"
     * @param {string} message - Isi pesan
     */
    sendMessage: async (to, message) => {
        if (!FSN_API_TOKEN) {
            throw new Error('[WA] WA_API_TOKEN belum diset!');
        }

        // FSN API mungkin menerima nomor tanpa @s.whatsapp.net
        // Kita strip suffix jika ada
        const normalizedTo = to.replace('@s.whatsapp.net', '').replace('@c.us', '');

        const payload = {
            phone: normalizedTo,
            message: message
        };

        try {
            const result = await httpPost(FSN_API_URL, FSN_API_TOKEN, payload);
            clientStatus = 'ready';
            lastPingSuccess = new Date().toISOString();
            return result;
        } catch (err) {
            console.error(`[WA] Gagal kirim pesan via FSN API: ${err.message}`);
            // Tandai disconnected agar cronjob tahu perlu reconnect
            if (err.message.includes('timeout') || err.message.includes('ECONNREFUSED') || err.message.includes('ENOTFOUND')) {
                clientStatus = 'disconnected';
            }
            throw err;
        }
    }
};

// ── Getter ────────────────────────────────────────────────────────────────────
function getStatus() {
    return clientStatus;
}

function getQR() {
    // FSN API tidak pakai QR scan — return null
    return null;
}

function getLastError() {
    return lastError;
}

function getLastPingSuccess() {
    return lastPingSuccess;
}

module.exports = {
    client,
    getQR,
    getStatus,
    getLastError,
    getLastPingSuccess,
    initializeClient,
    restartClient,
    pingFSN
};
