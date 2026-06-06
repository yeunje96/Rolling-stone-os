// gcal 토큰 → sops 테이블에 저장 (agent_memory는 RLS 막힘, settings.value는 integer)
const SUPABASE_URL = 'https://lkcmgritsfjgvqsldqmc.supabase.co/rest/v1';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxrY21ncml0c2ZqZ3Zxc2xkcW1jIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg4NTA3MzcsImV4cCI6MjA5NDQyNjczN30.x8v1q8-nCaRRtEJT-9GBoYl34R_KL0wB-UVmBJx_D9Q';

const GCAL_TITLE = '__gcal_token__';

async function sbFetch(path, opts = {}) {
  return fetch(SUPABASE_URL + path, {
    ...opts,
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': 'Bearer ' + SUPABASE_KEY,
      'Content-Type': 'application/json',
      ...(opts.headers || {})
    }
  });
}

export default async function handler(req, res) {
  const { code, error } = req.query;
  if (error) return res.redirect(302, '/?gcal=error&msg=' + encodeURIComponent(error));
  if (!code) return res.status(400).send('code 파라미터가 없습니다');

  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri: 'https://rollingstone-ai.vercel.app/api/gcal-callback',
        grant_type: 'authorization_code'
      })
    });

    const tokens = await tokenRes.json();
    if (tokens.error) throw new Error(tokens.error_description || tokens.error);

    const tokenData = JSON.stringify({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: Date.now() + (tokens.expires_in * 1000)
    });

    // 기존 토큰 삭제 후 재저장 (sops 테이블)
    await sbFetch(`/sops?title=eq.${encodeURIComponent(GCAL_TITLE)}`, { method: 'DELETE' });
    const saveRes = await sbFetch('/sops', {
      method: 'POST',
      headers: { 'Prefer': 'return=minimal' },
      body: JSON.stringify([{
        department: '_system',
        title: GCAL_TITLE,
        content: tokenData,
        status: 'active'
      }])
    });

    if (!saveRes.ok) throw new Error('토큰 저장 실패: ' + await saveRes.text());

    res.redirect(302, '/?gcal=success');
  } catch (e) {
    res.redirect(302, '/?gcal=error&msg=' + encodeURIComponent(e.message));
  }
}
