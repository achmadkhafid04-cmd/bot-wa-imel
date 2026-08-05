const { Client, RemoteAuth } = require('whatsapp-web.js');
const { MongoStore } = require('wwebjs-mongo');
const mongoose = require('mongoose');
const express = require('express');
const qrcode = require('qrcode-terminal');
const cron = require('node-cron');
const moment = require('moment-timezone');
require('moment/locale/id'); 
moment.locale('id'); 
const os = require('os');
require('dotenv').config();

const { fetchSheetData } = require('./googleSheets');

// 1. Setup Server Web (Express) agar Render.com tidak mematikan aplikasi
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.send('WhatsApp Bot is awake and running!');
});

app.listen(PORT, () => {
    console.log(`[Server] Web server is listening on port ${PORT}`);
});

// 2. Variabel & Helper Fungsi
let scheduleData = [];
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const formatWANumber = (number) => {
  if (!number) return null;
  let formatted = number.toString().trim();
  formatted = formatted.replace(/\D/g, '');
  if (formatted.startsWith('0')) {
    formatted = '62' + formatted.substring(1);
  }
  if (!formatted.endsWith('@c.us')) {
    formatted = `${formatted}@c.us`;
  }
  return formatted;
};

// 3. Setup MongoDB & WhatsApp Client
const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI || MONGODB_URI === 'your_mongodb_atlas_connection_string_here') {
    console.error('ERROR: MONGODB_URI belum diisi di file .env!');
    process.exit(1);
}

console.log('[MongoDB] Connecting to database...');
mongoose.connect(MONGODB_URI).then(() => {
    console.log('[MongoDB] Connected successfully!');
    const store = new MongoStore({ mongoose: mongoose });
    
    let chromePath = undefined;
    if (os.platform() === 'win32') {
        chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
    } else if (os.platform() === 'linux') {
        chromePath = '/usr/bin/google-chrome-stable';
    }

    const client = new Client({
        authStrategy: new RemoteAuth({
            store: store,
            backupSyncIntervalMs: 300000 // Sinkronisasi sesi ke database setiap 5 menit
        }),
        puppeteer: {
            executablePath: chromePath,
            args: [
                '--no-sandbox', 
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu'
            ],
            protocolTimeout: 300000, 
            timeout: 120000
        }
    });

    client.on('qr', (qr) => {
        console.log('[WhatsApp] Scan this QR code in your WhatsApp app to login:');
        qrcode.generate(qr, { small: true });
    });

    client.on('remote_session_saved', () => {
        console.log('[WhatsApp] Session saved to MongoDB successfully!');
    });

    client.on('ready', () => {
        console.log('[WhatsApp] Client is ready!');
        startJobs(client);
    });

    client.on('auth_failure', msg => {
        console.error('[WhatsApp] Authentication failure:', msg);
    });

    client.on('disconnected', (reason) => {
        console.log('[WhatsApp] Client was disconnected:', reason);
    });

    console.log('[System] Initializing WhatsApp Client...');
    client.initialize();

}).catch(err => {
    console.error('[MongoDB] Connection failed:', err.message);
});

async function startJobs(client) {
  console.log('[System] Starting background jobs...');

  scheduleData = await fetchSheetData();

  cron.schedule('0 * * * *', async () => {
    console.log('[Cron] Fetching latest data from Google Sheets...');
    scheduleData = await fetchSheetData();
  });

  cron.schedule('* * * * *', async () => {
    const currentTime = moment().tz('Asia/Jakarta');
    const currentTimeStr = currentTime.format('HH:mm'); 
    const currentDayStr = currentTime.format('dddd');
    
    console.log(`[Cron] Checking schedule for time: ${currentTimeStr} (Day: ${currentDayStr})`);

    const tasksToRun = scheduleData.filter(row => {
      const isActive = row.statusAktif && row.statusAktif.toString().trim().toUpperCase() === 'TRUE';
      if (!isActive) return false;
      if (!row.nomorWa) return false;
      
      let waktuHarian = row.waktuHarian ? row.waktuHarian.trim() : '';
      if (waktuHarian.length === 4 && waktuHarian.indexOf(':') === 1) { 
        waktuHarian = '0' + waktuHarian; 
      }
      waktuHarian = waktuHarian.replace('.', ':');
      
      const isTimeMatch = waktuHarian === currentTimeStr;
      
      let hariSheet = row.hari ? row.hari.trim().toLowerCase() : '';
      const isDayMatch = hariSheet === currentDayStr.toLowerCase();
      
      return isTimeMatch && isDayMatch;
    });

    if (tasksToRun.length > 0) {
      console.log(`[Cron] Found ${tasksToRun.length} message(s) to send at ${currentTimeStr}.`);
      
      for (const task of tasksToRun) {
        const targetNumber = formatWANumber(task.nomorWa);
        if (!targetNumber) continue;

        try {
          let textMsg = `👨‍🏫 *Reminder Jadwal Mengajar*

Halo, Kak ${task.namaTutor}! 👋
Berikut pengingat jadwal mengajar hari ini.

📖 *Detail Mengajar:*

👩🏻‍🎓 Nama Murid: ${task.namaMurid}
📅 Hari: ${task.hari}
⏰ Jam: ${task.jam}

Mohon untuk mempersiapkan materi sebelum kelas dimulai dan hadir 5–10 menit lebih awal.

Apabila terdapat kendala atau berhalangan mengajar, mohon segera menghubungi admin.

Terima kasih atas kerja samanya. 😊

Admin OMAETEE COURSE 🙌🏻`;
          
          await client.sendMessage(targetNumber, textMsg);
          console.log(`[WhatsApp] Sent reminder to ${task.namaTutor} (${targetNumber}) for student ${task.namaMurid}`);
          
          const delayMs = Math.floor(Math.random() * (5000 - 3000 + 1)) + 3000;
          await sleep(delayMs);
        } catch (err) {
          console.error(`[WhatsApp] Failed to send message to ${task.namaTutor} (${targetNumber}):`, err.message);
        }
      }
    }
  });
}
