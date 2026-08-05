const axios = require('axios');
const moment = require('moment-timezone');
require('moment/locale/id');
moment.locale('id');

const { fetchSheetData } = require('./googleSheets');

const formatWANumber = (number) => {
    if (!number) return null;
    let formatted = number.toString().trim();
    formatted = formatted.replace(/\D/g, '');
    if (formatted.startsWith('0')) {
        formatted = '62' + formatted.substring(1);
    }
    return formatted;
};

const WA_API_URL = process.env.WA_API_URL;
const WA_API_TOKEN = process.env.WA_API_TOKEN;

async function sendWhatsAppMessage(target, message) {
    if (!WA_API_URL) {
        console.error('[API] URL API belum diatur.');
        return;
    }
    try {
        await axios.post(WA_API_URL, {
            phone: target,
            message: message
        }, {
            headers: {
                'X-API-Key': WA_API_TOKEN,
                'Content-Type': 'application/json'
            }
        });
        console.log(`[API] Berhasil mengirim ke ${target}`);
    } catch (error) {
        console.error(`[API] Gagal mengirim pesan ke ${target}:`, error.response ? error.response.data : error.message);
    }
}

// Fungsi utama Serverless (Berjalan di Root URL)
module.exports = async function (req, res) {
    try {
        const scheduleData = await fetchSheetData();

        const currentTime = moment().tz('Asia/Jakarta');
        const currentTimeStr = currentTime.format('HH:mm');
        const currentDayStr = currentTime.format('dddd');

        console.log(`[Vercel Cron] Memeriksa jadwal untuk: ${currentTimeStr} (Hari: ${currentDayStr})`);

        const tasksToRun = scheduleData.filter(row => {
            const isActive = row.statusAktif && row.statusAktif.toString().trim().toUpperCase() === 'TRUE';
            if (!isActive || !row.nomorWa) return false;

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
            for (const task of tasksToRun) {
                const targetNumber = formatWANumber(task.nomorWa);
                if (!targetNumber) continue;

                let textMsg = `👨‍🏫 *Reminder Jadwal Mengajar*\n\nHalo, Kak ${task.namaTutor}! 👋\nBerikut pengingat jadwal mengajar hari ini.\n\n📖 *Detail Mengajar:*\n👩🏻‍🎓 Nama Murid: ${task.namaMurid}\n📅 Hari: ${task.hari}\n⏰ Jam: ${task.jam}\n\nMohon untuk mempersiapkan materi sebelum kelas dimulai dan hadir 5–10 menit lebih awal.\n\nApabila terdapat kendala atau berhalangan mengajar, mohon segera menghubungi admin.\n\nTerima kasih atas kerja samanya. 😊\n\nAdmin OMAETEE COURSE 🙌🏻`;

                await sendWhatsAppMessage(targetNumber, textMsg);

                // Beri jeda 2 detik
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
        }

        return res.status(200).json({
            success: true,
            message: `Dicek ${scheduleData.length} baris. Mengirim ${tasksToRun.length} pesan untuk hari ${currentDayStr} jam ${currentTimeStr}.`
        });

    } catch (error) {
        console.error('[Vercel Cron] Error:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
};
