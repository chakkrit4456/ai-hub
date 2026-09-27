import express from 'express';
import cookieParser from 'cookie-parser';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, checkConfig } from './config.js';
import * as store from './store.js';
import * as chatService from './chat.js';
import { listModels, getCredits } from './openrouter.js';
import { startDiscord, discordStatus } from './discord.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const problems = checkConfig();
if (problems.length) {
  console.error('\n[ตั้งค่าไม่ครบ] แก้ไขไฟล์ .env ก่อน:\n - ' + problems.join('\n - ') + '\n');
  process.exit(1);
}

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser(config.sessionSecret));

// ---------- ล็อกอินด้วยรหัสผ่าน ----------
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest();
const failed = new Map(); // ip -> { n, until }

app.post('/api/login', (req, res) => {
  const ip = req.ip;
  const f = failed.get(ip);
  if (f && f.until > Date.now()) return res.status(429).json({ error: 'ลองผิดหลายครั้ง รอ 5 นาทีแล้วลองใหม่' });
  const ok = crypto.timingSafeEqual(sha(req.body?.password), sha(config.webPassword));
  if (!ok) {
    const n = (f?.n || 0) + 1;
    failed.set(ip, { n, until: n >= 5 ? Date.now() + 5 * 60_000 : 0 });
    return res.status(401).json({ error: 'รหัสผ่านไม่ถูกต้อง' });
  }
  failed.delete(ip);
  res.cookie('auth', 'ok', { signed: true, httpOnly: true, sameSite: 'lax', maxAge: 30 * 24 * 3600_000 });
  res.json({ ok: true });
});

app.post('/api/logout', (req, res) => {
  res.clearCookie('auth');
  res.json({ ok: true });
});

app.use('/api', (req, res, next) => {
  if (req.signedCookies?.auth === 'ok') return next();
  res.status(401).json({ error: 'ต้องล็อกอินก่อน' });
});

// ---------- API ----------
const wrap = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((e) => res.status(500).json({ error: e.message }));

app.get('/api/state', (req, res) => {
  res.json({ ...store.getState(), discord: discordStatus() });
});

app.get('/api/models', wrap(async (req, res) => {
  res.json(await listModels(req.query.refresh === '1'));
}));

app.get('/api/credits', wrap(async (req, res) => {
  res.json(await getCredits());
}));

app.post('/api/model', (req, res) => {
  const model = String(req.body?.model || '').trim();
  if (!model) return res.status(400).json({ error: 'ต้องระบุโมเดล' });
  store.setCurrentModel(model, 'web');
  res.json({ ok: true, model });
});

app.get('/api/conversations/:id', (req, res) => {
  const c = store.getConversation(req.params.id);
  if (!c) return res.status(404).json({ error: 'ไม่พบแชท' });
  res.json({ ...c, busy: chatService.isBusy(c.id) });
});

app.post('/api/conversations', (req, res) => {
  res.json(store.createConversation({ title: req.body?.title, source: 'web' }));
});

app.patch('/api/conversations/:id', (req, res) => {
  const c = store.updateConversation(req.params.id, req.body || {}, 'web');
  if (!c) return res.status(404).json({ error: 'ไม่พบแชท' });
  res.json(c);
});

app.delete('/api/conversations/:id', (req, res) => {
  res.json({ ok: store.deleteConversation(req.params.id, 'web') });
});

app.post('/api/active', (req, res) => {
  res.json({ ok: store.setActive(req.body?.id, 'web') });
});

app.post('/api/chat', wrap(async (req, res) => {
  const text = String(req.body?.text || '').trim();
  if (!text) return res.status(400).json({ error: 'ข้อความว่าง' });
  const r = await chatService.send({ text, conversationId: req.body?.conversationId, model: req.body?.model, source: 'web' });
  res.json({ conversationId: r.conversation.id, reply: r.reply, error: r.error || null });
}));

app.post('/api/stop', (req, res) => {
  res.json({ ok: chatService.stop(req.body?.id) });
});

// Server-Sent Events: ส่งข้อความสด + การเปลี่ยนแปลงจาก Discord มาที่หน้าเว็บ
app.get('/api/events', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.flushHeaders();
  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  const onChange = (d) => send('change', d);
  const onStream = (d) => send('stream', d);
  store.events.on('change', onChange);
  store.events.on('stream', onStream);
  const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
  req.on('close', () => {
    clearInterval(ping);
    store.events.off('change', onChange);
    store.events.off('stream', onStream);
  });
});

// ---------- หน้าเว็บ ----------
app.use(express.static(path.join(__dirname, '..', 'public')));

app.listen(config.port, () => {
  console.log(`\n${config.appName} พร้อมใช้งานที่ http://localhost:${config.port}\n`);
});

startDiscord().catch((e) => console.error('[discord] เริ่มบอทไม่ได้:', e.message));
