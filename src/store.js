// เก็บข้อมูลทั้งหมดในไฟล์ JSON เดียว (data/db.json) — ใช้ร่วมกันทั้งเว็บและ Discord
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import { config } from './config.js';

const DATA_DIR = path.resolve('data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

export const events = new EventEmitter();
events.setMaxListeners(100);

let db = {
  currentModel: config.defaultModel,
  activeId: null,
  conversations: {},
};

function load() {
  try {
    if (fs.existsSync(DB_FILE)) db = { ...db, ...JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) };
  } catch (e) {
    console.error('[store] อ่าน db.json ไม่ได้ เริ่มใหม่:', e.message);
  }
}

let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = DB_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
    fs.renameSync(tmp, DB_FILE);
  }, 150);
}

function changed(type, payload = {}) {
  save();
  events.emit('change', { type, ...payload });
}

load();

export const newId = () => crypto.randomBytes(5).toString('hex');

export function summary(c) {
  return {
    id: c.id,
    title: c.title,
    model: c.model,
    source: c.source,
    updatedAt: c.updatedAt,
    count: c.messages.length,
  };
}

export function getState() {
  const conversations = Object.values(db.conversations)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map(summary);
  return {
    currentModel: db.currentModel,
    activeId: db.activeId,
    conversations,
    favorites: config.favoriteModels,
  };
}

export function listConversations(limit = 50) {
  return getState().conversations.slice(0, limit);
}

export function getConversation(id) {
  return db.conversations[id] || null;
}

export function getActive() {
  return db.activeId ? db.conversations[db.activeId] || null : null;
}

export function getCurrentModel() {
  return db.currentModel;
}

export function setCurrentModel(model, source = 'web') {
  db.currentModel = model;
  changed('model', { model, source });
}

export function createConversation({ title, source = 'web', model } = {}) {
  const now = Date.now();
  const c = {
    id: newId(),
    title: title || 'แชทใหม่',
    model: model || db.currentModel,
    systemPrompt: config.systemPrompt,
    source,
    createdAt: now,
    updatedAt: now,
    messages: [],
  };
  db.conversations[c.id] = c;
  db.activeId = c.id;
  changed('conversation:new', { id: c.id, source });
  return c;
}

export function setActive(id, source = 'web') {
  if (!db.conversations[id]) return false;
  db.activeId = id;
  changed('active', { id, source });
  return true;
}

export function updateConversation(id, patch, source = 'web') {
  const c = db.conversations[id];
  if (!c) return null;
  for (const k of ['title', 'systemPrompt', 'model']) if (patch[k] !== undefined) c[k] = patch[k];
  c.updatedAt = Date.now();
  changed('conversation:update', { id, source });
  return c;
}

export function deleteConversation(id, source = 'web') {
  if (!db.conversations[id]) return false;
  delete db.conversations[id];
  if (db.activeId === id) db.activeId = null;
  changed('conversation:delete', { id, source });
  return true;
}

export function addMessage(id, msg, source = 'web') {
  const c = db.conversations[id];
  if (!c) return null;
  const m = { id: newId(), at: Date.now(), source, ...msg };
  c.messages.push(m);
  c.updatedAt = m.at;
  if (msg.role === 'user' && c.messages.filter((x) => x.role === 'user').length === 1 && c.title === 'แชทใหม่') {
    c.title = msg.content.replace(/\s+/g, ' ').slice(0, 48);
  }
  changed('message', { id, messageId: m.id, source });
  return m;
}
