/**
 * ジュニア チャットルーム常駐スクリプト
 * ゆうすけの発言 → Claude Haiku で即返答
 * コスト: メッセージあたり約$0.0001
 */

import fs from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { spawn } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));

if (fs.existsSync(join(__dirname, ".env"))) {
  fs.readFileSync(join(__dirname, ".env"), "utf8").split("\n").forEach(line => {
    const [k, ...v] = line.split("=");
    if (k?.trim()) process.env[k.trim()] = v.join("=").trim();
  });
}

const CHAT_URL      = "https://chatroom-oebr.onrender.com";
const CHAT_KEY      = process.env.CHAT_API_KEY || "yusuke-chat-2026";
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const POLL_MS       = 15_000;
const STATE_FILE    = join(__dirname, "junior-watcher-state.json");
const LOCK_FILE     = join(__dirname, "junior-watcher.lock");

const SYSTEM_PROMPT = `あなたは「ジュニア」です。ゆうすけ専用のAIアシスタントです。

【役割】
- Lancers案件の収集・スコアリング・応募文生成
- ゆうすけの相談への回答・判断サポート
- チームチャットでの3人（ゆうすけ・ジュニア・ブラザー）のコーディネート

【最優先ミッション】ゆうすけに月20万の収入をもたらすこと。

【スタンス】
- 返答は短く・直接的に。余計な前置きなし。
- 実装・判断はすべて自分で行う。ゆうすけに質問しない。
- 「了解です」「承知しました」などの敬語定型文は使わない。

【現在の状況】
- Lancers本人確認済み・プロフィール完成済み
- Excel VBA自動化案件（¥20,000）に応募済み・選考中
- ブラザーはブラウザ操作専任（@ブラザーで呼べる）`;

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, "utf8")); }
  catch { return { lastTs: Date.now() }; }
}
function saveState(s) { fs.writeFileSync(STATE_FILE, JSON.stringify(s)); }

async function getRecentMessages(limit = 20) {
  const res = await fetch(`${CHAT_URL}/messages?limit=${limit}`);
  return await res.json();
}

async function postToChat(content) {
  await fetch(`${CHAT_URL}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": CHAT_KEY },
    body: JSON.stringify({ sender: "ジュニア", content })
  });
}

async function askClaude(history, newMessage) {
  // 直近の会話履歴をコンテキストとして渡す
  const contextLines = history
    .filter(m => m.sender !== "システム")
    .slice(-10)
    .map(m => `${m.sender}: ${m.content}`)
    .join("\n");

  const userPrompt = `【直近の会話】\n${contextLines}\n\n【新着メッセージ】\n${newMessage.sender}: ${newMessage.content}`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 400,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }]
    })
  });
  const data = await res.json();
  return data.content?.[0]?.text || null;
}

const CLAUDE_CMD = "C:\\Users\\merucari\\AppData\\Roaming\\npm\\claude.cmd";
const DEFAULT_CWD = "C:\\Users\\merucari\\OneDrive\\デスクトップ\\samantha-final";

function runClaude(prompt, cwd = DEFAULT_CWD) {
  return new Promise((resolve) => {
    const TIMEOUT = 120_000; // 2分
    let output = "";
    let done = false;

    const child = spawn(
      "cmd.exe",
      ["/c", CLAUDE_CMD, "-p", prompt, "--dangerously-skip-permissions"],
      { cwd, env: { ...process.env } }
    );

    child.stdout.on("data", d => { output += d.toString("utf8"); });
    child.stderr.on("data", d => { output += d.toString("utf8"); });

    const finish = (reason) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { child.kill(); } catch {}
      const result = output.trim() || `（出力なし: ${reason}）`;
      resolve(result.slice(0, 1500));
    };

    child.on("close", () => finish("exit"));
    child.on("error", err => { output += `エラー: ${err.message}`; finish("error"); });
    const timer = setTimeout(() => finish("timeout"), TIMEOUT);
  });
}

async function poll() {
  const state = loadState();
  try {
    const res = await fetch(`${CHAT_URL}/messages?since=${state.lastTs}&limit=10`);
    const newMsgs = await res.json();

    for (const msg of newMsgs) {
      // ジュニア・システム・ブラザーの発言はスキップ
      if (["ジュニア", "システム", "ブラザー"].includes(msg.sender)) {
        if (msg.created_at > state.lastTs) state.lastTs = msg.created_at;
        saveState(state); // 都度保存して重複処理を防ぐ
        continue;
      }

      // 処理前にlastTsを更新・保存（長時間処理中の重複防止）
      if (msg.created_at > state.lastTs) {
        state.lastTs = msg.created_at;
        saveState(state);
      }

      console.log(`[${new Date().toLocaleTimeString()}] ${msg.sender}: ${msg.content.slice(0, 50)}`);

      const text = msg.content.trim();

      if (text.startsWith("!")) {
        // ! プレフィックス → Claude Code実行モード
        const prompt = text.slice(1).trim();
        console.log(`→ Claude Code実行: ${prompt.slice(0, 50)}`);
        await postToChat(`実行中... (最大2分)`);
        const result = await runClaude(prompt);
        await postToChat(result);
        console.log(`→ 完了`);
      } else {
        // 通常会話 → Haiku
        const history = await getRecentMessages(20);
        const reply = await askClaude(history, msg);
        if (reply) {
          await postToChat(reply);
          console.log(`→ 返答: ${reply.slice(0, 50)}`);
        }
      }
    }
  } catch (err) {
    console.error("エラー:", err.message);
  }
}

process.on("SIGINT", () => process.exit());

if (!ANTHROPIC_KEY) { console.error("ANTHROPIC_API_KEY未設定"); process.exit(1); }

console.log(`ジュニア常駐起動 (${POLL_MS/1000}秒間隔) [Haiku応答モード]`);
poll();
setInterval(poll, POLL_MS);
