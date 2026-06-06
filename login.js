// 로그인 검증 — 아이디/비밀번호는 Vercel 환경변수에만 저장 (코드/HTML에 평문 없음)
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false });

  // body가 문자열로 올 경우 대비
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch(e) { body = {}; }
  }
  const id = (body?.id || '').trim();
  const pw = body?.pw || '';

  const LOGIN_ID = process.env.LOGIN_ID;
  const LOGIN_PW = process.env.LOGIN_PW;

  // 환경변수 미설정 시 명확히 안내 (보안상 코드에 평문 미포함)
  if (!LOGIN_ID || !LOGIN_PW) {
    return res.status(500).json({
      ok: false,
      error: 'Vercel 환경변수(LOGIN_ID, LOGIN_PW)를 먼저 설정하세요. Settings → Environment Variables'
    });
  }

  if (id === LOGIN_ID && pw === LOGIN_PW) {
    const token = Buffer.from(`${id}:${Date.now()}`).toString('base64');
    return res.status(200).json({ ok: true, token });
  }

  return res.status(401).json({ ok: false, error: '아이디 또는 비밀번호가 틀렸습니다' });
}
