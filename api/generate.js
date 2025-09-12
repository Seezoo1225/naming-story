// api/generate.js
// サーバ側で：AIの画数を鵜呑みにせず、辞書で補正 → 五格（天/人/地/外/総）を再計算して返す。
// 方式：五格法（新字体・霊数なし）を明示。luck（吉/凶など）はAIのまま利用。

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";

/** 画数辞書（新字体・霊数なし）よく使う名前漢字を中心に収録。
 *  足りない場合は随時追加してください。 */
const STROKES = {
  // 基本
  "一":1,"二":2,"三":3,"四":4,"五":5,"六":6,"七":7,"八":8,"九":9,"十":10,
  "人":2,"子":3,"大":3,"小":3,"女":3,"山":3,"川":3,"心":4,"手":4,"文":4,"太":4,"天":4,
  "中":4,"水":4,"木":4,"王":4,"正":5,"生":5,"田":5,"由":5,"目":5,"白":5,"立":5,"永":5,"未":5,
  "外":5,"本":5,"司":5,"加":5,"北":5,"古":5,"右":5,"左":5,"名":6,"各":6,"光":6,"同":6,"向":6,"百":6,
  "有":6,"安":6,"守":6,"吉":6,"朱":6,"成":6,"兆":6,"次":6,"来":7,"君":7,"良":7,"里":7,
  "和":8,"直":8,"青":8,"忠":8,"知":8,"春":9,"音":9,"美":9,"秋":9,"玲":10,"真":10,"夏":10,
  "龍":16,"竜":10,

  // よく使う名前漢字
  "愛":13,"葵":12,"明":8,"彩":11,"歩":8,"陽":12,"結":12,"優":17,"悠":11,"勇":9,"佑":7,"祐":10,"友":4,
  "裕":12,"唯":11,"莉":10,"凛":15,"蓮":13,"涼":11,"遼":15,
  "健":11,"翔":12,"司":5,"海":9,"空":8,"宙":8,"宇":6,"星":9,"晴":12,"冬":5,
  "花":7,"華":10,"香":9,"桜":10,"咲":9,"菜":11,"奈":8,"那":7,"紗":10,"沙":7,"珠":10,
  "実":8,"芽":8,"映":9,"奏":9,"栞":10,"心":4,"叶":5,"望":11,"希":7,"笑":10,"寧":14,
  "尊":12,"志":7,"士":3,"智":12,"直":8,"光":6,"輝":15,"貴":12,"桂":10,"圭":6,"慧":15,"恵":10,"慶":15,
  "景":12,"汰":7,"拓":8,"匠":6,"将":10,"章":11,"彰":14,"剛":10,"豪":14,"翼":17,"隼":10,"浩":10,"航":10,
  "楓":13,"椛":12,"樹":16,"尚":8,"慎":13,"聡":14,"総":14,"蒼":13,"壮":6,"爽":11,"然":12,"禅":13,"染":9,
  "遥":13,"紬":10
};

// ---------- 共通ユーティリティ ----------

// 1文字の画数：辞書優先、無ければ aiGuess（AIが返した値）を採用。どちらも無ければ null。
function strokeOf(ch, aiGuess) {
  if (ch in STROKES) return STROKES[ch];
  if (typeof aiGuess === "number" && isFinite(aiGuess) && aiGuess > 0) return aiGuess;
  return null;
}

// 入力姓と候補の full name から、姓/名の各文字配列を切り出す（スペースは除去）
function splitName(surname, fullName) {
  const clean = String(fullName || "").replace(/\s+/g, "");
  const sChars = Array.from(surname);
  const rest = clean.startsWith(surname) ? clean.slice(sChars.length) : clean;
  const gChars = Array.from(rest);
  return { sChars, gChars };
}

// AIの breakdown を {字: 画} のマップ化
function aiBreakdownMap(candidate) {
  const m = {};
  const bdS = candidate?.strokes?.surname?.breakdown || [];
  const bdG = candidate?.strokes?.given?.breakdown || [];
  [...bdS, ...bdG].forEach(b => {
    const ch = Array.isArray(b) ? String(b[0]) : String(b?.char || "");
    const n = Array.isArray(b) ? Number(b[1]) : Number(b?.count);
    if (ch) m[ch] = isFinite(n) ? n : null;
  });
  return m;
}

