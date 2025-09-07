import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import OpenAI from "openai";

const app = express();
app.use(express.json());

// 静的ファイル
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.use(express.static(path.join(__dirname, "public")));

// OpenAI
if (!process.env.OPENAI_API_KEY) {
  console.warn("[WARN] OPENAI_API_KEY is not set.");
}
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * /api/generate
 * 入力: { surname, gender, concept }
 * 出力: {
 *   candidates: [
 *     {
 *       name, reading, copy, story,
 *       fortune: {
 *         tenkaku: { value, grade }, jinkaku: { value, grade },
 *         chikaku: { value, grade }, gaikaku: { value, grade },
 *         soukaku: { value, grade },
 *         luck: { overall, work, love, health }, note
 *       },
 *       strokes: { surnameTotal, givenTotal, total, breakdown: [[kanji, num], ...] }
 *     } x3
 *   ],
 *   policy: { ryuha, notes }
 * }
 */
app.post("/api/generate", async (req, res) => {
  try {
    const { surname, gender, concept } = req.body ?? {};
    if (!surname || !concept) {
      return res.status(400).json({ error: "surname_and_concept_required" });
    }

    const system = `あなたは現代的なネーミングコピーライター兼ライトな姓名判断アナリストです。出力は必ず日本語。マークダウン禁止。JSONのみで返すこと。

要件:
- 3件の候補を生成する（男女未指定なら中性的に）。
- それぞれ以下の構造で返す:
  {
    "name": "河原 剛真",
    "reading": "かわはら ごうま",
    "copy": "12語以内の短いコンセプトコピー（日本語）",
    "story": "2〜4文の現代的な日本語のストーリー（占い口調は禁止）",
    "fortune": {
      "tenkaku": { "value": 整数, "grade": "大吉/吉/中吉/小吉/凶/大凶など" },
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
      "note": "画数や格の算出は流派により差があるため、ここでは推定値である旨を1行で明記（日本語）"
    },
    "strokes": {
      "surnameTotal": 整数,
      "givenTotal": 整数,
      "total": 整数,
      "breakdown": [["河", 8], ["原", 10], ["剛", 10], ["真", 10]] のように姓から順に
    }
  }

- 言語はすべて日本語。アルファベットのみにしないこと。
- 性別: ${gender || "unknown"} を考慮（unknownなら中性に）。
- コンセプト: ${concept} を反映。
- fortune の "grade" は各格ごとに必ず付け、luck と矛盾しないこと。
- 数値と内訳は一貫性を持たせる（合計＝内訳の和）。完全一致が難しい場合は最も近い一貫性を保つ。

最後に "policy" を付与:
{
  "ryuha": "五格（天格・人格・地格・外格・総格）法に準拠。新字体ベース／霊数なし／人格=姓の末字+名の最初の字。",
  "notes": "辞書非搭載のため画数は推定。旧字体・流派差で数え方が異なる可能性があります。"
}

返却JSONの最上位は次の形に限定:
{
  "candidates": [ ...3件... ],
  "policy": { "ryuha": "...", "notes": "..." }
}`;
    const user = `姓: ${surname}
性別: ${gender || "unknown"}
希望イメージ: ${concept}
上記の要件を満たす厳密なJSONのみで返してください。`;

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
    } catch (e) {
      // フォールバック（最低限日本語で）
      json = {
        candidates: [
          {
            name: `${surname} ネオ`,
            reading: "",
            copy: "シンプルで力強い名前。",
            story: "現代的で覚えやすく、静かな芯の強さを感じさせます。",
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
          ryuha: "五格法（新字体／霊数なし／人格=姓末+名頭）に準拠（推定）。",
          notes: "辞書非搭載のため画数は推定。実運用では専用辞書で検証してください。"
        }
      };
    }

    res.json(json);
  } catch (err) {
    console.error("OPENAI ERROR:", err?.status, err?.message);
    if (err?.response?.data) console.error("OPENAI RESPONSE DATA:", err.response.data);
    res.status(500).json({
      error: "generation_failed",
      status: err?.status || null,
      message: err?.message || null,
      details: err?.response?.data || null
    });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Server on http://localhost:${port}`));
