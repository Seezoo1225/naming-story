// api/generate.js
// 画数は「辞書で優先」→「不足分のみ AI で取得（キャッシュ）」→ 五格をサーバ側で再計算。
// 方式: 五格法（新字体・霊数なし）/ 名は原則 漢字（次点ひらがな）/ カタカナ禁止。

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";

// ✅ 修正済みの基礎辞書（新字体・霊数なし）
import strokesDict from "../data/strokes.json" assert { type: "json" };

// 既存の STROKES_STATIC を差し替え（同名定数がある場合は入れ替え）
const STROKES_STATIC = strokesDict;

// カタカナ → ひらがな（保険：サーバ側でも変換）
const kataToHira = s => String(s||"").replace(/[\u30A1-\u30F6]/g, ch => String.fromCharCode(ch.charCodeAt(0)-0x60));

// ---- ここから AI 補完まわり ----
const MEMO_CACHE = new Map(); // プロセス生存中キャッシュ

// chars: Set<string> を受け、辞書に無い文字の画数を AI に問い合わせて返す
async function fetchStrokesFromAI(chars) {
  if (!chars.size) return {};

  const list = Array.from(chars);
  const system = `
あなたは日本語の「漢字画数」計測器です。必ず JSON のみを返します。
基準: 日本の一般的な新字体（人名用/常用）・霊数なし。変体仮名や旧字体は採用しない。
返答形式は {"字": 画数, ...} 。数値は整数のみ。未知・判断不能は null。余談禁止。
`.trim();

  const user = `次の文字の画数を返してください（順不同可）: ${list.join("")}`;

  const res = await fetch(OPENAI_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      temperature: 0,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user }
      ],
    })
  });

  const json = await res.json();
  if (!res.ok) throw new Error(json?.error?.message || "OpenAI error");

  let map = {};
  try {
    map = JSON.parse(json?.choices?.[0]?.message?.content || "{}");
  } catch {
    const m = (json?.choices?.[0]?.message?.content||"").match(/{[\s\S]*}/);
    map = m ? JSON.parse(m[0]) : {};
  }
  return map;
}

function splitName(surname, full) {
  const clean = String(full||"").replace(/\s+/g,"");
  const sChars = Array.from(surname);
  const rest = clean.startsWith(surname) ? clean.slice(sChars.length) : clean;
  const gChars = Array.from(rest);
  return { sChars, gChars };
}

function calcGokaku(sSum, gSum, sBD, gBD) {
  const total = sSum + gSum;
  const lastS = sBD[sBD.length-1]?.count || 0;
  const firstG = gBD[0]?.count || 0;
  return {
    tenkaku: sSum,
    jinkaku: lastS + firstG,
    chikaku: gSum,
    gaikaku: Math.max(total - (lastS + firstG), 0),
    soukaku: total,
    total
  };
}

function sum(arr){return arr.reduce((n,x)=>n+(Number(x.count)||0),0);}

// 動的辞書（静的＋AI補完＋キャッシュ）を構築
async function buildStrokeDictFromCandidates(cands, surname, aiMode) {
  const dyn = new Map(Object.entries(STROKES_STATIC)); // まず静的
  // 既存キャッシュも反映
  for (const [k,v] of MEMO_CACHE.entries()) dyn.set(k,v);

  // 必要文字を集める
  const need = new Set();
  for (const c of cands) {
    const name = kataToHira(c?.name||"");
    const { sChars, gChars } = splitName(surname, name);
    const chars = (aiMode==="all") ? [...sChars, ...gChars] : [...sChars, ...gChars].filter(ch => !dyn.has(ch));
    for (const ch of chars) need.add(ch);
  }

  if (need.size) {
    const fetched = await fetchStrokesFromAI(need);
    for (const ch of Object.keys(fetched||{})) {
      const n = fetched[ch];
      if (Number.isInteger(n) && n>0) {
        dyn.set(ch, n);
        MEMO_CACHE.set(ch, n); // キャッシュ
      }
    }
  }
  return dyn;
}

function recalcCandidate(candidate, surname, dict) {
  const fixedName = kataToHira(candidate?.name||"");
  const fixedReading = kataToHira(candidate?.reading||"");
  const { sChars, gChars } = splitName(surname, fixedName);

  const lookup = ch => (dict.has(ch)? dict.get(ch) : null);
  const sBD = sChars.map(ch => ({char: ch, count: lookup(ch)}));
  const gBD = gChars.map(ch => ({char: ch, count: lookup(ch)}));
  const sSum = sum(sBD), gSum = sum(gBD);
  const gk = calcGokaku(sSum, gSum, sBD, gBD);

  const toArr = list => list.map(x => [x.char, x.count??null]);

  return {
    ...candidate,
    name: fixedName,
    reading: fixedReading,
    strokes: {
      surname: { total: sSum, breakdown: toArr(sBD) },
      given:   { total: gSum, breakdown: toArr(gBD) },
      total: gk.total
    },
    fortune: {
      ...(candidate?.fortune||{}),
      tenkaku: gk.tenkaku, jinkaku: gk.jinkaku,
      chikaku: gk.chikaku, gaikaku: gk.gaikaku, soukaku: gk.soukaku
    },
    __calc: { sSum, gSum, gokaku: gk }
  };
}

