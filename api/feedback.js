// api/feedback.js
export default async function handler(req, res){
  if(req.method !== "POST") return res.status(405).json({error:"Method not allowed"});
  const { message, ua } = req.body || {};
  const m = (message || "").trim().slice(0, 500);
  if(!m) return res.status(400).json({error:"empty"});
  // まずはログに記録（Vercel Functions Logsで確認できます）
  console.log("[feedback]", {
    ts: new Date().toISOString(),
    msg: m,
    ua: (ua||"").slice(0, 160)
  });
  // 余裕があればここで Slack Webhook / KV 保存に拡張可
  return res.status(200).json({ ok:true });
}