// 五格（五格法・新字体・霊数なし）を計算
function calcGokaku(sSum, gSum, sBD, gBD) {
  const total = sSum + gSum;
  const lastSurname = sBD[sBD.length - 1]?.count || 0;
  const firstGiven  = gBD[0]?.count || 0;
  const tenkaku = sSum;
  const jinkaku = lastSurname + firstGiven;
  const chikaku = gSum;
  const soukaku = total;
  const gaikaku = Math.max(soukaku - jinkaku, 0);
  return { tenkaku, jinkaku, chikaku, gaikaku, soukaku, total };
}

// 候補1件を辞書で補正し、五格再計算したオブジェクトを返す
function recalcCandidate(candidate, inputSurname) {
  const { sChars, gChars } = splitName(inputSurname, candidate?.name || "");
  const aiMap = aiBreakdownMap(candidate);

  const sBD = sChars.map(ch => ({ char: ch, count: strokeOf(ch, aiMap[ch]) }));
  const gBD = gChars.map(ch => ({ char: ch, count: strokeOf(ch, aiMap[ch]) }));

  const sum = (arr) => arr.reduce((n, x) => n + (Number(x.count) || 0), 0);
  const sSum = sum(sBD);
  const gSum = sum(gBD);

  const gk = calcGokaku(sSum, gSum, sBD, gBD);

  // 互換のため strokes は従来の形（配列[x, n]）でも返す
  const toArr = (list) => list.map(x => [x.char, x.count ?? null]);

  // fortune の数値は補正値に置き換え、luck（吉凶）は AI からそのまま維持
  const fortune = {
    ...(candidate?.fortune || {}),
    tenkaku: gk.tenkaku,
    jinkaku: gk.jinkaku,
    chikaku: gk.chikaku,
    gaikaku: gk.gaikaku,
    soukaku: gk.soukaku,
  };

  return {
    ...candidate,
    strokes: {
      surname: { total: sSum, breakdown: toArr(sBD) },
      given:   { total: gSum, breakdown: toArr(gBD) },
      total: gk.total,
    },
    fortune,
    __calc: { sBD, gBD, sSum, gSum, total: gk.total, gokaku: gk }
  };
}

// 受け取った candidates 全体を補正
function normalizeCandidates(candidates, surname) {
  return (Array.isArray(candidates) ? candidates : []).map(c => recalcCandidate(c, surname));
}

// ---------- OpenAI へのプロンプト ----------

const SYSTEM_PROMPT = `
You are a Japanese naming & seimei-handan expert.
Respond only in json. The output must be a single valid JSON object.
Do not add any explanations, prose, markdown, or code fences outside the json.

必須ルール:
- 流派/計算方式は「五格法（新字体・霊数なし）」を用いる（天格/人格/地格/外格/総格）。
- 候補は3つ。苗字（入力値）を必ず name の先頭に付ける。
- strokes.breakdown は姓→名の順ですべての漢字を必ず列挙（["漢字", 画数]）。
- strokes.surname.total / strokes.given.total / strokes.total は必ず整数。
- fortune の天格/人格/地格/外格/総格も必ず整数（推定可・空欄禁止）。
- luck は日本語（大吉/中吉/吉/小吉/凶/大凶 など）。
- story は日本語で 3〜5 文、合計 200〜350 文字目安。改行を想定して自然な段落になじむ文体にする。
- JSON 以外の出力は禁止。

返却形式の例:
{
  "candidates":[
    {
      "name":"山田 太志",
      "reading":"たいし",
      "copy":"大きな志を抱いて",
      "story":"200〜350字程度の日本語文（3〜5文）",
      "strokes":{
        "surname":{"total":8,"breakdown":[["山",3],["田",5]]},
        "given":{"total":7,"breakdown":[["太",4],["志",3]]},
        "total":15
      },
      "fortune":{
        "tenkaku":8,"jinkaku":9,"chikaku":7,"gaikaku":6,"soukaku":15,
        "luck":{"overall":"吉","work":"大吉","love":"中吉","health":"吉"},
        "note":"補足（任意）"
      }
    }
  ],
  "policy":{"ryuha":"五格法（新字体・霊数なし）","notes":"現代的で読みやすい表記を優先"}
}
`.trim();

