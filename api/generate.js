// api/generate.js
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }
  try {
    const { surname = "", gender = "unknown", concept = "" } = req.body || {};
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ message: "Missing OPENAI_API_KEY" });
    }
    if (!surname || !concept) {
      return res.status(400).json({ message: "surname and concept are required" });
    }

    // ---------- PROMPT ----------
const system = `
あなたは現代的な日本のネーミング/姓名判断の専門家です。
必ず JSON のみを返してください。文章や説明は不要です。

返却フォーマット:
{
  "candidates": [
    {
      "name": "山田 太志",
      "reading": "たいし",
      "copy": "大きな志を抱いて",
      "story": "2〜4文の物語（日本語）",
      "strokes": {
        "surname": { "total": 8, "breakdown": [["山",3],["田",5]] },
        "given":   { "total": 7, "breakdown": [["太",4],["志",3]] },
        "total": 15
      },
      "fortune": {
        "tenkaku": 8,
        "jinkaku": 9,
        "chikaku": 7,
        "gaikaku": 6,
        "soukaku": 15,
        "luck": { "overall":"吉", "work":"大吉", "love":"中吉", "health":"吉" },
        "note": "補足（任意）"
      }
    }
  ],
  "policy": {
    "ryuha":"五格法（新字体・霊数なし）",
    "notes":"現代的かつポジティブなニュアンスを重視"
  }
}

制約:
- 候補は必ず3つ。
- 苗字（入力値）を必ず先頭に付ける。
- strokes.breakdown は姓→名の順ですべての漢字を必ず列挙。
- fortune.tenkaku など五格は必ず整数で返す。
- JSON 以外の出力は厳禁。
`.trim();

    const user = `
苗字: ${surname}
性別: ${gender}
希望イメージ: ${concept}

条件:
- 現代的で読みやすい漢字を優先
- 漢字は常用漢字中心
- 候補は3つ
`.trim();

    // ---------- CALL OPENAI ----------
    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        response_format: { type: "json_object" }, // JSONを強制
        temperature: 0.7,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });

    const data = await resp.json();
    if (!resp.ok) {
      console.error("[openai-error]", data);
      return res.status(resp.status).json({ message: data?.error?.message || "OpenAI error" });
    }

    let content = data?.choices?.[0]?.message?.content || "{}";

    // ---------- JSONパース（万一壊れてたら抽出リカバリ） ----------
    let raw;
    try {
      raw = JSON.parse(content);
    } catch {
      const m = content.match(/{[\s\S]*}/);
      raw = m ? JSON.parse(m[0]) : {};
    }

    // ---------- 正規化 + 五格補完 ----------
    const output = normalizeAndFill(raw, surname);

    return res.status(200).json(output);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ message: "Server error" });
  }
}

/** 値→数値化 */
function num(v) {
  if (v == null) return 0;
  if (typeof v === "number") return v|0;
  if (typeof v === "string") return (Number(v) || 0)|0;
  if (typeof v === "object") {
    if ("value" in v) return num(v.value);
    if ("total" in v) return num(v.total);
  }
  return 0;
}

/** breakdown を [{char,count}] に */
function normBD(bd) {
  if (!bd) return [];
  if (Array.isArray(bd)) {
    return bd.map(x => Array.isArray(x)
      ? { char: String(x[0]), count: num(x[1]) }
      : { char: String(x.kanji || x.char || x.k || "?"), count: num(x.count || x.stroke || x.s || x.v) }
    );
  }
  if (typeof bd === "object") {
    return Object.entries(bd).map(([k,v]) => ({ char: String(k), count: num(v) }));
  }
  return [];
}

/** 五格計算（新字体・霊数なし） */
function calcGokaku(surname, bdAll, sTotal, gTotal, totalAll) {
  const sLen = [...(surname || "")].length;
  const surnameParts = bdAll.slice(0, sLen);
  const givenParts   = bdAll.slice(sLen);
  const sum = (arr) => arr.reduce((a,b)=>a+(b.count||0), 0);
  const tenkaku = sTotal || sum(surnameParts);
  const chikaku = gTotal || sum(givenParts);
  const soukaku = totalAll || (tenkaku + chikaku);
  const jinkaku = (surnameParts[surnameParts.length-1]?.count || 0) + (givenParts[0]?.count || 0);
  const gaikaku = (soukaku && jinkaku) ? (soukaku - jinkaku) : 0;
  return { tenkaku, jinkaku, chikaku, gaikaku, soukaku };
}

/** API応答をフロント期待形に正規化＆補完 */
function normalizeAndFill(payload, surname) {
  const arr = Array.isArray(payload?.candidates) ? payload.candidates : [];
  const candidates = arr.slice(0,3).map(c => {
    // 名前
    const fullName = (c.name || "").includes(surname) ? c.name : `${surname} ${c.name || ""}`.trim();

    // strokes
    const sT = num(c?.strokes?.surname?.total);
    const gT = num(c?.strokes?.given?.total);
    const tT = num(c?.strokes?.total);
    const bdSurname = normBD(c?.strokes?.surname?.breakdown);
    const bdGiven   = normBD(c?.strokes?.given?.breakdown);
    const bdAll     = [...bdSurname, ...bdGiven];

    // 五格（欠けていれば計算で補完）
    const gk = calcGokaku(surname, bdAll, sT, gT, tT);

    // 返却
    return {
      name: fullName,
      reading: String(c.reading || ""),
      copy: String(c.copy || ""),
      story: String(c.story || ""),
      strokes: {
        surnameTotal: sT || (bdSurname.reduce((a,b)=>a+b.count,0) || undefined),
        givenTotal:   gT || (bdGiven.reduce((a,b)=>a+b.count,0)   || undefined),
        total:        tT || (sT + gT || undefined),
        breakdown:    bdAll
      },
      fortune: {
        tenkaku: { value: num(c?.fortune?.tenkaku) || gk.tenkaku || undefined },
        jinkaku: { value: num(c?.fortune?.jinkaku) || gk.jinkaku || undefined },
        chikaku: { value: num(c?.fortune?.chikaku) || gk.chikaku || undefined },
        gaikaku: { value: num(c?.fortune?.gaikaku) || gk.gaikaku || undefined },
        soukaku: { value: num(c?.fortune?.soukaku) || gk.soukaku || undefined },
        luck: {
          overall: pickStr(c?.fortune?.luck?.overall),
          work:    pickStr(c?.fortune?.luck?.work),
          love:    pickStr(c?.fortune?.luck?.love),
          health:  pickStr(c?.fortune?.luck?.health),
        },
        note: String(c?.fortune?.note || "")
      }
    };
  });

  return {
    candidates,
    policy: payload?.policy || {
      ryuha: "五格法（新字体・霊数なし）",
      notes: "AIの推定に基づく簡易計算です。"
    }
  };
}

function pickStr(v) {
  if (!v) return "";
  if (typeof v === "string") return v;
  if (typeof v === "object") return v.grade || v.label || "";
  return String(v);
}
