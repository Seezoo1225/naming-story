// api/generate.js
// 概要：
// - OpenAIの返答を受け取りつつ、サーバ側で「名前にカタカナ禁止（漢字/ひらがなのみ）」を強制。
// - もし name/reading にカタカナが含まれたら自動で「ひらがな」へ変換してから採用。
// - 画数は辞書（新字体・霊数なし＋かな画数）で補正し、五格（天/人/地/外/総）を再計算して返却。
// - luck（吉/凶などの判定）はAI返答をそのまま利用。

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";

/** 画数辞書（新字体・霊数なし）＋ ひらがな画数
 *  必要に応じて追記してください。 */
const STROKES = {
  // 基本
  "一":1,"二":2,"三":3,"四":4,"五":5,"六":6,"七":7,"八":8,"九":9,"十":10,
  "人":2,"子":3,"大":3,"小":3,"女":3,"山":3,"川":3,"心":4,"手":4,"文":4,"太":4,"天":4,
  "中":4,"水":4,"木":4,"王":4,"正":5,"生":5,"田":5,"由":5,"目":5,"白":5,"立":5,"永":5,"未":5,
  "外":5,"本":5,"司":5,"加":5,"北":5,"古":5,"右":5,"左":5,"名":6,"各":6,"光":6,"同":6,"向":6,"百":6,
  "有":6,"安":6,"守":6,"吉":6,"朱":6,"成":6,"兆":6,"次":6,"来":7,"君":7,"良":7,"里":7,
  "和":8,"直":8,"青":8,"忠":8,"知":8,"春":9,"音":9,"美":9,"秋":9,"玲":10,"真":10,"夏":10,
  "竜":10,"龍":16,

  // よく使う名前漢字
  "愛":13,"葵":12,"明":8,"彩":11,"歩":8,"陽":12,"結":12,"優":17,"悠":11,"勇":9,"佑":7,"祐":10,"友":4,
  "裕":12,"唯":11,"莉":10,"凛":15,"蓮":13,"涼":11,"遼":15,
  "健":11,"翔":12,"司":5,"海":9,"空":8,"宙":8,"宇":6,"星":9,"晴":12,"冬":5,
  "花":7,"華":10,"香":9,"桜":10,"咲":9,"菜":11,"奈":8,"那":7,"紗":10,"沙":7,"珠":10,
  "実":8,"芽":8,"映":9,"奏":9,"栞":10,"心":4,"叶":5,"望":11,"希":7,"笑":10,"寧":14,
  "尊":12,"志":7,"士":3,"智":12,"直":8,"光":6,"輝":15,"貴":12,"桂":10,"圭":6,"慧":15,"恵":10,"慶":15,
  "景":12,"汰":7,"拓":8,"匠":6,"将":10,"章":11,"彰":14,"剛":10,"豪":14,"翼":17,"隼":10,"浩":10,"航":10,
  "楓":13,"椛":12,"樹":16,"尚":8,"慎":13,"聡":14,"総":14,"蒼":13,"壮":6,"爽":11,"然":12,"禅":13,"染":9,
  "遥":13,"紬":10,

  // ひらがな画数（一般的に使われる数え方の一例）
  "あ":3,"い":2,"う":2,"え":2,"お":3,
  "か":3,"き":4,"く":1,"け":3,"こ":2,
  "さ":3,"し":1,"す":2,"せ":3,"そ":1,
  "た":4,"ち":2,"つ":1,"て":1,"と":2,
  "な":2,"に":3,"ぬ":2,"ね":2,"の":1,
  "は":3,"ひ":1,"ふ":4,"へ":1,"ほ":4,
  "ま":3,"み":3,"む":3,"め":3,"も":3,
  "や":2,"ゆ":2,"よ":2,
  "ら":2,"り":2,"る":2,"れ":2,"ろ":1,
  "わ":2,"を":3,"ん":1,
  "ぁ":2,"ぃ":1,"ぅ":1,"ぇ":1,"ぉ":2,
  "ゃ":2,"ゅ":2,"ょ":2,"っ":1
};

// -------- KATAKANA → HIRAGANA 変換 --------
const kataToHira = (str) =>
  String(str || "").replace(/[\u30A1-\u30F6]/g, ch =>
    String.fromCharCode(ch.charCodeAt(0) - 0x60)
  );

// -------- ユーティリティ --------

function strokeOf(ch, aiGuess) {
  if (ch in STROKES) return STROKES[ch];
  if (typeof aiGuess === "number" && isFinite(aiGuess) && aiGuess > 0) return aiGuess;
  return null;
}

function splitName(surname, fullName) {
  const clean = String(fullName || "").replace(/\s+/g, "");
  const sChars = Array.from(surname);
  const rest = clean.startsWith(surname) ? clean.slice(sChars.length) : clean;
  const gChars = Array.from(rest);
  return { sChars, gChars };
}

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

