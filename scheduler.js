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
    // FSN API: cukup nomor internasional tanpa suffix
    return formatted;
};

async function runScheduleCheck(client) {
    try {
        const scheduleData = await fetchSheetData();

        const currentTime = moment().tz('Asia/Jakarta');
        const currentTimeStr = currentTime.format('HH:mm');
        const currentDayStr = currentTime.format('dddd');

        console.log(`[Scheduler] Memeriksa jadwal: ${currentTimeStr} (${currentDayStr})`);

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
            console.log(`[Scheduler] ${tasksToRun.length} jadwal cocok. Mengirim pesan...`);
            for (const task of tasksToRun) {
                const targetNumber = formatWANumber(task.nomorWa);
                if (!targetNumber) continue;

                const tanggalFormat = currentTime.format('dddd, D MMMM YYYY');

                const textMsg = `📢 *Reminder Les Omaetee Course*\n\nHalo, ${task.namaMurid}! 👋\nKamu memiliki jadwal les hari ini 😊\n\n📚 *Detail Jadwal:*\n\nPenutor: Kak ${task.namaTutor}\nHari/Tanggal: ${tanggalFormat}\nJam: ${task.jam}\n\nJika berhalangan hadir, mohon informasikan kepada admin maksimal 3 jam sebelum kelas dimulai.\n\nTerima kasih dan semangat belajar! 😊\n\nAdmin OMAETEE COURSE 🙌🏻`;

                try {
                    await client.sendMessage(targetNumber, textMsg);
                    console.log(`[WA] Berhasil mengirim pesan ke ${task.nomorWa}`);
                } catch (sendErr) {
                    console.error(`[WA] Gagal mengirim pesan ke ${task.nomorWa}:`, sendErr.message);
                }
                
                // Jeda acak antara 3 sampai 7 detik agar terlihat seperti manusia mengirim pesan
                const randomDelay = Math.floor(Math.random() * (7000 - 3000 + 1)) + 3000;
                await new Promise(resolve => setTimeout(resolve, randomDelay));
            }
        } else {
            console.log(`[Scheduler] Tidak ada jadwal cocok untuk ${currentDayStr} ${currentTimeStr}.`);
        }

        return { sent: tasksToRun.length, total: scheduleData.length };
    } catch (error) {
        console.error('[Scheduler] Error:', error.message);
        throw error;
    }
}

module.exports = { runScheduleCheck };
