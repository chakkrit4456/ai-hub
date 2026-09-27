// บริการแชทกลาง — ทั้งเว็บและ Discord เรียกผ่านที่นี่ เพื่อให้ข้อมูลตรงกัน
import * as store from './store.js';
import { chat } from './openrouter.js';

const HISTORY_LIMIT = 40; // ส่งประวัติย้อนหลังสูงสุดกี่ข้อความ
const running = new Map(); // conversationId -> AbortController

export function isBusy(id) {
  return running.has(id);
}

export function stop(id) {
  const ac = running.get(id);
  if (ac) ac.abort();
  return !!ac;
}

/**
 * ส่งข้อความเข้าแชท แล้วรอคำตอบจาก AI
 * @param {object} o
 * @param {string} o.text ข้อความผู้ใช้
 * @param {string} [o.conversationId] ไม่ระบุ = ใช้แชทที่เปิดอยู่ (ไม่มีก็สร้างใหม่)
 * @param {string} [o.model] ไม่ระบุ = ใช้โมเดลปัจจุบัน
 * @param {'web'|'discord'} o.source
 * @param {(delta:string)=>void} [o.onToken]
 */
export async function send({ text, conversationId, model, source, onToken }) {
  let c = conversationId ? store.getConversation(conversationId) : store.getActive();
  if (!c) c = store.createConversation({ source });
  if (running.has(c.id)) throw new Error('แชทนี้กำลังตอบอยู่ รอสักครู่หรือกดหยุดก่อน');

  const useModel = model || store.getCurrentModel();
  store.addMessage(c.id, { role: 'user', content: text }, source);

  const messages = [];
  if (c.systemPrompt) messages.push({ role: 'system', content: c.systemPrompt });
  for (const m of c.messages.slice(-HISTORY_LIMIT)) {
    if (m.error) continue;
    messages.push({ role: m.role, content: m.content });
  }

  const ac = new AbortController();
  running.set(c.id, ac);
  store.events.emit('stream', { type: 'start', id: c.id, model: useModel, source });
  try {
    const r = await chat({
      model: useModel,
      messages,
      signal: ac.signal,
      onToken: (delta) => {
        store.events.emit('stream', { type: 'token', id: c.id, delta });
        onToken?.(delta);
      },
    });
    const reply = store.addMessage(
      c.id,
      { role: 'assistant', content: r.content || '(ไม่มีข้อความตอบกลับ)', model: r.model, usage: r.usage || null },
      source,
    );
    return { conversation: c, reply };
  } catch (e) {
    const aborted = e.name === 'AbortError';
    const reply = store.addMessage(
      c.id,
      { role: 'assistant', content: aborted ? 'หยุดการตอบแล้ว' : `เกิดข้อผิดพลาด: ${e.message}`, model: useModel, error: true },
      source,
    );
    return { conversation: c, reply, error: aborted ? null : e.message };
  } finally {
    running.delete(c.id);
    store.events.emit('stream', { type: 'end', id: c.id });
  }
}
