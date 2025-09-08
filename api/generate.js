// api/generate.js
import OpenAI from "openai";

const MODEL = "gpt-4o-mini";

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const { surname, gender, concept } = req.body ?? {};
    // 入力ガード（過度な長文や空欄を弾く）
    const s = (surname || "").trim().slice(0, 16);
    const g = (gender || "unknown").toLowerCase();
    const c = (concept || "").trim().slice(0, 60);
    if (!s || !c) return res.status(400).json({ error: "surname_and_concept_required" });

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const system = `あなたは現代的なネーミングコピーライター兼ライトな姓名判断アナリストです。出力は必ず日本語。マークダウン禁止。JSONのみで返すこと。
要件:
- 3件の候補を生成（性別: ${g} / unknownは中性）。
- 各候補は {name, reading, copy, story, fortune{...}, strokes{...}} とする。
- fortune は各格に value(整数) と grade(大吉/吉/中吉/小吉/凶/大凶) を付与。luckのoverall/work/love/healthも同表記。
- strokes は姓・名・総画と内訳（[漢字, 数]の配列）。数値は可能な範囲で一貫させる。
- 占い口調は禁止。現代的・簡潔・ポジティブ。
- 全て日本語で。英語は使わない。
返却JSONの最上位は { "candidates":[...3件...], "policy":{ "ryuha": "...", "notes": "..." } } のみ。`;

    const user = `姓: ${s}
性別: ${g}
希望イメージ: ${c}
厳密なJSONのみで返してください。`;

    // リトライ付きの呼び出し
    const call = async (attempt = 1) => {
      try {
        const r = await openai.responses.create({
          model: MODEL,
          input: [
            { role: "system", content: system },
            { role: "user", content: user }
          ]
        });
        return r;
      } catch (e) {
        // 429/5xxは最大3回までリトライ
        if ((e?.status === 429 || (e?.status >= 500 && e?.status < 600)) && attempt < 3) {
          await new Promise(r => setTimeout(r, 600 * attempt)); // 0.6s, 1.2s
          return call(attempt + 1);
        }
        throw e;
      }
    };

    const response = await call();
    const text = response.output_text || "";
    let json;
    try {
      json = JSON.parse(text);
      if (!json || !Array.isArray(json.candidates)) throw new Error("invalid_json_shape");
      json.candidates = json.candidates.slice(0, 3);
      json.policy = json.policy || {
        ryuha: "五格法（新字体／霊数なし／人格=姓末+名頭）",
        notes: "辞書非搭載のため画数は推定。旧字体・流派差で変動の可能性。"
      };
    } catch {
      json = {
        candidates: [
          {
            name: `${s} ネオ`,
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

    return res.status(200).json(json);
  } catch (err) {
    console.error("OPENAI ERROR:", err?.status, err?.message);
    return res.status(500).json({
      error: "generation_failed",
      status: err?.status || null,
      message: err?.message || null
    });
  }
}
