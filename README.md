# RVC AI Hub

แชทบอท AI หลายโมเดลผ่าน **OpenRouter** มีหน้าเว็บ และสั่งงานผ่าน **Discord** ได้ทุกอย่าง ข้อมูลทั้งสองฝั่งซิงก์กันแบบเรียลไทม์

```
หน้าเว็บ ─┐
          ├─► Node.js server ─► OpenRouter ─► Claude / GPT / Gemini / DeepSeek / Llama …
Discord  ─┘   (data/db.json)
```

## 1. สิ่งที่ต้องเตรียม

| รายการ | ได้จากไหน |
|---|---|
| Node.js 20 ขึ้นไป | https://nodejs.org (เลือก LTS) |
| OpenRouter API key | https://openrouter.ai/keys (เติมเครดิตที่ https://openrouter.ai/settings/credits) |
| Discord bot | https://discord.com/developers/applications (ดูข้อ 3) |

## 2. ติดตั้ง

```bash
cd ai-hub
npm install
copy .env.example .env      # Windows  (Linux/Mac ใช้: cp .env.example .env)
```

เปิดไฟล์ `.env` แล้วกรอก `OPENROUTER_API_KEY`, `WEB_PASSWORD` และ `SESSION_SECRET` จากนั้นรัน

```bash
npm start
```

แล้วเปิด http://localhost:3000

## 3. สร้าง Discord bot

1. เข้า https://discord.com/developers/applications แล้วกด **New Application** ตั้งชื่อ เช่น `RVC AI`
2. หน้า **General Information** คัดลอก **Application ID** ไปใส่ `DISCORD_APP_ID`
3. หน้า **Bot**
   - กด **Reset Token** แล้วคัดลอกไปใส่ `DISCORD_BOT_TOKEN` (**ห้ามแชร์ token นี้**)
   - เปิด **Message Content Intent**
4. หน้า **OAuth2 → URL Generator**
   - Scopes: เลือก `bot` และ `applications.commands`
   - Bot Permissions: เลือก `Send Messages`, `Read Message History`, `Embed Links` และ `View Channels`
   - เปิด URL ที่ได้ แล้วเชิญบอทเข้าเซิร์ฟเวอร์ของคุณ
5. ใน Discord ไปที่ **User Settings → Advanced** แล้วเปิด **Developer Mode**
   - คลิกขวาที่ชื่อเซิร์ฟเวอร์ → **Copy Server ID** ใส่ `DISCORD_GUILD_ID`
   - คลิกขวาที่ชื่อตัวเอง → **Copy User ID** ใส่ `DISCORD_ALLOWED_USER_IDS`
6. รีสตาร์ต `npm start` ถ้าขึ้นว่า `[discord] ออนไลน์ในชื่อ …` แปลว่าเชื่อมต่อสำเร็จ

## 4. คำสั่ง Discord

| คำสั่ง | ทำอะไร |
|---|---|
| `/ask prompt [model]` | ถาม AI (ระบุโมเดลเฉพาะครั้งได้) |
| `@บอท ข้อความ` หรือ DM | ถาม AI ได้เลยโดยไม่ต้องใช้คำสั่ง |
| `/model set` | เปลี่ยนโมเดล (พิมพ์ค้นหาแล้วเลือก) |
| `/model list [search]` | ค้นหาโมเดลพร้อมราคา เช่น `free`, `claude` |
| `/model current` | ดูโมเดลปัจจุบัน |
| `/new [title]` | เริ่มแชทใหม่ |
| `/chats` · `/switch` · `/rename` · `/delete` | จัดการแชท |
| `/history [count]` | ดูข้อความล่าสุด |
| `/system [prompt]` | ดูหรือตั้ง system prompt (`reset` = คืนค่าเริ่มต้น) |
| `/stop` | หยุดการตอบ |
| `/status` | ดูโมเดล แชท และเครดิตคงเหลือ |
| `/help` | วิธีใช้ |

ทุกคำสั่งมีผลกับหน้าเว็บทันที เช่น เปลี่ยนโมเดลจาก Discord แล้วหน้าเว็บจะเปลี่ยนตาม และข้อความจาก Discord จะไหลขึ้นบนเว็บแบบสด

## 5. รันตลอด 24 ชม. (แนะนำ)

```bash
npm install -g pm2
pm2 start src/server.js --name ai-hub
pm2 save
```

- Windows: ติดตั้ง `pm2-windows-startup` เพื่อให้เปิดเองหลังรีบูต
- Linux: ใช้คำสั่ง `pm2 startup`

**เปิดให้เข้าจากนอกวิทยาลัย:** ใช้ Cloudflare Tunnel (`cloudflared tunnel --url http://localhost:3000`) หรือตั้ง reverse proxy ที่มี HTTPS ไม่ควรเปิด port 3000 ออกอินเทอร์เน็ตตรง ๆ

## 6. ความปลอดภัย

- `.env` และ `data/` ห้ามอัปโหลดขึ้น Git หรือส่งให้ใคร
- หน้าเว็บล็อกด้วยรหัสผ่าน และจะล็อก 5 นาทีเมื่อกรอกผิด 5 ครั้ง
- บอทตอบเฉพาะ User ID ที่อยู่ใน `DISCORD_ALLOWED_USER_IDS`
- ตั้งวงเงินได้ที่ https://openrouter.ai/settings/keys เพื่อกันค่าใช้จ่ายบานปลาย

## โครงสร้างไฟล์

```
src/server.js      เว็บเซิร์ฟเวอร์ + API + ล็อกอิน
src/discord.js     Discord bot และคำสั่งทั้งหมด
src/chat.js        ตัวกลางส่งข้อความ (ใช้ร่วมกันทั้งเว็บและ Discord)
src/openrouter.js  เชื่อมต่อ OpenRouter (แชท, รายชื่อโมเดล, เครดิต)
src/store.js       เก็บแชทใน data/db.json
public/index.html  หน้าเว็บ
```