function recalcCandidate(candidate, inputSurname) {
  // ルール：name/readingのカタカナは「ひらがな」に強制変換
  const fixedName = kataToHira(candidate?.name || "");
  const fixedReading = kataToHira(candidate?.reading || "");

  // name を差し替えた状態で分割
  const { sChars, gChars } = splitName(inputSurname, fixedName);
  const aiMap = aiBreakdownMap(candidate);

  const sBD = sChars.map(ch => ({ char: ch, count: strokeOf(ch, aiMap[ch]) }));
  const gBD = gChars.map(ch => ({ char: ch, count: strokeOf(ch, aiMap[ch]) }));

  const sum = (arr) => arr.reduce((n, x) => n + (Number(x.count) || 0), 0);
  const sSum = sum(sBD);
  const gSum = sum(gBD);

  const gk = calcGokaku(sSum, gSum, sBD, gBD);

  const toArr = (list) => list.map(x => [x.char, x.count ?? null]);

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
    name: fixedName,
    reading: fixedReading ? kataToHira(fixedReading) : fixedReading,
    strokes: {
      surname: { total: sSum, breakdown: toArr(sBD) },
      given:   { total: gSum, breakdown: toArr(gBD) },
      total: gk.total,
    },
    fortune,
    policy: candidate?.policy,
    __calc: { sBD, gBD, sSum, gSum, total: gk.total, gokaku: gk }
  };
}

function normalizeCandidates(candidates, surname) {
  return (Array.isArray(candidates) ? candidates : []).map(c => recalcCandidate(c, surname));
}

// -------- OpenAI プロンプト --------

const SYSTEM_PROMPT = `
You are a Japanese naming & seimei-handan expert.
Respond only in json. The output must be a single valid JSON object.
Do not add any explanations, prose, markdown, or code fences outside the json.

厳守ルール:
- 流派/計算方式は「五格法（新字体・霊数なし）」を用いる（天格/人格/地格/外格/総格）。
- 候補は必ず3つ。name は「<苗字><スペース><名>」とし、苗字（入力値）を先頭に付ける。
- **name にカタカナを使ってはいけない**（漢字またはひらがなにする）。reading は必ず「ひらがな」。
- strokes.breakdown は姓→名の順ですべての字を列挙（["字", 画数]）。total/各格は整数。
- luck は日本語（大吉/中吉/吉/小吉/凶/大凶 など）。
- story は日本語で 200〜350 字・3〜5文、改行を想定した自然な文体。
- JSON 以外の出力は禁止。

返却形式の例:
{
  "candidates":[
    {
      "name":"山田 たいし",
      "reading":"たいし",
      "copy":"大きな志を抱いて",
      "story":"200〜350字程度の日本語文（3〜5文）",
      "strokes":{
        "surname":{"total":8,"breakdown":[["山",3],["田",5]]},
        "given":{"total":7,"breakdown":[["た",4],["い",2],["し",1]]},
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

// -------- ハンドラ --------

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

    // --- デバッグ（ダミー） ---
    if (String(req.query?.debug) === "1") {
      const fallback = {
        candidates: [
          {
            name: `${surname} せいた`,
            reading: "せいた",
            copy: "夢を追い続ける",
            story: "挑戦を恐れず、夢に向かって突き進む若者像。周囲を勇気づけ、共に成長する道を選びます。将来は創造の分野で名を残すことを目指します。",
            strokes: {
              surname: { total: 8, breakdown: [["山",3],["田",5]] },
              given:   { total: 7, breakdown: [["せ",3],["い",2],["た",4]] },
              total: 15
            },
            fortune: { tenkaku:8, jinkaku:?, chikaku:?, gaikaku:?, soukaku:15,
              luck:{ overall:"吉", work:"中吉", love:"吉", health:"吉" }, note:"debug fallback" }
          },
          {
            name: `${surname} かい`,
            reading: "かい",
            copy: "新しい世界を探求する",
            story: "冒険心あふれる若者。新しい経験を求めて旅をし、多様性を大切にします。行動力で周囲を巻き込み、楽しい体験を共有していきます。",
            strokes: {
              surname: { total: 8, breakdown: [["山",3],["田",5]] },
              given:   { total: 3, breakdown: [["か",3],["い",2]] }, // totalは後で補正されます
              total: 11
            },
            fortune: { tenkaku:8, jinkaku:?, chikaku:?, gaikaku:?, soukaku:11,
              luck:{ overall:"中吉", work:"吉", love:"中吉", health:"吉" }, note:"debug fallback" }
          },
          {
            name: `${surname} りょうた`,
            reading: "りょうた",
            copy: "自由な精神を持つ",
            story: "多様な文化に触れることで視野を育てるタイプ。明るい性格で周囲に良い影響を与え、将来は国際的な舞台での活躍を目指します。",
            strokes: {
              surname: { total: 8, breakdown: [["山",3],["田",5]] },
              given:   { total: 7, breakdown: [["り",2],["ょ",2],["う",2],["た",4]] },
              total: 15
            },
            fortune: { tenkaku:8, jinkaku:?, chikaku:?, gaikaku:?, soukaku:15,
              luck:{ overall:"吉", work:"吉", love:"中吉", health:"吉" }, note:"debug fallback" }
          }
        ],
        policy: { ryuha: "五格法（新字体・霊数なし）", notes: "現代的で読みやすい表記を優先" }
      };

      // 辞書補正＆五格再計算
      const normalized = normalizeCandidates(fallback.candidates, surname);
      return res.status(200).json({ candidates: normalized, policy: fallback.policy });
    }

    // --- OpenAI 呼び出し ---
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

    // JSON抽出
    let raw;
    try {
      raw = JSON.parse(oaJson?.choices?.[0]?.message?.content || "{}");
    } catch {
      const m = (oaJson?.choices?.[0]?.message?.content || "").match(/{[\s\S]*}/);
      raw = m ? JSON.parse(m[0]) : {};
    }

    // サーバ側で：カタカナ→ひらがな変換＋辞書補正＋五格再計算
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
