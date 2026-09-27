// ตัวเชื่อมต่อ OpenRouter — https://openrouter.ai/docs
import { config } from './config.js';

const BASE = process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1';

function headers() {
  return {
    Authorization: `Bearer ${config.openrouterKey}`,
    'Content-Type': 'application/json',
    'HTTP-Referer': 'https://rvc.ac.th',
    'X-Title': config.appName,
  };
}

async function errorText(res) {
  try {
    const j = await res.json();
    return j?.error?.message || JSON.stringify(j);
  } catch {
    return res.statusText;
  }
}

// ---------- รายชื่อโมเดล (แคช 1 ชั่วโมง) ----------
let modelCache = { at: 0, list: [] };

export async function listModels(force = false) {
  if (!force && modelCache.list.length && Date.now() - modelCache.at < 3600_000) return modelCache.list;
  const res = await fetch(`${BASE}/models`, { headers: headers() });
  if (!res.ok) throw new Error(`โหลดรายชื่อโมเดลไม่ได้: ${await errorText(res)}`);
  const { data } = await res.json();
  const perM = (v) => (v == null ? null : Number(v) * 1_000_000);
  const list = data.map((m) => ({
    id: m.id,
    name: m.name || m.id,
    context: m.context_length || null,
    inputPrice: perM(m.pricing?.prompt), // USD ต่อ 1M token
    outputPrice: perM(m.pricing?.completion),
    free: m.id.endsWith(':free') || (Number(m.pricing?.prompt) === 0 && Number(m.pricing?.completion) === 0),
  }));
  if (!list.find((m) => m.id === 'openrouter/auto'))
    list.unshift({ id: 'openrouter/auto', name: 'Auto Router (เลือกโมเดลให้อัตโนมัติ)', context: null, inputPrice: null, outputPrice: null, free: false });
  modelCache = { at: Date.now(), list };
  return list;
}

export async function findModel(id) {
  try {
    return (await listModels()).find((m) => m.id === id) || null;
  } catch {
    return null;
  }
}

export async function searchModels(q, limit = 25) {
  const list = await listModels();
  const s = (q || '').toLowerCase().trim();
  const fav = config.favoriteModels;
  const scored = list
    .filter((m) => !s || m.id.toLowerCase().includes(s) || m.name.toLowerCase().includes(s))
    .sort((a, b) => {
      const fa = fav.indexOf(a.id), fb = fav.indexOf(b.id);
      if (fa !== fb) return (fa === -1 ? 999 : fa) - (fb === -1 ? 999 : fb);
      return a.id.localeCompare(b.id);
    });
  return scored.slice(0, limit);
}

// ---------- เครดิตคงเหลือ ----------
export async function getCredits() {
  const res = await fetch(`${BASE}/credits`, { headers: headers() });
  if (!res.ok) throw new Error(await errorText(res));
  const { data } = await res.json();
  return { total: data.total_credits, used: data.total_usage, remaining: data.total_credits - data.total_usage };
}

// ---------- แชทแบบ streaming ----------
// onToken(textChunk) ถูกเรียกทุกครั้งที่ได้ข้อความใหม่
// คืนค่า { content, model, usage }
export async function chat({ model, messages, onToken, signal }) {
  const res = await fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ model, messages, stream: true, usage: { include: true } }),
    signal,
  });
  if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${await errorText(res)}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let content = '';
  let usedModel = model;
  let usage = null;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith('data:')) continue; // ข้ามบรรทัด comment เช่น ": OPENROUTER PROCESSING"
      const data = line.slice(5).trim();
      if (data === '[DONE]') continue;
      let j;
      try { j = JSON.parse(data); } catch { continue; }
      if (j.error) throw new Error(`OpenRouter: ${j.error.message || 'error'}`);
      if (j.model) usedModel = j.model;
      if (j.usage) usage = j.usage;
      const delta = j.choices?.[0]?.delta?.content;
      if (delta) {
        content += delta;
        onToken?.(delta);
      }
    }
  }
  return { content, model: usedModel, usage };
}
