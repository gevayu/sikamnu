# Si-kam-nu

תוסף כרום שמתמלל ומסכם שיחות Google Meet ו-Zoom Web בעברית, בלי בוט בשיחה.
לכל שיחה עמוד אחד: תמליל ניתן לעריכה, סיכום, בולטים, Action Items.
המסמך המלא: `docs/PRD.md` (גרסה 0.3). שם נסגרות ההחלטות. כאן רק מה שצריך כדי לכתוב קוד נכון.

## מבנה

- `extension/` תוסף Manifest V3. esbuild מ-`src/` ל-`dist/`. בלי React, בלי bundler מעבר ל-esbuild.
- `server/` Node 24 עם type stripping נייטיבי (`node src/index.ts`, בלי tsx). `tsc` רק לבדיקת טיפוסים ולבנייה.
- `supabase/migrations/` סכמה. בפיתוח בלי Supabase השרת כותב ל-`server/data/`.
- `docs/PRD.md` מקור האמת המוצרי.

## החלטות ארכיטקטורה שלא משנים בלי לעדכן את ה-PRD

1. **אודיו נלכד מהטאב ומהמיקרופון בנפרד**, כשני ערוצים: ערוץ 0 = מיקרופון (אני), ערוץ 1 = טאב (הם). PCM16LE, 16kHz, interleaved. "אני/הם" לא תלוי בדיאריזציה.
2. **שני מצבי תמלול לכל שיחה, המשתמש בוחר.** `live` = סטרימינג, תמליל חי בפאנל, מודל streaming. `batch` = הקלטה בלבד ותמלול הקובץ הסגור בסיום, מודל pre-recorded, זול ב-45% ומדויק יותר. ברירת המחדל `batch`. לא מריצים את שניהם על אותה שיחה.
3. **שכבת STT מופשטת.** `server/src/stt/types.ts` הוא הממשק. ספק = adapter. בחירת ספק ב-`server/src/stt/index.ts` לפי (מצב, שפה) ואפשר לדרוס ב-env. Deepgram Nova-3 לעברית נקייה. AssemblyAI לשיחות מעורבות עברית-אנגלית (Deepgram multi לא תומך בעברית).
4. **מפתחות API בשרת בלבד.** התוסף מדבר רק עם השרת שלנו ב-WebSocket.
5. **אחסון אודיו דלוק כברירת מחדל, 90 יום.** Opus דרך ffmpeg אם מותקן, אחרת WAV. בלי אודיו אין תיקון תמליל ואין "לחץ על משפט ותשמע".
6. **עברית קודם.** כל UI ב-RTL. סיכום בשפת השיחה. מונחים באנגלית נשארים באנגלית.
7. **Zoom דסקטופ לא נתמך.** רק Zoom בדפדפן. כותבים את זה למשתמש.

## פרוטוקול תוסף ↔ שרת (`/ws?token=`)

- טקסט JSON מהתוסף: `start {mode, language, sampleRate, channels, keyterms, meta}`, `marker`, `speaker {name}`, `stop`.
- בינארי מהתוסף: PCM16LE stereo. השעון של השיחה = בייטים שהתקבלו / (16000·2·2).
- טקסט JSON מהשרת: `started {callId, provider}`, `segment {…}`, `status`, `done {url}`, `error`.

## הרצה

```
cp .env.example .env      # למלא מפתחות
npm install
npm run build             # בונה את extension/dist
npm run dev               # שרת על :8787
```
בלי טרמינל: לחיצה כפולה על `start-server.cmd`. התוסף בודק `/health` לפני לכידת הטאב ומציג "השרת לא רץ" אם אין תשובה.

על המחשב של יובל השרת עולה מוסתר בכל כניסה ל-Windows: עותק של `start-server-hidden.vbs` נמצא ב-`%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\Si-kam-nu server.vbs`. הוא מריץ את `server-loop.cmd`, שמעלה את השרת מחדש 5 שניות אחרי כל קריסה. פלט ב-`server.log`. שינוי ב-vbs בריפו לא משפיע עד שמעתיקים אותו שוב ל-Startup.

- **אין `--watch` בכוונה.** שינוי בקוד או ב-.env לא מפיל הקלטה באמצע. כדי לטעון שינויים: `restart-server.cmd`, רק כשאין הקלטה (בודקים שאין `sikamnu-*.pcm` שגדל ב-`%TEMP%`).
- **עצירה מלאה:** `stop-server.cmd`, עוצר גם את הלולאה.
- **בדיקת ספקים:** `server/src/health.ts` בודק את Deepgram (כולל יתרה), AssemblyAI ו-Anthropic בעלייה ופעם ביום. `/health?token=` מחזיר `providers`, `issues` ו-`tokenOk`. התוסף מריץ את הבדיקה בכל כניסה לשיחה ובכל heartbeat, ומציג אייקון אזהרה והתראה לפני ההקלטה.
- **גיבוי ספק:** `providerChain` ב-`server/src/stt/index.ts` מחזיר את הספקים לפי סדר. שיחה עוברת לספק השני אם הראשון נכשל. אם כולם נכשלו, השיחה נשמרת עם האודיו ושדה `error`, לא נמחקת.
- **תמלול מחדש:** `node --env-file=../.env src/recover.ts <file.wav> [he|multi] [כותרת] [callId]` מתיקיית `server`. לשיחה שנכשלה, או ל-`sikamnu-<id>.wav` שנשאר ב-`%TEMP%` אחרי קריסה.
- **דיבוג חיבור:** `server.log` רושם כל `[health]` ו-`[ws] REJECTED` עם הסיבה. רוב תקלות "אין חיבור" עד היום היו טוקן לא נכון בהגדרות התוסף.
טוענים את `extension/` כ-unpacked ב-chrome://extensions. פעם ראשונה: הגדרות, "אפשר מיקרופון". נכנסים ל-Meet, האייקון הופך ל-PAUSE כתום מהבהב, לוחצים עליו וההקלטה מתחילה (autoRecord) והאייקון אדום. האייקונים נוצרים ב-`extension/icons.mjs`. `tabCapture` מקבל activeTab רק בלחיצה על האייקון, לכן הלכידה חייבת להתחיל בתוך `action.onClicked`. אין דרך להתחיל בלי לחיצה.

## סגנון קוד

- ponytail: המינימום שעובד. פינה שנחתכה מסומנת `// ponytail:` עם מסלול השדרוג.
- בלי תלויות חדשות על מה ששתי שורות עושות. תלויות בשרת: `ws`, `@anthropic-ai/sdk`, `@supabase/supabase-js`.
- טקסט שהמשתמש רואה: עברית, קצר, בלי אימוג'ים. ראה `gevayu-anti-slop`.
- סלקטורים של Meet/Zoom חיים רק ב-`extension/src/content/*.ts` בקבוע אחד למעלה. הם נשברים, זה צפוי.

## מה עוד לא קיים (לפי PRD)

- עריכת תמליל inline, מצא והחלף, "סכם מחדש" (שבועות 5-7).
- אימות משתמשים. כרגע `AUTH_TOKEN` אחד.
- ייצוא DOCX/PDF, מילון ללקוח, חיפוש, לקוחות (P1).
