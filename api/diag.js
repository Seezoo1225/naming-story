// api/diag.js
export default async function handler(req, res) {
  const hasKey = Boolean(process.env.OPENAI_API_KEY);
  const masked = hasKey ? (process.env.OPENAI_API_KEY.slice(0, 8) + "…") : null;
  return res.status(200).json({
    ok: true,
    hasOpenAIKey: hasKey,
    openaiKeyPreview: masked,
    node: process.version,
    now: new Date().toISOString()
  });
}
