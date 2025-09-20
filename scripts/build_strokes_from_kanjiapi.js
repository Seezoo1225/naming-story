// scripts/build_strokes_from_kanjiapi.js
// 常用漢字 ~2136字の画数を kanjiapi.dev から取得し、data/strokes.json を生成します。
// 使い方:
//   node scripts/build_strokes_from_kanjiapi.js
//
// 備考:
// - 参照元: https://kanjiapi.dev/ (Kanjidic2準拠, 無料)
// - 1文字ずつ取得。レート制御 & リトライあり。途中中断OK（キャッシュ再開）。

import fs from "node:fs";
import path from "node:path";
import * as joyoPkg from "joyo-kanji";

// --- joyo-kanji を頑健に配列化（環境差吸収） ---
function extractJoyoList(mod) {
  const vals = new Set([mod, mod?.default]);
  if (mod && typeof mod === "object") {
    Object.values(mod).forEach(v => vals.add(v));
    if (mod.default && typeof mod.default === "object") {
      Object.values(mod.default).forEach(v => vals.add(v));
    }
  }
  const expanded = new Set();
  for (const v of vals) {
    if (!v) continue;
    if (typeof v === "function") { try { expanded.add(v()); } catch {} }
    else expanded.add(v);
  }
  for (const v of [...expanded]) {
    if (v && typeof v === "object") Object.values(v).forEach(w => expanded.add(w));
  }
  const cands = [];
  for (const v of expanded) {
    if (Array.isArray(v)) cands.push({score: v.length, value: v});
    else if (typeof v === "string") cands.push({score: v.length, value: Array.from(v)});
  }
  cands.sort((a,b)=>b.score-a.score);
  const hit = cands.find(c=>c.score>=1500) || cands[0];
  if (!hit) throw new Error("joyo-kanji の形式を解釈できませんでした。");
  return hit.value;
}
const JOYO = extractJoyoList(joyoPkg);

// --- ひらがな（霊数なし） ---
const HIRA = {
  "あ":3,"い":2,"う":2,"え":2,"お":3,"か":3,"き":4,"く":1,"け":3,"こ":2,
  "さ":3,"し":1,"す":2,"せ":3,"そ":1,"た":4,"ち":2,"つ":1,"て":1,"と":2,
  "な":2,"に":3,"ぬ":2,"ね":2,"の":1,"は":3,"ひ":1,"ふ":4,"へ":1,"ほ":4,
  "ま":3,"み":3,"む":3,"め":3,"も":3,"や":2,"ゆ":2,"よ":2,"ら":2,"り":2,
  "る":2,"れ":2,"ろ":1,"わ":2,"を":3,"ん":1,
  "ぁ":2,"ぃ":1,"ぅ":1,"ぇ":1,"ぉ":2,"ゃ":2,"ゅ":2,"ょ":2,"っ":1
};

// --- 社内基準の上書き（必要に応じて追加） ---
const OVERRIDES = { "六":4, "龍":16, "凛":15 };

// --- 出力/キャッシュ ---
const OUT_DIR = path.join(process.cwd(), "data");
const OUT_FILE = path.join(OUT_DIR, "strokes.json");
const CACHE_FILE = path.join(OUT_DIR, "strokes.kanjiapi.cache.json");

// --- 低速アクセス（礼儀として間隔を空ける） ---
const DELAY_MS = 120;         // 1リクエストあたり 0.12秒
const RETRY_MAX = 3;

function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }
function loadCache(){
  if (fs.existsSync(CACHE_FILE)) try { return JSON.parse(fs.readFileSync(CACHE_FILE,"utf8")); } catch {}
  return {};
}
function saveCache(obj){
  fs.mkdirSync(OUT_DIR,{recursive:true});
  fs.writeFileSync(CACHE_FILE, JSON.stringify(obj,null,2), "utf8");
}

async function fetchStroke(kanji){
  // API: https://kanjiapi.dev/v1/kanji/亜 -> {"kanji":"亜","grade":...,"stroke_count":7,...}
  const url = `https://kanjiapi.dev/v1/kanji/${encodeURIComponent(kanji)}`;
  for (let i=0;i<RETRY_MAX;i++){
    try{
      const res = await fetch(url);
      if (res.status === 404) return null; // 未登録
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json();
      const n = j?.stroke_count;
      return (Number.isInteger(n) && n>0) ? n : null;
    }catch(e){
      if (i === RETRY_MAX-1) throw e;
      await sleep(500*(i+1));
    }
  }
  return null;
}

async function main(){
  console.log(`🔎 kanjiapi.dev から常用漢字(${JOYO.length})の画数を取得中…`);
  const cache = loadCache();
  const todo = JOYO.filter(ch => cache[ch] == null);

  for (let i=0;i<todo.length;i++){
    const ch = todo[i];
    process.stdout.write(`  ${i+1}/${todo.length} ${ch} … `);
    try{
      const n = await fetchStroke(ch);
      if (n != null) {
        cache[ch] = n;
        console.log(n);
      } else {
        console.log("not found");
      }
      saveCache(cache);
    }catch(e){
      console.log("error:", e.message);
      saveCache(cache);
    }
    await sleep(DELAY_MS);
  }

  // ひらがな/上書きを合成
  Object.assign(cache, HIRA, OVERRIDES);

  const out = {
    meta: {
      source: "kanjiapi.dev (Kanjidic2) + joyo-kanji",
      note: "新字体・霊数なし。常用漢字フルセット＋ひらがな＋overrides",
      counts: { joyo: JOYO.length, hiragana: Object.keys(HIRA).length, total: Object.keys(cache).length }
    },
    ...cache
  };

  fs.mkdirSync(OUT_DIR,{recursive:true});
  fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2), "utf8");
  console.log(`✅ 生成完了: ${OUT_FILE}（${Object.keys(cache).length} 文字）`);
  console.log(`ℹ️ キャッシュ: ${CACHE_FILE}`);
}

await main();
