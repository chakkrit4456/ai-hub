// Discord bot — สั่งงานทุกอย่างได้ผ่าน slash command, @mention หรือ DM
import {
  Client, GatewayIntentBits, Partials, REST, Routes, SlashCommandBuilder, EmbedBuilder, Events,
} from 'discord.js';
import { config } from './config.js';
import * as store from './store.js';
import * as chatService from './chat.js';
import { searchModels, findModel, getCredits } from './openrouter.js';

const status = { enabled: false, ready: false, tag: null, error: null };
export const discordStatus = () => ({ ...status });

const ACCENT = 0x0f766e;

// ---------- นิยามคำสั่ง ----------
const chatOption = (o, desc = 'เลือกแชท') => o.setName('chat').setDescription(desc).setRequired(true).setAutocomplete(true);

const commands = [
  new SlashCommandBuilder().setName('ask').setDescription('ถาม AI ในแชทที่เปิดอยู่')
    .addStringOption((o) => o.setName('prompt').setDescription('คำถามหรือคำสั่ง').setRequired(true))
    .addStringOption((o) => o.setName('model').setDescription('ใช้โมเดลนี้เฉพาะครั้งนี้').setAutocomplete(true)),
  new SlashCommandBuilder().setName('model').setDescription('ดู เปลี่ยน หรือค้นหาโมเดล')
    .addSubcommand((s) => s.setName('current').setDescription('ดูโมเดลที่ใช้อยู่'))
    .addSubcommand((s) => s.setName('set').setDescription('เปลี่ยนโมเดล (มีผลทั้งเว็บและ Discord)')
      .addStringOption((o) => o.setName('name').setDescription('พิมพ์เพื่อค้นหา เช่น claude, gpt, gemini').setRequired(true).setAutocomplete(true)))
    .addSubcommand((s) => s.setName('list').setDescription('ค้นหาโมเดลทั้งหมดบน OpenRouter')
      .addStringOption((o) => o.setName('search').setDescription('คำค้น เช่น claude, llama, free'))),
  new SlashCommandBuilder().setName('new').setDescription('เริ่มแชทใหม่')
    .addStringOption((o) => o.setName('title').setDescription('ชื่อแชท (ไม่ใส่ก็ได้)')),
  new SlashCommandBuilder().setName('chats').setDescription('รายการแชทล่าสุด'),
  new SlashCommandBuilder().setName('switch').setDescription('สลับไปแชทอื่น').addStringOption((o) => chatOption(o)),
  new SlashCommandBuilder().setName('history').setDescription('ดูข้อความล่าสุดของแชทที่เปิดอยู่')
    .addIntegerOption((o) => o.setName('count').setDescription('จำนวนข้อความ (1-20)').setMinValue(1).setMaxValue(20)),
  new SlashCommandBuilder().setName('system').setDescription('ดูหรือตั้ง system prompt ของแชทที่เปิดอยู่')
    .addStringOption((o) => o.setName('prompt').setDescription('ข้อความใหม่ (พิมพ์ reset เพื่อคืนค่าเริ่มต้น)')),
  new SlashCommandBuilder().setName('rename').setDescription('เปลี่ยนชื่อแชทที่เปิดอยู่')
    .addStringOption((o) => o.setName('title').setDescription('ชื่อใหม่').setRequired(true)),
  new SlashCommandBuilder().setName('delete').setDescription('ลบแชท').addStringOption((o) => chatOption(o, 'แชทที่จะลบ')),
  new SlashCommandBuilder().setName('stop').setDescription('หยุด AI ที่กำลังตอบอยู่'),
  new SlashCommandBuilder().setName('status').setDescription('สถานะระบบและเครดิตคงเหลือ'),
  new SlashCommandBuilder().setName('help').setDescription('วิธีใช้บอท'),
].map((c) => c.toJSON());

// ---------- ตัวช่วย ----------
const allowed = (userId) => config.discord.allowedUserIds.includes(userId);
const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const fmtPrice = (m) => (m?.free ? 'ฟรี' : m?.inputPrice != null ? `$${m.inputPrice.toFixed(2)} / $${m.outputPrice.toFixed(2)} ต่อ 1M token` : '—');

