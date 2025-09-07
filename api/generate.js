// api/generate.js  — VercelのServerless Function
import OpenAI from "openai";

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const { surname, gender, concept } = req.body ?? {};
    if (!surname || !concept) {
      return res.status(400).json({ error: "surname_and_concept_required" });
    }

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const system = `あなたは現代的なネーミングコピーライター兼ライトな姓名判断アナリストです。出力は必ず日本語。マークダウン禁止。JSONのみで返すこと。

要件:
- 3件の候補を生成する（男女未指定なら中性的に）。
- それぞれ以下の構造で返す:
  {
    "name": "山田 剛真",
    "reading": "やまだ ごうま",
    "copy": "12語以内の短いコンセプトコピー",
    "story": "2〜4文の現代日本語ストーリー（占い口調は禁止）",
    "fortune": {
      "tenkaku": { "value": 整数, "grade": "大吉/吉/中吉/小吉/凶/大凶" },
      "jinkaku": { "value": 整数, "grade": 同上 },
      "chikaku": { "value": 整数, "grade": 同上 },
      "gaikaku": { "value": 整数, "grade": 同上 },
      "soukaku": { "value": 整数, "grade": 同上 },
      "luck": {
        "overall": "大吉/吉/中吉/小吉/凶など",
        "work": "大吉/吉/中吉/小吉/凶など",
        "love": "大吉/吉/中吉/小吉/凶など",
        "health": "大吉/吉/中吉/小吉/凶など"
      },
      "note": "流派差があるため推定である旨を1行で明記"
    },
    "strokes": {
      "surnameTotal": 整数,
      "givenTotal": 整数,
      "total": 整数,
      "breakdown": [["山", 3], ["田", 5], ...] のように姓から順に
    }
  }

- 性別: ${gender || "unknown"} を考慮（unknownなら中性）。
- コンセプト: ${concept} を反映。
- 数値と内訳は可能な範囲で一貫させる。
最後に "policy" を付与:
{
  "ryuha": "五格法（新字体／霊数なし／人格=姓末+名頭）",
  "notes": "辞書非搭載のため画数は推定。旧字体・流派差で変動の可能性。"
}
返却JSONの最上位は:
{ "candidates":[..3件..], "policy":{...} }`;

    const user = `姓: ${surname}
性別: ${gender || "unknown"}
希望イメージ: ${concept}
厳密なJSONのみで返してください。`;

    const response = await openai.responses.create({
      model: "gpt-4o-mini",
      input: [
        { role: "system", content: system },
        { role: "user", content: user }
      ]
    });

    const text = response.output_text || "";
    let json;
    try {
      json = JSON.parse(text);
      if (!json || !Array.isArray(json.candidates)) {
        throw new Error("invalid_json_shape");
      }
      json.candidates = json.candidates.slice(0, 3);
    } catch {
      json = {
        candidates: [
          {
            name: `${surname} ネオ`,
            reading: "",
            copy: "シンプルで力強い名前。",
            story: "覚えやすく現代的。静かな芯の強さを感じさせます。",
            fortune: {
              tenkaku: { value: 0, grade: "中吉" },
              jinkaku: { value: 0, grade: "吉" },
              chikaku: { value: 0, grade: "吉" },
              gaikaku: { value: 0, grade: "吉" },
              soukaku: { value: 0, grade: "中吉" },
              luck: { overall: "中吉", work: "吉", love: "吉", health: "吉" },
              note: "自動生成のため概算です（流派により差があります）。"
            },
            strokes: { surnameTotal: 0, givenTotal: 0, total: 0, breakdown: [] }
          }
        ],
        policy: {
          ryuha: "五格法（新字体／霊数なし／人格=姓末+名頭）",
          notes: "辞書非搭載のため画数は推定です。"
        }
      };
    }

    res.status(200).json(json);
  } catch (err) {
    console.error("OPENAI ERROR:", err?.status, err?.message);
    return res.status(500).json({
      error: "generation_failed",
      status: err?.status || null,
      message: err?.message || null
    });
  }
}
