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

    // ✅ debug=1 の場合は3候補を返す
    if (String(req.query?.debug) === "1") {
      const fallback = {
        candidates: [
          {
            name: `${surname} 未来志`, reading: "みらいし",
            copy: "未来へ進む意志を込めて。",
            story: "新しい道を切り開き、周囲に希望を灯す人を描きます。",
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
            story: "挑戦を恐れず、高く翔び続ける姿をイメージ。",
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
            story: "周囲を明るく導く、温かい光の存在を描きます。",
            strokes: {
              surname: { total: 8, breakdown: [["山",3],["田",5]] },
              given:   { total: 8, breakdown: [["未",5],["光",3]] },
              total: 16
            },
            fortune: { tenkaku:8, jinkaku:8, chikaku:8, gaikaku:8, soukaku:16,
              luck:{ overall:"中吉", work:"吉", love:"吉", health:"吉" }, note:"debug fallback" }
          }
        ],
        policy: { ryuha:"五格法（新字体・霊数なし）", notes:"debug=1 fallback" }
      };
      return res.status(200).json(fallback);
    }

    // ✅ 通常モード（OpenAI呼び出し）
    const system = `...（省略：ここは既に組み込んだプロンプト強化版をそのまま残してください）...`;

    const user = `
苗字: ${surname}
性別: ${gender}
希望イメージ: ${concept}
`.trim();

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
