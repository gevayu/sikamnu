import { createReadStream, promises as fs } from 'node:fs';
import http from 'node:http';
import { WebSocketServer, type RawData } from 'ws';
import { cfg } from './config.ts';
import { issues, startProviderChecks, status } from './health.ts';
import { callPage } from './page.ts';
import { CallSession, type StartMsg } from './session.ts';
import { store } from './store.ts';

const toBuffer = (d: RawData): Buffer => (Buffer.isBuffer(d) ? d : Array.isArray(d) ? Buffer.concat(d) : Buffer.from(d));
const json = (res: http.ServerResponse, code: number, body: unknown) => {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', cfg.publicUrl);
  const m = url.pathname.match(/^\/calls\/([0-9a-f-]{36})(\.json|\/audio)?$/);

  if (url.pathname === '/health') {
    // התוסף בודק את זה לפני לכידת הטאב. CORS פתוח כי אין כאן מידע רגיש, רק אילו מפתחות קיימים.
    res.setHeader('Access-Control-Allow-Origin', '*');
    // tokenOk: התוסף שולח את הטוקן שלו, כדי לגלות אי-התאמה לפני לכידה. בדפדפן 401 ב-WebSocket נראה בדיוק כמו "אין שרת".
    const token = url.searchParams.get('token');
    console.log(`[health] ${new Date().toISOString()} from ${req.headers.origin ?? 'no-origin'} token=${token === null ? 'none' : token === cfg.authToken ? 'ok' : 'MISMATCH'}`);
    return json(res, 200, { ok: true, tokenOk: token === null ? null : token === cfg.authToken, providers: status, issues: issues() });
  }
  if (url.pathname === '/calls') return json(res, 200, await store.listCalls());
  if (!m) return json(res, 404, { error: 'not found' });

  const call = await store.getCall(m[1]);
  if (!call) return json(res, 404, { error: 'call not found' });

  if (m[2] === '.json') return json(res, 200, call);
  if (m[2] === '/audio') {
    const a = await store.audio(call.id);
    if (!a) return json(res, 404, { error: 'no audio' });
    if ('url' in a) { res.writeHead(302, { Location: a.url }); return res.end(); }
    const { size } = await fs.stat(a.path);
    res.writeHead(200, { 'Content-Type': a.mime, 'Content-Length': size, 'Accept-Ranges': 'none' });
    return createReadStream(a.path).pipe(res);
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(callPage(call));
});

const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url ?? '/', cfg.publicUrl);
  const token = url.searchParams.get('token');
  const stamp = `${new Date().toISOString()} from ${req.headers.origin ?? 'no-origin'}`;
  if (url.pathname !== '/ws' || token !== cfg.authToken) {
    console.warn(`[ws] REJECTED ${stamp}: ${url.pathname !== '/ws' ? `path ${url.pathname}` : `token ${token === null ? 'missing' : `mismatch (${token.length} chars)`}`}`);
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    return socket.destroy();
  }
  console.log(`[ws] accepted ${stamp}`);
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws));
});

wss.on('connection', (ws) => {
  let session: CallSession | undefined;
  const fail = (e: unknown) => {
    console.error('[ws]', e);
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: 'error', message: e instanceof Error ? e.message : String(e) }));
  };

  ws.on('message', async (data, isBinary) => {
    if (isBinary) return session?.onAudio(toBuffer(data));
    let msg: any;
    try { msg = JSON.parse(data.toString()); } catch { return fail('bad json'); }
    try {
      switch (msg.type) {
        case 'start':
          if (session) return fail('session already started');
          session = await CallSession.create(ws, msg as StartMsg);
          console.log(`[call] ${session.id} ${msg.mode}/${msg.language} via ${session.provider.id}`);
          break;
        case 'marker': session?.mark(); break;
        case 'speaker': session?.speaker(String(msg.name ?? '')); break;
        case 'stop': await session?.stop(); ws.close(); break;
        default: fail(`unknown message ${msg.type}`);
      }
    } catch (e) { fail(e); }
  });

  // ניתוק בלי stop (הטאב נסגר): לא מאבדים את מה שהוקלט
  ws.on('close', () => { session?.stop().catch((e) => console.error('[stop on close]', e)); });
});

// שגיאה שלא נתפסה בשיחה אחת לא מפילה את השרת לכל השאר. חריגה סינכרונית כן מסיימת את התהליך, ו-server-loop.cmd מעלה אותו מחדש.
process.on('unhandledRejection', (e) => console.error('[unhandledRejection]', e));
process.on('uncaughtException', (e) => { console.error('[uncaughtException]', e); process.exit(1); });

startProviderChecks();
server.listen(cfg.port, () => console.log(`Si-kam-nu server on ${cfg.publicUrl} (STT: deepgram=${!!cfg.deepgramKey} assemblyai=${!!cfg.assemblyKey}, summary=${!!cfg.anthropicKey}, store=${cfg.supabaseUrl ? 'supabase' : cfg.dataDir})`));