function splitMessage(text, size = 1900) {
  const out = [];
  let rest = text;
  while (rest.length > size) {
    let cut = rest.lastIndexOf('\n', size);
    if (cut < size * 0.5) cut = size;
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\n/, '');
  }
  if (rest) out.push(rest);
  // ปิด code block ที่ถูกตัดกลาง
  let open = false;
  return out.map((part) => {
    let p = open ? '```\n' + part : part;
    const fences = (part.match(/```/g) || []).length;
    if (fences % 2 === 1) open = !open;
    if (open) p += '\n```';
    return p;
  });
}

/**
 * ส่งข้อความไป AI แล้วแสดงผลแบบ streaming บน Discord
 * edit(text)  แก้ข้อความแรก, more(text) ส่งข้อความต่อท้าย
 */
async function runChat({ text, model, edit, more }) {
  const useModel = model || store.getCurrentModel();
  let buf = '';
  let last = 0;
  let pending = null;
  const header = `-# ${useModel}\n`;
  const flush = async () => {
    last = Date.now();
    const shown = buf.length > 1800 ? '…' + buf.slice(-1800) : buf;
    await edit(header + (shown || 'กำลังคิด…')).catch(() => {});
  };
  const r = await chatService.send({
    text,
    model,
    source: 'discord',
    onToken: (d) => {
      buf += d;
      if (Date.now() - last > 1200 && !pending) {
        pending = flush().finally(() => { pending = null; });
      }
    },
  });
  await pending;
  const usedModel = r.reply.model || useModel;
  const cost = r.reply.usage?.cost != null ? ` · $${Number(r.reply.usage.cost).toFixed(4)}` : '';
  const parts = splitMessage(r.reply.content);
  await edit(`-# ${usedModel}${cost}\n` + parts[0]);
  for (const p of parts.slice(1)) await more(p);
}

// ---------- ตัวจัดการคำสั่ง ----------
async function handleCommand(i) {
  const name = i.commandName;

  if (name === 'ask') {
    await i.deferReply();
    await runChat({
      text: i.options.getString('prompt', true),
      model: i.options.getString('model') || undefined,
      edit: (t) => i.editReply(t),
      more: (t) => i.followUp(t),
    });
    return;
  }

  if (name === 'model') {
    const sub = i.options.getSubcommand();
    if (sub === 'current') {
      const id = store.getCurrentModel();
      const m = await findModel(id);
      const e = new EmbedBuilder().setColor(ACCENT).setTitle('โมเดลปัจจุบัน').setDescription(`\`${id}\``)
        .addFields({ name: 'ชื่อ', value: m?.name || id, inline: true }, { name: 'ราคา (เข้า/ออก)', value: fmtPrice(m), inline: true });
      if (m?.context) e.addFields({ name: 'Context', value: `${m.context.toLocaleString()} token`, inline: true });
      return i.reply({ embeds: [e] });
    }
    if (sub === 'set') {
      const id = i.options.getString('name', true).trim();
      const m = await findModel(id);
      if (!m) return i.reply({ content: `ไม่พบโมเดล \`${id}\` ลองพิมพ์แล้วเลือกจากรายการ`, ephemeral: true });
      store.setCurrentModel(id, 'discord');
      return i.reply(`เปลี่ยนเป็น **${m.name}** (\`${id}\`) แล้ว · ${fmtPrice(m)}`);
    }
    if (sub === 'list') {
      const found = await searchModels(i.options.getString('search') || '', 20);
      if (!found.length) return i.reply({ content: 'ไม่พบโมเดลที่ตรงกับคำค้น', ephemeral: true });
      const lines = found.map((m) => `\`${m.id}\` — ${fmtPrice(m)}`);
      return i.reply({ embeds: [new EmbedBuilder().setColor(ACCENT).setTitle('โมเดลบน OpenRouter').setDescription(clip(lines.join('\n'), 4000))
        .setFooter({ text: 'ใช้ /model set เพื่อเปลี่ยน' })] });
    }
  }

  if (name === 'new') {
    const c = store.createConversation({ title: i.options.getString('title') || undefined, source: 'discord' });
    return i.reply(`เริ่มแชทใหม่ **${c.title}** (\`${c.id}\`) · โมเดล \`${store.getCurrentModel()}\``);
  }

  if (name === 'chats') {
    const list = store.listConversations(15);
    if (!list.length) return i.reply('ยังไม่มีแชท ใช้ /new หรือ /ask เพื่อเริ่ม');
    const active = store.getActive()?.id;
    const lines = list.map((c) => `${c.id === active ? '▶' : '•'} **${clip(c.title, 50)}** \`${c.id}\` · ${c.count} ข้อความ · <t:${Math.floor(c.updatedAt / 1000)}:R>`);
    return i.reply({ embeds: [new EmbedBuilder().setColor(ACCENT).setTitle('แชทล่าสุด').setDescription(lines.join('\n'))] });
  }

  if (name === 'switch') {
    const id = i.options.getString('chat', true);
    if (!store.setActive(id, 'discord')) return i.reply({ content: 'ไม่พบแชทนี้', ephemeral: true });
    return i.reply(`สลับไปที่ **${store.getConversation(id).title}** แล้ว`);
  }

  if (name === 'history') {
    const c = store.getActive();
    if (!c || !c.messages.length) return i.reply({ content: 'แชทที่เปิดอยู่ยังไม่มีข้อความ', ephemeral: true });
    const n = i.options.getInteger('count') || 6;
    const lines = c.messages.slice(-n).map((m) => `**${m.role === 'user' ? 'คุณ' : 'AI'}:** ${clip(m.content.replace(/\n+/g, ' '), 300)}`);
    return i.reply({ embeds: [new EmbedBuilder().setColor(ACCENT).setTitle(clip(c.title, 200)).setDescription(clip(lines.join('\n\n'), 4000))] });
  }

  if (name === 'system') {
    let c = store.getActive() || store.createConversation({ source: 'discord' });
    const p = i.options.getString('prompt');
    if (!p) return i.reply({ content: `System prompt ปัจจุบัน:\n>>> ${c.systemPrompt || '(ว่าง)'}`, ephemeral: true });
    store.updateConversation(c.id, { systemPrompt: p.toLowerCase() === 'reset' ? config.systemPrompt : p }, 'discord');
    return i.reply('อัปเดต system prompt ของแชทนี้แล้ว');
  }

  if (name === 'rename') {
    const c = store.getActive();
    if (!c) return i.reply({ content: 'ยังไม่มีแชทที่เปิดอยู่', ephemeral: true });
    store.updateConversation(c.id, { title: i.options.getString('title', true) }, 'discord');
    return i.reply('เปลี่ยนชื่อแชทแล้ว');
  }

  if (name === 'delete') {
    const id = i.options.getString('chat', true);
    const c = store.getConversation(id);
    if (!c) return i.reply({ content: 'ไม่พบแชทนี้', ephemeral: true });
    store.deleteConversation(id, 'discord');
    return i.reply(`ลบแชท **${c.title}** แล้ว`);
  }

  if (name === 'stop') {
    const c = store.getActive();
    return i.reply(c && chatService.stop(c.id) ? 'หยุดแล้ว' : 'ไม่มีอะไรกำลังทำงาน');
  }

  if (name === 'status') {
    await i.deferReply();
    const c = store.getActive();
    const e = new EmbedBuilder().setColor(ACCENT).setTitle(config.appName)
      .addFields(
        { name: 'โมเดล', value: `\`${store.getCurrentModel()}\``, inline: true },
        { name: 'แชทที่เปิดอยู่', value: c ? clip(c.title, 100) : '—', inline: true },
        { name: 'จำนวนแชท', value: String(store.listConversations(10_000).length), inline: true },
      );
    try {
      const cr = await getCredits();
      e.addFields({ name: 'เครดิต OpenRouter', value: `คงเหลือ $${cr.remaining.toFixed(2)} (ใช้ไป $${cr.used.toFixed(2)})` });
    } catch (err) {
      e.addFields({ name: 'เครดิต OpenRouter', value: `อ่านไม่ได้: ${clip(err.message, 200)}` });
    }
    return i.editReply({ embeds: [e] });
  }

  if (name === 'help') {
    return i.reply({ ephemeral: true, content: [
      '**วิธีใช้**',
      '`/ask` ถาม AI · หรือ @บอท ตามด้วยคำถาม · หรือส่ง DM หาบอท',
      '`/model set` เปลี่ยนโมเดล · `/model list` ค้นหา · `/model current` ดูโมเดลปัจจุบัน',
      '`/new` แชทใหม่ · `/chats` รายการ · `/switch` สลับ · `/rename` · `/delete`',
      '`/history` ดูข้อความล่าสุด · `/system` ตั้ง system prompt · `/stop` หยุดตอบ · `/status` เครดิต',
      'ทุกอย่างซิงก์กับหน้าเว็บทันที',
    ].join('\n') });
  }
}

async function handleAutocomplete(i) {
  if (!allowed(i.user.id)) return i.respond([]);
  const focused = i.options.getFocused(true);
  if (focused.name === 'model' || focused.name === 'name') {
    const found = await searchModels(focused.value, 25).catch(() => []);
    return i.respond(found.map((m) => ({ name: clip(`${m.id}${m.free ? ' (ฟรี)' : ''}`, 100), value: m.id.slice(0, 100) })));
  }
  if (focused.name === 'chat') {
    const q = focused.value.toLowerCase();
    const list = store.listConversations(100).filter((c) => !q || c.title.toLowerCase().includes(q) || c.id.includes(q));
    return i.respond(list.slice(0, 25).map((c) => ({ name: clip(`${c.title} · ${c.id}`, 100), value: c.id })));
  }
  return i.respond([]);
}

// ---------- เริ่มบอท ----------
export async function startDiscord() {
  const { token, appId, guildId } = config.discord;
  if (!token || !appId) {
    console.log('[discord] ไม่ได้ตั้งค่า DISCORD_BOT_TOKEN / DISCORD_APP_ID — ข้ามการเปิดบอท');
    return;
  }
  status.enabled = true;
  if (!config.discord.allowedUserIds.length) console.warn('[discord] DISCORD_ALLOWED_USER_IDS ว่าง — จะไม่มีใครสั่งบอทได้');

  const rest = new REST({ version: '10' }).setToken(token);
  const route = guildId ? Routes.applicationGuildCommands(appId, guildId) : Routes.applicationCommands(appId);
  await rest.put(route, { body: commands });
  console.log(`[discord] ลงทะเบียน ${commands.length} คำสั่ง${guildId ? 'ในเซิร์ฟเวอร์' : ' (global อาจใช้เวลาถึง 1 ชม.)'}`);

  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.DirectMessages],
    partials: [Partials.Channel],
  });

  client.once(Events.ClientReady, (c) => {
    status.ready = true;
    status.tag = c.user.tag;
    console.log(`[discord] ออนไลน์ในชื่อ ${c.user.tag}`);
  });

  client.on(Events.InteractionCreate, async (i) => {
    try {
      if (i.isAutocomplete()) return await handleAutocomplete(i);
      if (!i.isChatInputCommand()) return;
      if (!allowed(i.user.id)) return i.reply({ content: 'คุณไม่มีสิทธิ์ใช้บอทนี้', ephemeral: true });
      await handleCommand(i);
    } catch (e) {
      console.error('[discord]', e);
      const msg = { content: `เกิดข้อผิดพลาด: ${clip(e.message, 1800)}`, ephemeral: true };
      if (i.isRepliable?.()) (i.deferred || i.replied ? i.followUp(msg) : i.reply(msg)).catch(() => {});
    }
  });

  // @mention หรือ DM = ถาม AI ได้เลย
  client.on(Events.MessageCreate, async (m) => {
    if (m.author.bot) return;
    const isDM = !m.guild;
    const mentioned = m.mentions.users.has(client.user.id);
    if (!isDM && !mentioned) return;
    if (!allowed(m.author.id)) return;
    const text = m.content.replace(new RegExp(`<@!?${client.user.id}>`, 'g'), '').trim();
    if (!text) return m.reply('พิมพ์คำถามต่อท้ายได้เลย หรือใช้ /help');
    try {
      await m.channel.sendTyping().catch(() => {});
      const first = await m.reply(`-# ${store.getCurrentModel()}\nกำลังคิด…`);
      await runChat({ text, edit: (t) => first.edit(t), more: (t) => m.channel.send(t) });
    } catch (e) {
      m.reply(`เกิดข้อผิดพลาด: ${clip(e.message, 1800)}`).catch(() => {});
    }
  });

  client.on(Events.Error, (e) => { status.error = e.message; console.error('[discord]', e.message); });
  await client.login(token);
}
