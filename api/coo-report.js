// 총괄이사 이준혁 — 텔레그램 업무 보고 API
const SUPABASE_URL = 'https://lkcmgritsfjgvqsldqmc.supabase.co/rest/v1';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxrY21ncml0c2ZqZ3Zxc2xkcW1jIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg4NTA3MzcsImV4cCI6MjA5NDQyNjczN30.x8v1q8-nCaRRtEJT-9GBoYl34R_KL0wB-UVmBJx_D9Q';

async function sb(path) {
  const res = await fetch(SUPABASE_URL + path, {
    headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY }
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function sendTelegram(message) {
  const res = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: process.env.TELEGRAM_CHAT_ID,
      text: message,
      parse_mode: 'HTML'
    })
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.description);
  return data;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { type = 'daily' } = req.body || {};
  // type: 'daily'(일일), 'weekly'(주간), 'risk'(리스크)

  try {
    // 데이터 수집
    const [tasks, projects, approvals, employees] = await Promise.all([
      sb('/tasks?select=*&status=neq.완료&order=created_at.desc&limit=20'),
      sb('/projects?select=*&order=updated_at.desc&limit=10'),
      sb('/approvals?select=*&status=eq.승인대기&limit=10'),
      sb('/employees?select=name,department,position,status&is_active=eq.true')
    ]);

    const delayed = tasks.filter(t => (Date.now() - new Date(t.created_at)) > 7*86400000);
    const riskProjects = projects.filter(p => p.status === '보류' || p.status === '중단');
    const today = new Date().toLocaleDateString('ko-KR', {
      year:'numeric', month:'long', day:'numeric', weekday:'long', timeZone:'Asia/Seoul'
    });

    const prompt = `당신은 Rolling Stone Design의 총괄이사 이준혁입니다.
아래 데이터를 분석해서 대표님께 보낼 텔레그램 보고서를 작성하세요.
보고 유형: ${type === 'weekly' ? '주간 보고' : type === 'risk' ? '리스크 알림' : '일일 보고'}

[작성 규칙]
- 결론 먼저, 두괄식
- 수치 기반 명확하게
- 리스크는 솔직하게
- HTML 태그 사용 (<b>, <i>)
- 간결하게 (300자 이내)

[데이터]
날짜: ${today}
진행중 업무: ${tasks.length}건 (지연 ${delayed.length}건)
승인대기: ${approvals.length}건
프로젝트: ${projects.length}개 (위험 ${riskProjects.length}개)
직원 ${employees.length}명

업무 목록 (상위 5개):
${tasks.slice(0,5).map(t=>`• [${t.status}] ${t.title} - ${t.assigned_employee_name||'미지정'}`).join('\n')}

위험 프로젝트:
${riskProjects.length ? riskProjects.map(p=>`• ${p.name}[${p.status}]`).join('\n') : '없음'}

지연 업무:
${delayed.length ? delayed.slice(0,3).map(t=>`• ${t.title}`).join('\n') : '없음'}

승인 대기:
${approvals.length ? approvals.slice(0,3).map(a=>`• ${a.title}`).join('\n') : '없음'}

JSON만 반환: {"message": "텔레그램 메시지 내용"}`;

    const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-opus-4-8',
        max_tokens: 600,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!apiRes.ok) throw new Error('Claude API 오류: ' + await apiRes.text());
    const apiData = await apiRes.json();
    const raw = apiData.content?.[0]?.text || '{}';

    let message = '';
    try {
      const match = raw.match(/\{[\s\S]*\}/);
      if (match) message = JSON.parse(match[0]).message || raw;
      else message = raw;
    } catch(e) { message = raw; }

    // 텔레그램 발송
    await sendTelegram(message);

    return res.status(200).json({ ok: true, message });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
