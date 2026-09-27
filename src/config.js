import 'dotenv/config';

const list = (v) => (v || '').split(',').map((s) => s.trim()).filter(Boolean);

export const config = {
  openrouterKey: process.env.OPENROUTER_API_KEY || '',
  defaultModel: process.env.DEFAULT_MODEL || 'openrouter/auto',
  favoriteModels: list(process.env.FAVORITE_MODELS || 'openrouter/auto'),
  systemPrompt: process.env.SYSTEM_PROMPT || '',
  port: Number(process.env.PORT || 3000),
  webPassword: process.env.WEB_PASSWORD || '',
  sessionSecret: process.env.SESSION_SECRET || '',
  discord: {
    token: process.env.DISCORD_BOT_TOKEN || '',
    appId: process.env.DISCORD_APP_ID || '',
    guildId: process.env.DISCORD_GUILD_ID || '',
    allowedUserIds: list(process.env.DISCORD_ALLOWED_USER_IDS),
  },
  appName: 'RVC AI Hub',
};

export function checkConfig() {
  const problems = [];
  if (!config.openrouterKey) problems.push('OPENROUTER_API_KEY ยังไม่ได้ตั้งค่า');
  if (!config.webPassword || config.webPassword === 'change-me-please')
    problems.push('WEB_PASSWORD ยังเป็นค่าเริ่มต้น — กรุณาเปลี่ยน');
  if (!config.sessionSecret || config.sessionSecret.length < 32)
    problems.push('SESSION_SECRET ต้องยาวอย่างน้อย 32 ตัวอักษร');
  return problems;
}
