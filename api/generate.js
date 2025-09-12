// api/generate.js
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ message: "Method not allowed" });

  try {
    const { surname = "", gender = "unknown", concept = "" } = req.body || {};
    if (!process.env.OPENAI_API_KEY) return res.status(500).json({ message: "Missing OPENAI_API_KEY" });
    if (!surname || !concept) return res.status(400).json({ message: "surname and concept are required" });

    // debug=1 → ダミー候補3つ
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
      return res.status(200).json(fallback);
    }

    // ---------- system prompt ----------
    const system = `
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

    const user = `苗字: ${surname}\n性別: ${gender}\n希望イメージ: ${concept}`.trim();

    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
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
