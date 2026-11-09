import { DEFAULTS, getSettings, type Settings } from './shared.ts';

const fields = Object.keys(DEFAULTS) as (keyof Settings)[];
const el = (k: string) => document.getElementById(k) as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

async function listMics(selected: string) {
  const mic = el('micDeviceId') as HTMLSelectElement;
  mic.length = 1;
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    for (const d of devices.filter((d) => d.kind === 'audioinput'))
      mic.append(new Option(d.label || `מיקרופון ${mic.length}`, d.deviceId));
  } catch { /* בלי הרשאת מיקרופון אין שמות. נשאר ברירת מחדל. */ }
  mic.value = selected;
  const granted = await navigator.permissions.query({ name: 'microphone' as PermissionName }).then((p) => p.state === 'granted').catch(() => false);
  document.getElementById('micStatus')!.textContent = granted ? ' יש הרשאה' : ' אין הרשאה עדיין';
}

async function load() {
  const s = await getSettings();
  for (const k of fields) {
    if (typeof s[k] === 'boolean') (el(k) as HTMLInputElement).checked = s[k] as boolean;
    else el(k).value = String(s[k]);
  }
  await listMics(s.micDeviceId);
}

// ה-offscreen document לא יכול להציג בקשת הרשאה. מבקשים פעם אחת מעמוד גלוי של התוסף.
document.getElementById('allowMic')!.onclick = async () => {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
  } catch (e) {
    document.getElementById('micStatus')!.textContent = ` נדחה: ${e instanceof Error ? e.name : e}`;
    return;
  }
  await listMics((el('micDeviceId') as HTMLSelectElement).value);
};

document.getElementById('save')!.onclick = async () => {
  const s = Object.fromEntries(fields.map((k) => [k, typeof DEFAULTS[k] === 'boolean' ? (el(k) as HTMLInputElement).checked : el(k).value.trim()])) as unknown as Settings;
  await chrome.storage.sync.set(s);
  document.getElementById('saved')!.textContent = 'נשמר';
  setTimeout(() => (document.getElementById('saved')!.textContent = ''), 1500);
};

load();
