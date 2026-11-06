// Masaüstündeki chat sayfasına enjekte edilen betikleri telefon uygulamasına kopyalar.
// Kullanım: npm run sync-injected
const fs = require('fs');
const path = require('path');
const src = (f) => fs.readFileSync(path.join(__dirname, '../../desktop/src', f), 'utf8');
const out =
  '// OTOMATİK ÜRETİLDİ: desktop/src/fit-popups.js + pick-user.js (npm run sync-injected)\n' +
  `export const FIT_POPUPS_JS = ${JSON.stringify(src('fit-popups.js'))};\n` +
  `export const PICK_USER_JS = ${JSON.stringify(src('pick-user.js'))};\n`;
fs.writeFileSync(path.join(__dirname, '../src/injected.js'), out);
console.log('src/injected.js güncellendi');
