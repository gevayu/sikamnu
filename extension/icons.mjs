// מייצר את אייקוני המצב ב-icons/ בלי תלויות. להריץ: node icons.mjs
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';

const W = 128;
const crc = (b) => { let c = ~0; for (const x of b) { c ^= x; for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1; } return (~c) >>> 0; };
const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };

/** paint(x, y) מחזיר [r,g,b,a] */
function png(paint) {
  const raw = Buffer.alloc((W * 4 + 1) * W);
  for (let y = 0; y < W; y++) {
    raw[y * (W * 4 + 1)] = 0;
    for (let x = 0; x < W; x++) raw.set(paint(x, y), y * (W * 4 + 1) + 1 + x * 4);
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(W, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const inCircle = (x, y, r = 56) => (x - 64) ** 2 + (y - 64) ** 2 < r * r;
const inBars = (x, y) => y > 40 && y < 88 && ((x > 44 && x < 58) || (x > 70 && x < 84));
// סימן קריאה: קו אנכי ונקודה
const inBang = (x, y) => (x > 57 && x < 71 && y > 30 && y < 76) || ((x - 64) ** 2 + (y - 90) ** 2 < 64);
const warn = (alpha = 255) => (x, y) => inBang(x, y) ? [255, 255, 255, alpha] : inCircle(x, y) ? [200, 40, 40, alpha] : [0, 0, 0, 0];
const circle = (rgb) => (x, y) => inCircle(x, y) ? [...rgb, 255] : [0, 0, 0, 0];
const pause = (bg, fg, alpha = 255) => (x, y) => inBars(x, y) ? [...fg, alpha] : inCircle(x, y) ? [...bg, alpha] : [0, 0, 0, 0];

mkdirSync('icons', { recursive: true });
const icons = {
  idle: circle([120, 120, 120]),                       // אפור: אין שיחה
  pause: pause([245, 166, 35], [40, 40, 40]),          // כתום עם ‖: זוהתה שיחה, מחכה ללחיצה
  'pause-dim': pause([245, 166, 35], [40, 40, 40], 90),// אותו דבר שקוף, להבהוב
  armed: pause([26, 26, 26], [245, 166, 35]),          // כהה עם ‖ כתום: לכידה ל-buffer, לא מוקלט
  rec: circle([211, 51, 51]),                          // אדום: מקליט
  busy: circle([60, 60, 200]),                         // כחול: מתמלל ומסכם
  warn: warn(),                                        // אדום עם !: זוהתה שיחה, אבל ההקלטה לא תעבוד
  'warn-dim': warn(90),
};
for (const [name, p] of Object.entries(icons)) writeFileSync(`icons/${name}.png`, png(p));
console.log('icons:', Object.keys(icons).join(', '));
