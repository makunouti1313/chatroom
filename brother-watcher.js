/**
 * ブラザー チャットルーム監視スクリプト
 * - AI不使用（コストゼロ）
 * - @ブラザー → テンプレート返答
 * - 全会話をメモリファイルに保存
 */

import fs from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// .env 読み込み
if (fs.existsSync(join(__dirname, ".env"))) {
  fs.readFileSync(join(__dirname, ".env"), "utf8").split("\n").forEach(line => {
    const [k, ...v] = line.split("=");
    if (k?.trim()) process.env[k.trim()] = v.join("=").trim();
  });
}

const CHAT_URL   = "https://chatroom-oebr.onrender.com";
const CHAT_KEY   = process.env.CHAT_API_KEY || "yusuke-chat-2026";
const POLL_MS    = 30_000;
const STATE_FILE = join(__dirname, "brother-watcher-state.json");
const MEMORY_FILE = join(__dirname, "brother-memory.md");

// テンプレート返答（キーワードマッチ）
const TEMPLATES = [
  { match: /lancers|応募|案件/i,    reply: "了解。Lancersの操作を実行します。" },
  { match: /ログイン/i,             reply: "了解。ログインします。" },
  { match: /プロフィール/i,         reply: "了解。プロフィールを確認・更新します。" },
  { match: /保存|セーブ/i,          reply: "了解。保存します。" },
  { match: /確認|チェック/i,        reply: "了解。確認します。" },
  { match: /完了|終わった|できた/i,  reply: "確認しました。完了を記録します。" },
  { match: /エラー|失敗/i,          reply: "エラーを確認しました。ジュニアに報告します。" },
];
const DEFAULT_REPLY = "了解。実行します。";

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, "utf8")); }
  catch { return { lastTs: 0 }; }
}
function saveState(s) { fs.writeFileSync(STATE_FILE, JSON.stringify(s)); }

function appendMemory(msg) {
  const line = `[${new Date(msg.created_at).toLocaleString("ja-JP")}] ${msg.sender}: ${msg.content}\n`;
  fs.appendFileSync(MEMORY_FILE, line);
}

async function postToChat(content) {
  await fetch(`${CHAT_URL}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": CHAT_KEY },
    body: JSON.stringify({ sender: "ブラザー", content })
  });
}

function getTemplateReply(text) {
  for (const t of TEMPLATES) {
    if (t.match.test(text)) return t.reply;
  }
  return DEFAULT_REPLY;
}

async function poll() {
  const state = loadState();
  try {
    const res = await fetch(`${CHAT_URL}/messages?since=${state.lastTs}&limit=50`);
    const messages = await res.json();

    for (const msg of messages) {
      if (msg.sender === "システム") {
        if (msg.created_at > state.lastTs) state.lastTs = msg.created_at;
        continue;
      }

      // 全メッセージをメモリに保存（ブラザー自身の発言も）
      appendMemory(msg);

      // ブラザー自身の発言はスキップ
      if (msg.sender === "ブラザー") {
        if (msg.created_at > state.lastTs) state.lastTs = msg.created_at;
        continue;
      }

      // @ブラザー への呼びかけにテンプレート返答
      const text = msg.content || "";
      if (text.includes("@ブラザー") || text.includes("@brother")) {
        const reply = getTemplateReply(text);
        console.log(`[${new Date().toLocaleTimeString()}] @ブラザー検知 → "${reply}"`);
        await postToChat(reply);
      }

      if (msg.created_at > state.lastTs) state.lastTs = msg.created_at;
    }

    saveState(state);
  } catch (err) {
    console.error(`ポーリングエラー:`, err.message);
  }
}

const LOCK_FILE = join(__dirname, "brother-watcher.lock");

function acquireLock() {
  if (fs.existsSync(LOCK_FILE)) {
    const pid = fs.readFileSync(LOCK_FILE, "utf8").trim();
    // 同じPIDなら自分、違うなら別インスタンスが動いてる
    if (pid && pid !== String(process.pid)) {
      console.error(`別インスタンスが起動中 (PID: ${pid})。終了します。`);
      process.exit(0);
    }
  }
  fs.writeFileSync(LOCK_FILE, String(process.pid));
}

async function main() {
  acquireLock();
  console.log(`ブラザー監視起動 (PID:${process.pid}, ${POLL_MS / 1000}秒間隔) [AIなし・コストゼロ]`);
  if (!fs.existsSync(MEMORY_FILE)) {
    fs.writeFileSync(MEMORY_FILE, "# ブラザー 会話メモリ\n\n");
  }
  process.on("exit", () => { try { fs.unlinkSync(LOCK_FILE); } catch {} });
  process.on("SIGINT", () => process.exit());
  await poll();
  setInterval(poll, POLL_MS);
}

main();
