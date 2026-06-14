// 범용 AI 프록시 — 프론트엔드에서 Claude Fable 5 호출용
// Anthropic은 브라우저 직접 호출(CORS) 차단되므로 서버 프록시 필수
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { system, messages, max_tokens = 1500 } = req.body || {};
  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'messages 배열이 필요합니다' });
  }

  try {
    const body = {
      model: 'claude-opus-4-8',
      max_tokens,
      messages
    };
    if (system) body.system = system;

    const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(body)
    });

    if (!apiRes.ok) {
      const errText = await apiRes.text();
      return res.status(apiRes.status).json({ error: 'Claude API 오류: ' + errText });
    }

    const data = await apiRes.json();
    const text = data.content?.[0]?.text || '';
    const inputTokens = data.usage?.input_tokens || 0;
    const outputTokens = data.usage?.output_tokens || 0;

    return res.status(200).json({
      text,
      tokens: { input: inputTokens, output: outputTokens, total: inputTokens + outputTokens }
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
