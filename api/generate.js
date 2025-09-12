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

    // ---------- debug fallback ----------
    if (String(req.query?.debug) === "1") {
      const fallback = {
        candidates: [
          {
            name: `${surname} 未来志`,
            reading: "みらいし",
            copy: "未来へ進む意志を込めて。",
            story: "新しい道を切り開き、周囲に希望を灯す人を描きます。",
            strokes: {
              surname: { total: 8, breakdown: [["山", 3], ["田", 5]] },
              given: { total: 8, breakdown: [["未", 5], ["志", 3]] },
              total: 16,
            },
            fortune: {
              tenkaku: 8,
              jinkaku: 8,
              chikaku: 8,
              gaikaku: 8,
              soukaku: 16,
              luck: { overall: "吉", work: "吉", love: "中吉", health: "吉" },
              note: "debug fallback",
            },
          },
        ],
        policy: { ryuha: "五格法（新字体・霊数なし）", notes: "debug=1 fallback" },
      };
      return res.status(200).json(fallback);
    }

    // ---------- system prompt ----------
    const system = `
あなたは日本の姓名判断とネーミングの専門家です。
必ず **有効なJSONのみ** を返してください（説明文は禁止）。

必須ルール:
- 候補は3つ。
- 苗字（入力値）を必ず name の先頭に付ける。
- strokes.breakdown は姓→名の順ですべての漢字を **必ず** 列挙（["漢字", 画数]）。
- strokes.surname.total / strokes.given.total / strokes.total を **必ず** 整数で返す。
- fortune の天格/人格/地格/外格/総格は **必ず** 整数で返す。推定でよいが空欄は禁止。
- luck は日本語（大吉/中吉/吉/小吉/凶/大凶 など）。
- JSON 以外の出力は厳禁。

返却例（形式厳守）:
{
  "candidates":[
    {
      "name":"山田 太志",
      "reading":"たいし",
      "copy":"大きな志を抱いて",
      "story":"2〜4文の物語（日本語）",
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
  "policy":{"ryuha":"五格法（新字体・霊数なし）","notes":"現代的でポジティブなニュアンスを重視"}
}
`.trim();

    const user = `
苗字: ${surname}
性別: ${gender}
希望イメージ: ${concept}
`.trim();

    // ---------- OpenAI call ----------
    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        response_format: { type: "json_object" },
        temperature: 0.7,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });

    const data = await resp.json();

    if (!resp.ok) {
      console.error("[openai-error]", resp.status, data);
      return res.status(resp.status).json({
        message: data?.error?.message || "OpenAI error",
        status: resp.status,
        raw: data,
      });
    }

    // ---------- JSON parse ----------
    let raw;
    try {
      raw = JSON.parse(data?.choices?.[0]?.message?.content || "{}");
    } catch {
      const m = (data?.choices?.[0]?.message?.content || "").match(/{[\s\S]*}/);
      raw = m ? JSON.parse(m[0]) : {};
    }

    return res.status(200).json(raw);

  } catch (e) {
    console.error("[server-error]", e);
    return res.status(500).json({ message: "Server error", detail: String(e?.message || e) });
  }
}
