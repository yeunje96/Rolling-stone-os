export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const type = req.query.type;
  const SB_URL = (process.env.SUPABASE_URL || 'https://lkcmgritsfjgvqsldqmc.supabase.co').replace(/\/rest\/v1\/?$/, '');
  const SB_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxrY21ncml0c2ZqZ3Zxc2xkcW1jIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg4NTA3MzcsImV4cCI6MjA5NDQyNjczN30.x8v1q8-nCaRRtEJT-9GBoYl34R_KL0wB-UVmBJx_D9Q';

  // /api/report?type=config
  if (type === 'config') {
    res.setHeader('Cache-Control', 'public, max-age=3600');
    return res.status(200).json({
      supabase_url: SB_URL,
      supabase_anon_key: SB_KEY,
      openai_api_key: process.env.OPENAI_API_KEY || ''
    });
  }

  // /api/report?type=usage — OpenAI + Claude 비용 실제 조회
  if (type === 'usage') {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const monthKey = `api_cost_${year}_${String(month+1).padStart(2,'0')}`;

    // 1. Claude 누적비용 (settings 테이블)
    let claudeKrw = 0;
    try {
      const r = await fetch(`${SB_URL}/rest/v1/settings?id=eq.${monthKey}&select=value`, {
        headers: { 'apikey': SB_KEY, 'Authorization': `Bearer ${SB_KEY}` }
      });
      const d = await r.json();
      claudeKrw = d?.[0]?.value ? Number(d[0].value) : 0;
    } catch(e) {}

    // 2. OpenAI Usage API — 신규 엔드포인트 (2024 이후)
    let openaiUsd = 0;
    const openaiKey = process.env.OPENAI_API_KEY;
    if (openaiKey) {
      try {
        // 이번달 1일 Unix timestamp
        const startTs = Math.floor(new Date(year, month, 1).getTime() / 1000);
        const endTs = Math.floor(now.getTime() / 1000);

        // 신 API: /v1/organization/usage/completions
        const newApiRes = await fetch(
          `https://api.openai.com/v1/organization/usage/completions?start_time=${startTs}&end_time=${endTs}&bucket_width=1d`,
          { headers: { 'Authorization': `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
            signal: AbortSignal.timeout(10000) }
        );

        if (newApiRes.ok) {
          const data = await newApiRes.json();
          // data.data 배열, 각 bucket에 input_tokens, output_tokens, cost 등
          for (const bucket of (data.data || [])) {
            for (const result of (bucket.results || [])) {
              // cost가 있으면 직접 사용 (단위: USD)
              if (result.cost != null) {
                openaiUsd += result.cost;
              } else if (result.input_tokens || result.output_tokens) {
                // gpt-4o 기준: input $2.5/M, output $10/M
                openaiUsd += (result.input_tokens || 0) * 0.0000025;
                openaiUsd += (result.output_tokens || 0) * 0.00001;
              }
            }
          }
        } else {
          // 구 API 폴백: /v1/usage?date=YYYYMMDD
          const days = Math.min(now.getDate(), 31);
          const dailyPromises = [];
          for (let d = 1; d <= days; d++) {
            const dateStr = `${year}${String(month+1).padStart(2,'0')}${String(d).padStart(2,'0')}`;
            dailyPromises.push(
              fetch(`https://api.openai.com/v1/usage?date=${dateStr}`,
                { headers: { 'Authorization': `Bearer ${openaiKey}` }, signal: AbortSignal.timeout(5000) })
              .then(r => r.ok ? r.json() : null).catch(() => null)
            );
          }
          const results = await Promise.all(dailyPromises);
          for (const day of results) {
            if (!day) continue;
            for (const item of (day.data || [])) {
              // total_usage 단위: 0.001 cents
              openaiUsd += (item.total_usage || 0) / 100000;
            }
          }
        }
      } catch(e) {}
    }

    // 3. 환율 조회
    let rate = 1380;
    try {
      const fx = await fetch('https://open.er-api.com/v6/latest/USD', { signal: AbortSignal.timeout(4000) });
      if (fx.ok) { const d = await fx.json(); rate = d?.rates?.KRW || 1380; }
    } catch(e) {}

    const openaiKrw = Math.round(openaiUsd * rate);
    const totalKrw = openaiKrw + claudeKrw;
    const totalUsd = openaiUsd + claudeKrw / rate;

    return res.status(200).json({
      openai_usd: Math.round(openaiUsd * 100) / 100,
      openai_krw: openaiKrw,
      claude_krw: claudeKrw,
      total_krw: totalKrw,
      total_usd: Math.round(totalUsd * 100) / 100,
      rate: Math.round(rate),
      month: `${year}년 ${month+1}월`,
      has_openai_key: !!openaiKey
    });
  }

  // /api/report (POST) — 주/월/분기 리포트 생성
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { period, tasks = [], outputs = [], projects = [], director } = req.body || {};
  const PERIOD_LABEL = {
    weekly:'주간', monthly:'월간', quarterly:'분기', half:'반기', yearly:'연간'
  };
  const label = PERIOD_LABEL[period] || '주간';
  const now2 = new Date();
  const dateStr = now2.toLocaleDateString('ko-KR', { year:'numeric', month:'long', day:'numeric' });

  const prompt = `당신은 Rolling Stone Design의 ${director || '이준혁 총괄이사'}입니다.
아래 데이터를 기반으로 ${label} 업무 보고서를 작성하세요.
기준일: ${dateStr}

[프로젝트 현황]
${projects.map(p=>`• ${p.name} [${p.status}]${p.description?' - '+p.description:''}`).join('\n') || '없음'}

[완료/진행 업무]
${tasks.map(t=>`• [${t.status}] ${t.title}${t.assigned_employee_name?' ('+t.assigned_employee_name+')':''}`).join('\n') || '없음'}

[산출물]
${outputs.map(o=>`• ${o.title}`).join('\n') || '없음'}

아래 JSON 형식으로만 반환:
{
  "title": "보고서 제목",
  "summary": "전체 요약 (3문장)",
  "achievements": ["주요 성과1", "주요 성과2"],
  "issues": ["이슈1"],
  "next_actions": ["다음 액션1", "다음 액션2"],
  "full_report": "전체 보고서 (마크다운)"
}`;

  try {
    const apiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        max_tokens: 1500,
        messages: [{ role: 'user', content: prompt }]
      })
    });
    if (!apiRes.ok) throw new Error('OpenAI API 오류: ' + await apiRes.text());
    const data = await apiRes.json();
    const raw = data.choices?.[0]?.message?.content || '{}';
    const match = raw.match(/\{[\s\S]*\}/);
    const parsed = match ? JSON.parse(match[0]) : { full_report: raw };
    return res.status(200).json({ ...parsed, period, generated_at: now2.toISOString() });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
