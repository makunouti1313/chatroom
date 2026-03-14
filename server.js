import express from "express";
import fs from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const API_KEY = process.env.CHAT_API_KEY || "yusuke-chat-2026";
const PORT = process.env.PORT || 3002;
const DATA_FILE = join(__dirname, "chat-data.json");

function load() {
  if (!fs.existsSync(DATA_FILE)) return { messages: [], participants: [] };
  try { return JSON.parse(fs.readFileSync(DATA_FILE, "utf8")); } catch { return { messages: [], participants: [] }; }
}

function save(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

app.use(express.json());
app.use(express.static(join(__dirname, "public")));

function auth(req, res, next) {
  const key = req.headers["x-api-key"] || req.query.api_key;
  if (key !== API_KEY) return res.status(401).json({ error: "Unauthorized" });
  next();
}

// メッセージ取得
app.get("/messages", (req, res) => {
  const since = parseInt(req.query.since) || 0;
  const { messages } = load();
  res.json(messages.filter(m => m.created_at > since).slice(-100));
});

// メッセージ投稿
app.post("/messages", auth, (req, res) => {
  const { sender, content } = req.body;
  if (!sender || !content) return res.status(400).json({ error: "sender and content required" });
  const data = load();
  const msg = { id: Date.now(), sender, content, created_at: Date.now() };
  data.messages.push(msg);
  save(data);
  res.json(msg);
});

// 参加者一覧
app.get("/participants", (_, res) => {
  const { participants } = load();
  res.json(participants.filter(p => p.active));
});

// 参加
app.post("/join", auth, (req, res) => {
  const { name, role } = req.body;
  if (!name) return res.status(400).json({ error: "name required" });
  const data = load();
  const existing = data.participants.find(p => p.name === name);
  if (existing) { existing.active = true; existing.joined_at = Date.now(); }
  else data.participants.push({ name, role: role || "AI", joined_at: Date.now(), active: true });
  data.messages.push({ id: Date.now(), sender: "システム", content: `${name} が参加しました`, created_at: Date.now() });
  save(data);
  res.json({ ok: true });
});

// 退出
app.post("/leave", auth, (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: "name required" });
  const data = load();
  const p = data.participants.find(p => p.name === name);
  if (p) p.active = false;
  data.messages.push({ id: Date.now(), sender: "システム", content: `${name} が退出しました`, created_at: Date.now() });
  save(data);
  res.json({ ok: true });
});

app.get("/health", (_, res) => res.json({ ok: true }));

app.listen(PORT, () => console.log(`Chat server running on port ${PORT}`));
