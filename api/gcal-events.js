const SUPABASE_URL = 'https://lkcmgritsfjgvqsldqmc.supabase.co/rest/v1';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxrY21ncml0c2ZqZ3Zxc2xkcW1jIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg4NTA3MzcsImV4cCI6MjA5NDQyNjczN30.x8v1q8-nCaRRtEJT-9GBoYl34R_KL0wB-UVmBJx_D9Q';
const GCAL_TITLE = '__gcal_token__';

async function getTokens() {
  const res = await fetch(SUPABASE_URL + '/sops?title=eq.' + encodeURIComponent(GCAL_TITLE) + '&select=content&limit=1', {
    headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY }
  });
  const rows = await res.json();
  if (!rows?.[0]?.content) return null;
  try { return JSON.parse(rows[0].content); } catch(e) { return null; }
}

async function saveTokens(tokens) {
  await fetch(SUPABASE_URL + '/sops?title=eq.' + encodeURIComponent(GCAL_TITLE), {
    method: 'DELETE',
    headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY }
  });
  await fetch(SUPABASE_URL + '/sops', {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY,
      'Content-Type': 'application/json', 'Prefer': 'return=minimal'
    },
    body: JSON.stringify([{ department: '_system', title: GCAL_TITLE, content: JSON.stringify(tokens), status: 'active' }])
  });
}

async function refreshAccessToken(refresh_token) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token,
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      grant_type: 'refresh_token'
    })
  });
  return res.json();
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();


  // /api/gcal-events?type=ics&icsUrl=... — ICS 캘린더 파싱
  if (req.query.type === 'ics') {
    const { icsUrl, days = 30 } = req.query;
    if (!icsUrl) return res.status(400).json({ error: 'icsUrl 파라미터가 필요합니다' });
    try {
      const resp = await fetch(decodeURIComponent(icsUrl), { headers: { 'User-Agent': 'RollingStoneOS/1.0' }, signal: AbortSignal.timeout(8000) });
      if (!resp.ok) throw new Error('캘린더 응답 오류: ' + resp.status);
      const ics = await resp.text();
      const now2 = new Date(), maxDate = new Date(now2.getTime() + parseInt(days)*86400000), events = [];
      const blocks = ics.split('BEGIN:VEVENT');
      for (let i = 1; i < blocks.length; i++) {
        const blk = blocks[i];
        const get = (k) => { const m=blk.match(new RegExp(k+'[^:]*:([\\s\\S]*?)(?:\\r?\\n[^ \\t]|$)')); return m?m[1].replace(/\r?\n[ \t]/g,'').trim():''; };
        const title=get('SUMMARY'), dtStart=get('DTSTART'), dtEnd=get('DTEND'), location=get('LOCATION');
        if (!title||!dtStart) continue;
        const parseD=(s)=>{ if(!s)return null; try{ const c=s.replace(/[TZ]/g,'').replace(/[^0-9]/g,''); if(c.length>=8){const y=c.slice(0,4),mo=c.slice(4,6),d=c.slice(6,8),h=c.slice(8,10)||'00',m2=c.slice(10,12)||'00'; return new Date(`${y}-${mo}-${d}T${h}:${m2}:00+09:00`); } }catch(e){} return null; };
        const sd=parseD(dtStart); if(!sd||sd<now2||sd>maxDate) continue;
        events.push({ title, start:sd.toISOString(), end:dtEnd?parseD(dtEnd)?.toISOString():null, date:sd.toISOString().slice(0,10), time:dtStart.includes('T')?sd.toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Seoul'}):'종일', location:location||null, is_done:false });
      }
      return res.status(200).json({ events: events.sort((a,b)=>new Date(a.start)-new Date(b.start)), count: events.length });
    } catch(e) { return res.status(500).json({ error: e.message }); }
  }

  try {
    let tokens = await getTokens();
    if (!tokens) return res.status(401).json({ error: '구글 캘린더 연동이 필요합니다', connected: false });

    if (Date.now() >= tokens.expires_at - 60000) {
      const refreshed = await refreshAccessToken(tokens.refresh_token);
      if (refreshed.error) return res.status(401).json({ error: '토큰 갱신 실패, 재연동 필요', connected: false });
      tokens = { ...tokens, access_token: refreshed.access_token, expires_at: Date.now() + (refreshed.expires_in * 1000) };
      await saveTokens(tokens);
    }

    const days = parseInt(req.query.days || '60');
    const now = new Date();
    const future = new Date(now.getTime() + days * 86400000);

    const calRes = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${now.toISOString()}&timeMax=${future.toISOString()}&singleEvents=true&orderBy=startTime&maxResults=50`,
      { headers: { 'Authorization': 'Bearer ' + tokens.access_token } }
    );

    if (!calRes.ok) {
      const err = await calRes.json();
      return res.status(calRes.status).json({ error: err.error?.message || '캘린더 조회 실패', connected: false });
    }

    const data = await calRes.json();
    const events = (data.items || []).map(e => ({
      id: e.id,
      title: e.summary || '(제목 없음)',
      date: (e.start?.date || e.start?.dateTime || '').slice(0, 10),
      time: e.start?.dateTime ? new Date(e.start.dateTime).toLocaleTimeString('ko-KR', { hour:'2-digit', minute:'2-digit', timeZone:'Asia/Seoul' }) : '종일',
      place: e.location || ''
    }));

    return res.status(200).json({ events, connected: true });
  } catch (e) {
    return res.status(500).json({ error: e.message, connected: false });
  }
}
