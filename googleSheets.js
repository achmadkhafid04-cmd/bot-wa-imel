const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');
require('dotenv').config();

const SPREADSHEET_ID = process.env.SPREADSHEET_ID;

let clientEmail = process.env.GOOGLE_CLIENT_EMAIL;
let privateKey = process.env.GOOGLE_PRIVATE_KEY;

if (!clientEmail || !privateKey) {
  try {
    const credentials = require('./credentials.json');
    clientEmail = credentials.client_email;
    privateKey = credentials.private_key;
  } catch (err) {
    console.error("Kredensial tidak ditemukan! Pastikan GOOGLE_CLIENT_EMAIL dan GOOGLE_PRIVATE_KEY diisi.");
  }
} else {
  // Perbaiki format baris baru (newline) jika ter-escape di Vercel
  privateKey = privateKey.replace(/\\n/g, '\n');
}

const serviceAccountAuth = new JWT({
  email: clientEmail,
  key: privateKey,
  scopes: [
    'https://www.googleapis.com/auth/spreadsheets',
  ],
});

const doc = new GoogleSpreadsheet(SPREADSHEET_ID, serviceAccountAuth);

async function fetchSheetData() {
  try {
    await doc.loadInfo(); 
    
    // Ambil sheet pertama (index 0)
    const sheet = doc.sheetsByIndex[0];
    
    // Pastikan header row adalah baris 1 (default)
    await sheet.loadHeaderRow(1);
    const rows = await sheet.getRows();
    
    const data = rows.map(row => {
      return {
        id: row.get('ID'),
        namaTutor: row.get('Nama_Tutor'),
        nomorWa: row.get('Nomor_WA'),
        waktuHarian: row.get('Waktu_Harian'),
        namaMurid: row.get('Nama_Murid'),
        hari: row.get('Hari'),
        jam: row.get('Jam'),
        statusAktif: row.get('Status_Aktif'),
      };
    });
    
    console.log(`[Google Sheets] Successfully fetched ${data.length} rows dari format datar.`);
    return data;
  } catch (error) {
    console.error('[Google Sheets] Error fetching data:', error.message);
    return []; 
  }
}

module.exports = { fetchSheetData };