const SYSTEM_PROMPT = `
You are a Japanese naming & seimei-handan expert.
Respond only in json. The output must be a single valid JSON object.
Do not add any explanations, prose, markdown, or code fences outside the json.

厳守ルール:
- 流派/計算方式は「五格法（新字体・霊数なし）」を用いる（天格/人格/地格/外格/総格）。
- 候補は必ず3つ。name は「<苗字><スペース><名>」形式で、苗字（入力値）を先頭に付ける。
- 名は原則『漢字』（常用/人名用・読みやすい2文字中心）。難しい場合のみ『ひらがな』。カタカナは禁止。
- reading は必ず『ひらがな』。
- strokes.breakdown は姓→名の順で全字を列挙（["字", 画数]）。total/各格は整数。
- luck は日本語（大吉/中吉/吉/小吉/凶/大凶 など）。
- story は日本語で 200〜350 字・3〜5文、改行を想定した自然な文体。
- JSON 以外の出力は禁止。
`.trim();

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({message:"Method not allowed"});
  try{
    const { surname="", gender="unknown", concept="" } = req.body || {};
    const aiStrokesMode = req.query?.aiStrokes === "all" ? "all" : "missing"; // ?aiStrokes=all で全文字AI計測
    if(!process.env.OPENAI_API_KEY) return res.status(500).json({message:"Missing OPENAI_API_KEY"});
    if(!surname || !concept) return res.status(400).json({message:"surname and concept are required"});

    // デバッグ（ダミー）
    if (String(req.query?.debug) === "1") {
      const fallback = {
        candidates: [
          { name: `${surname} 明人`, reading:"あきと", copy:"明るさで道を照らす",
            story:"前向きな明るさで周囲に活力を与え…（略）",
            strokes:{surname:{total:8,breakdown:[["山",3],["田",5]]},given:{total:10,breakdown:[["明",8],["人",2]]},total:18},
            fortune:{ luck:{overall:"吉",work:"大吉",love:"中吉",health:"吉"} } },
          { name: `${surname} 悠真`, reading:"ゆうま", copy:"しなやかな芯の強さ",
            story:"穏やかで粘り強く…（略）",
            strokes:{surname:{total:8,breakdown:[["山",3],["田",5]]},given:{total:19,breakdown:[["悠",11],["真",10]]},total:27},
            fortune:{ luck:{overall:"中吉",work:"吉",love:"中吉",health:"吉"} } },
          { name: `${surname} 葵斗`, reading:"あおと", copy:"新しい風を呼ぶ",
            story:"周囲に爽やかな変化をもたらし…（略）",
            strokes:{surname:{total:8,breakdown:[["山",3],["田",5]]},given:{total:15,breakdown:[["葵",12],["斗",3]]},total:23},
            fortune:{ luck:{overall:"吉",work:"吉",love:"吉",health:"吉"} } },
        ],
        policy:{ ryuha:"五格法（新字体・霊数なし）", notes:"現代的で読みやすい表記を優先" }
      };
      const dict = await buildStrokeDictFromCandidates(fallback.candidates, surname, aiStrokesMode);
      const normalized = fallback.candidates.map(c => recalcCandidate(c, surname, dict));
      return res.status(200).json({ candidates: normalized, policy: fallback.policy });
    }

    // OpenAIへ
    const user = [
      `苗字: ${surname}`,
      `性別: ${gender}`,
      `希望イメージ: ${concept}`,
      `表記方針: 基本は漢字（常用/人名用）。難しい場合のみひらがな。カタカナ不可。`
    ].join("\n");

    const oaRes = await fetch(OPENAI_URL,{
      method:"POST",
      headers:{ "Authorization":`Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type":"application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        response_format: { type: "json_object" },
        temperature: 0.8,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: user }
        ],
      })
    });
    const oaJson = await oaRes.json();
    if(!oaRes.ok){
      return res.status(oaRes.status).json({ message: oaJson?.error?.message || "OpenAI error", raw: oaJson });
    }

    let raw;
    try{ raw = JSON.parse(oaJson?.choices?.[0]?.message?.content || "{}"); }
    catch{ const m=(oaJson?.choices?.[0]?.message?.content||"").match(/{[\s\S]*}/); raw = m? JSON.parse(m[0]):{}; }

    const candidates = raw?.candidates || [];
    const dict = await buildStrokeDictFromCandidates(candidates, surname, aiStrokesMode);
    const normalized = candidates.map(c => recalcCandidate(c, surname, dict));
    const policy = raw?.policy || { ryuha:"五格法（新字体・霊数なし）", notes:"現代的で読みやすい表記を優先" };

    return res.status(200).json({ candidates: normalized, policy });
  }catch(e){
    console.error("[server-error]", e);
    return res.status(500).json({message:"Server error", detail:String(e?.message||e)});
  }
}
