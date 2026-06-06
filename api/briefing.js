const SUPABASE_URL = 'https://lkcmgritsfjgvqsldqmc.supabase.co/rest/v1';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxrY21ncml0c2ZqZ3Zxc2xkcW1jIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg4NTA3MzcsImV4cCI6MjA5NDQyNjczN30.x8v1q8-nCaRRtEJT-9GBoYl34R_KL0wB-UVmBJx_D9Q';

async function sb(path) {
  const res = await fetch(SUPABASE_URL + path, {
    headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY }
  });
  return res.json();
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const {
    schedules = [], tasks = [], approvals = 0,
    weather = {}, news = [], projects = [],
    delayed = [], newTasks = [],
  } = req.body || {};

  const today = new Date().toLocaleDateString('ko-KR', {
    year: 'numeric', month: 'long', day: 'numeric', weekday: 'long',
    timeZone: 'Asia/Seoul'
  });

  const schedText = schedules.length
    ? schedules.map(s => `• ${s.time ? s.time + ' ' : ''}${s.title}${s.place ? ` (${s.place})` : ''}`).join('\n')
    : '• 오늘 일정 없음';
  const taskText = tasks.slice(0,5).map(t => `• [${t.status}] ${t.title} — ${t.assigned_employee_name||'미지정'}`).join('\n') || '• 없음';
  const newsText = news.slice(0,3).map(n => `• ${n.headline||n.displayTitle||''}`).join('\n') || '• 없음';
  const projText = projects.slice(0,4).map(p => `• ${p.name}[${p.status}]`).join('\n') || '• 없음';
  const delayedText = delayed.length ? delayed.map(t=>`• ${t.title}`).join('\n') : '없음';
  const jeonju = weather.jeonju || {};
  const seoul  = weather.seoul  || {};

  const prompt = `당신은 Rolling Stone Design 대표의 AI 비서 김서연입니다.
아래 실제 데이터를 분석해서 텔레그램 브리핑을 작성하세요.

[작성 원칙]
- 모든 내용은 아래 제공된 실제 데이터 기반으로만 작성
- 데이터가 없는 항목은 "없음"으로 표시 (지어내지 말 것)
- 뉴스 분석은 Rolling Stone Design 사업(프리랜서 디자인, SNS 마케팅, 부업, 이커머스)과 실제 연관성 있을 때만 언급
- 권장 행동은 오늘의 실제 업무/일정/이슈 기반으로 구체적으로 작성
- HTML 태그 사용 (<b>, 줄바꿈)

아래 형식 그대로 작성:

📅 <b>아침 브리핑</b> — ${today}

🌤 <b>전주</b> ${jeonju.temp??'—'}° ${jeonju.desc??'—'} · 미세먼지 ${jeonju.pm??'—'} · 습도 ${jeonju.humidity??'—'}% · 바람 ${jeonju.wind??'—'}
🌤 <b>서울</b> ${seoul.temp??'—'}° ${seoul.desc??'—'} · 미세먼지 ${seoul.pm??'—'} · 습도 ${seoul.humidity??'—'}% · 바람 ${seoul.wind??'—'}

🗓 <b>오늘 일정</b>
${schedText}

📊 <b>KPI 현황</b>
• 직원 담당 진행중 업무: ${tasks.length}건 (신규 ${newTasks.length}건 · 지연 ${delayed.length}건)
• 승인 대기: ${approvals}건
• 진행중 프로젝트: ${projects.filter(p=>p.status==='진행중').length}개
(업무 목록이 있으면 담당자별 한 줄씩 요약)

📰 <b>주요 뉴스</b>
(아래 실제 뉴스 3개를 그대로 표기하고, 사업과 연관성 있을 때만 한 줄 코멘트 추가)
${newsText}

⚠️ <b>승인 대기</b>
${approvals > 0 ? `${approvals}건 처리 필요` : '없음'}

🚨 <b>위험 요소</b>
(지연 업무나 리스크가 있으면 구체적으로, 없으면 "현재 특이사항 없음")

🎯 <b>오늘의 권장 행동</b>
(오늘 실제 일정·업무·이슈 기반으로 구체적인 액션 3가지)
1. 
2. 
3. 

💬 <b>오늘의 한마디</b>
(짧고 실질적인 한 문장)

---
실제 데이터:
[업무] ${taskText}
[프로젝트] ${projText}
[지연] ${delayedText}

JSON만 반환: {"telegram_message":"...","os_summary":"(3문장 핵심 요약)"}`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-opus-4-8',
        max_tokens: 2000,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!response.ok) throw new Error('Claude API 오류: ' + await response.text());

    const data = await response.json();
    const raw = data.content?.[0]?.text || '{}';
    let parsed = {};
    try {
      const match = raw.match(/\{[\s\S]*\}/);
      if (match) parsed = JSON.parse(match[0]);
    } catch(e) { parsed = { telegram_message: raw, os_summary: raw }; }

    return res.status(200).json({
      telegram_message: parsed.telegram_message || '',
      os_summary: parsed.os_summary || '',
      briefing: parsed.os_summary || ''
    });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