// ---------- ハンドラ ----------

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

    // ---------- デバッグモード（ダミー） ----------
    if (String(req.query?.debug) === "1") {
      const fallback = {
        candidates: [
          {
            name: `${surname} 未来志`, reading: "みらいし",
            copy: "未来へ進む意志を込めて。",
            story: "新しい道を切り開き、周囲に希望を灯す人を描きます。穏やかな語り口で人の心をほぐし、迷いの先に光を示す存在です。日々の小さな積み重ねを大切にし、周囲と歩調をそろえながら前へと進みます。",
            strokes: {
              surname: { total: 8, breakdown: [["山",3],["田",5]] },
              given:   { total: 8, breakdown: [["未",5],["志",3]] },
              total: 16
            },
            fortune: { tenkaku:8, jinkaku:8, chikaku:8, gaikaku:8, soukaku:16,
              luck:{ overall:"吉", work:"吉", love:"中吉", health:"吉" }, note:"debug fallback" }
          },
          {
            name: `${surname} 未来翔`, reading: "みらいしょう",
            copy: "未来へ翔ける力強さ。",
            story: "挑戦を恐れず、高く遠くまで視野を伸ばすタイプ。仲間の背中を押しながら、困難を学びに変え、次のチャンスに結びつけます。軽やかな風のように、周囲に前向きな流れを生み出します。",
            strokes: {
              surname: { total: 8, breakdown: [["山",3],["田",5]] },
              given:   { total: 12, breakdown: [["未",5],["翔",7]] },
              total: 20
            },
            fortune: { tenkaku:8, jinkaku:10, chikaku:12, gaikaku:10, soukaku:20,
              luck:{ overall:"吉", work:"大吉", love:"中吉", health:"吉" }, note:"debug fallback" }
          },
          {
            name: `${surname} 未来光`, reading: "みらいこう",
            copy: "未来を照らす光。",
            story: "周囲にやさしい明るさをもたらし、人の長所を見つけるのが得意。静かな芯の強さを持ち、困難な時にも落ち着いて選択します。気づけば皆の目印となり、安心感を広げていきます。",
            strokes: {
              surname: { total: 8, breakdown: [["山",3],["田",5]] },
              given:   { total: 8, breakdown: [["未",5],["光",3]] },
              total: 16
            },
            fortune: { tenkaku:8, jinkaku:8, chikaku:8, gaikaku:8, soukaku:16,
              luck:{ overall:"中吉", work:"吉", love:"吉", health:"吉" }, note:"debug fallback" }
          }
        ],
        policy: { ryuha:"五格法（新字体・霊数なし）", notes:"現代的で読みやすい表記を優先" }
      };

      // ここで辞書補正
      const normalized = normalizeCandidates(fallback.candidates, surname);
      return res.status(200).json({ candidates: normalized, policy: fallback.policy });
    }

    // ---------- OpenAI 呼び出し ----------
    const user = `苗字: ${surname}\n性別: ${gender}\n希望イメージ: ${concept}`.trim();

    const oaRes = await fetch(OPENAI_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        response_format: { type: "json_object" },
        temperature: 0.8,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: user },
        ],
      }),
    });

    const oaJson = await oaRes.json();
    if (!oaRes.ok) {
      console.error("[openai-error]", oaRes.status, oaJson);
      return res.status(oaRes.status).json({
        message: oaJson?.error?.message || "OpenAI error",
        status: oaRes.status,
        raw: oaJson,
      });
    }

    // JSON取り出し
    let raw;
    try {
      raw = JSON.parse(oaJson?.choices?.[0]?.message?.content || "{}");
    } catch {
      const m = (oaJson?.choices?.[0]?.message?.content || "").match(/{[\s\S]*}/);
      raw = m ? JSON.parse(m[0]) : {};
    }

    // ここでサーバ側も辞書補正
    const normalized = normalizeCandidates(raw?.candidates || [], surname);

    const policy = raw?.policy || {
      ryuha: "五格法（新字体・霊数なし）",
      notes: "現代的で読みやすい表記を優先"
    };

    return res.status(200).json({ candidates: normalized, policy });

  } catch (e) {
    console.error("[server-error]", e);
    return res.status(500).json({ message: "Server error", detail: String(e?.message || e) });
  }
}
