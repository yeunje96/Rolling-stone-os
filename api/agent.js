const SUPABASE_URL = 'https://lkcmgritsfjgvqsldqmc.supabase.co/rest/v1';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxrY21ncml0c2ZqZ3Zxc2xkcW1jIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg4NTA3MzcsImV4cCI6MjA5NDQyNjczN30.x8v1q8-nCaRRtEJT-9GBoYl34R_KL0wB-UVmBJx_D9Q';

async function sb(path, opts = {}) {
  const res = await fetch(SUPABASE_URL + path, {
    ...opts,
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': 'Bearer ' + SUPABASE_KEY,
      'Content-Type': 'application/json',
      'Prefer': opts.method === 'POST' ? 'return=representation' : '',
      ...(opts.headers || {})
    }
  });
  if (!res.ok) throw new Error(await res.text());
  const text = await res.text();
  return text ? JSON.parse(text) : [];
}

const COMMON_RULES = `[공통 행동 지침]
- 대표님께 깍듯이 (높임말 필수)
- 결론 먼저, 두괄식으로
- 거짓말 금지, 모르면 솔직히
- 출처/링크 필수
- 저작권 등 문제 소지 선제 고지
- 맞춤법·문법 철저
- 10년 이상 베테랑 전문가처럼
- 효율·정확성·논리성 중시
- 산출물은 여러 번 검수 후 최종본만

[응답 형식 — 반드시 아래 JSON만 반환]
{
  "reply": "대표님께 드리는 답변 (자연스럽고 명확하게)",
  "actions": []
}

actions 없으면 반드시 빈 배열 [].
JSON 외 다른 텍스트 절대 금지.`;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { employee, message } = req.body || {};
  if (!employee || !message) {
    return res.status(400).json({ error: 'employee, message 필드가 필요합니다' });
  }

  try {
    // 1. 대화 히스토리 조회 (sops 테이블, agent_conversations는 RLS 막힘)
    let history = [];
    try {
      const rows = await sb(`/sops?department=eq._chat&title=eq.chat_${employee.id}&order=created_at.desc&limit=20`);
      // content에 JSON 형태로 {role, content} 저장됨
      history = rows.reverse().map(r => {
        try { return JSON.parse(r.content); } catch(e) { return null; }
      }).filter(Boolean);
    } catch(e) {}

    // 2. 프로젝트 현황 조회
    let projects = [];
    try {
      projects = await sb('/projects?select=name,status,description&order=updated_at.desc&limit=8');
    } catch(e) {}

    // 3. 내 담당 업무 조회
    let tasks = [];
    try {
      tasks = await sb(`/tasks?select=title,status,content&assigned_employee_id=eq.${employee.id}&status=neq.완료&limit=5`);
    } catch(e) {}

    // 4. 관련 SOP 조회 (실제 업무 SOP만, 시스템/메모리 제외)
    let sops = [];
    try {
      sops = await sb('/sops?select=title,content&department=neq._memory&department=neq._chat&department=neq._system&limit=10');
    } catch(e) {}

    // 5. 장기 기억 조회 (sops 테이블의 _memory)
    let memories = [];
    try {
      const memRows = await sb(`/sops?department=eq._memory&title=eq.mem_${employee.id}&order=created_at.desc&limit=8`);
      memories = memRows.map(m => ({ content: m.content }));
    } catch(e) {}

    // 6. 회사 헌법 + 공통 규칙 조회 (sops _system)
    let companyConstitution = '';
    let commonRules = '';
    try {
      const sysRows = await sb('/sops?department=eq._system&select=title,content');
      const constitution = sysRows.find(r => r.title === 'company_constitution');
      const rules = sysRows.find(r => r.title === 'common_rules');
      if (constitution?.content) companyConstitution = constitution.content;
      if (rules?.content) commonRules = rules.content;
    } catch(e) {}

    // 시스템 프롬프트 구성
    const empPrompt = (employee.prompt || '').trim() ||
      `당신은 Rolling Stone Design의 ${employee.name}(${employee.position || '직원'}, ${employee.department || '팀'})입니다.`;

    const contextBlock = [
      companyConstitution ? `[회사 헌법]\n${companyConstitution}` : '',
      commonRules ? `[공통 규칙]\n${commonRules}` : '',
      projects.length ? `[진행 프로젝트]\n${projects.map(p=>`• ${p.name}[${p.status}]${p.description?' - '+p.description.slice(0,50):''}`).join('\n')}` : '',
      tasks.length ? `[내 담당 업무]\n${tasks.map(t=>`• [${t.status}] ${t.title}`).join('\n')}` : '',
      sops.length ? `[SOP]\n${sops.map(s=>`• ${s.title}: ${(s.content||'').slice(0,60)}`).join('\n')}` : '',
      memories.length ? `[장기 기억]\n${memories.map(m=>`• ${m.content}`).join('\n')}` : '',
    ].filter(Boolean).join('\n\n');

    const systemPrompt = `${empPrompt}\n\n${COMMON_RULES}${contextBlock ? '\n\n' + contextBlock : ''}`;

    // 대화 메시지 구성 (히스토리 포함)
    const messages = [
      ...history.slice(-16).map(c => ({ role: c.role, content: c.content })),
      { role: 'user', content: message }
    ];

    // OpenAI GPT-4o 호출
    const apiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        max_tokens: 800,
        messages: [
          { role: 'system', content: systemPrompt },
          ...messages
        ]
      })
    });

    if (!apiRes.ok) {
      const errText = await apiRes.text();
      throw new Error('OpenAI API 오류: ' + errText);
    }

    const apiData = await apiRes.json();
    const rawText = apiData.choices?.[0]?.message?.content?.trim() || '{}';

    // JSON 파싱
    let parsed = { reply: rawText, actions: [] };
    try {
      const match = rawText.match(/\{[\s\S]*\}/);
      if (match) {
        const p = JSON.parse(match[0]);
        if (p.reply) parsed = p;
      }
    } catch(e) {}

    const reply = parsed.reply || rawText;
    const actions = Array.isArray(parsed.actions) ? parsed.actions : [];

    // 대화 히스토리 저장 (sops 테이블, agent_conversations RLS 막힘)
    try {
      await sb('/sops', {
        method: 'POST',
        headers: { 'Prefer': 'return=minimal' },
        body: JSON.stringify([
          { department: '_chat', title: `chat_${employee.id}`, content: JSON.stringify({ role: 'user', content: message }), status: 'active' },
          { department: '_chat', title: `chat_${employee.id}`, content: JSON.stringify({ role: 'assistant', content: reply }), status: 'active' }
        ])
      });
    } catch(e) {}

    // 액션 처리
    for (const action of actions) {
      try {
        if (action.type === 'memory_save') {
          await sb('/sops', {
            method: 'POST',
            headers: { 'Prefer': 'return=minimal' },
            body: JSON.stringify([{
              department: '_memory',
              title: `mem_${employee.id}`,
              content: `[패턴] ${action.content}`,
              project: employee.name,
              status: 'active'
            }])
          });
        } else if (action.type === 'task_create') {
          await sb('/tasks', {
            method: 'POST',
            body: JSON.stringify([{
              title: action.title,
              content: action.content,
              assigned_employee_id: employee.id,
              assigned_employee_name: employee.name,
              status: '대기'
            }])
          });
        } else if (['sop_propose', 'prompt_update'].includes(action.type)) {
          await sb('/approvals', {
            method: 'POST',
            body: JSON.stringify([{
              title: `[${employee.name}] ${action.title}`,
              content: action.content,
              requester: employee.name,
              status: '승인대기',
              level: '일반',
              type: action.type
            }])
          });
        }
      } catch(e) {}
    }

    // 토큰 비용
    const inputTokens = apiData.usage?.prompt_tokens || 0;
    const outputTokens = apiData.usage?.completion_tokens || 0;
    const totalTokens = inputTokens + outputTokens;
    const costKrw = Math.round((inputTokens * 0.000015 + outputTokens * 0.000075) * 1380);

    // API 비용 누적 저장 (settings 테이블 - value는 integer)
    try {
      const now = new Date();
      const monthKey = `api_cost_${now.getFullYear()}_${String(now.getMonth()+1).padStart(2,'0')}`;
      const existing = await sb(`/settings?id=eq.${monthKey}&select=value`);
      const prev = existing?.[0] ? Number(existing[0].value || 0) : 0;
      await sb('/settings', {
        method: 'POST',
        headers: { 'Prefer': 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify({ id: monthKey, value: prev + costKrw })
      });
    } catch(e) {}

    // 프로젝트별 토큰 누적
    try {
      if (totalTokens > 0) {
        let targetProject = null;

        // 1순위: 직원 담당 프로젝트
        const empProjNames = (employee.projects||'').split(/[,·]/).map(p=>p.trim()).filter(Boolean);
        if (empProjNames.length) {
          const rows = await sb(`/projects?select=id,name,token_usage&name=in.(${empProjNames.map(p=>`"${p}"`).join(',')})&limit=1`).catch(()=>[]);
          targetProject = rows?.[0];
        }

        // 2순위: 가장 최근 진행중 프로젝트
        if (!targetProject) {
          const rows = await sb('/projects?select=id,name,token_usage&status=eq.진행중&order=updated_at.desc&limit=1').catch(()=>[]);
          targetProject = rows?.[0];
        }

        if (targetProject) {
          const prev = parseInt(String(targetProject.token_usage||'0').replace(/[^0-9]/g,''))||0;
          await sb(`/projects?id=eq.${targetProject.id}`, {
            method: 'PATCH',
            body: JSON.stringify({ token_usage: String(prev + totalTokens) })
          });
        }
      }
    } catch(e) {}

    return res.status(200).json({
      reply,
      actions,
      employee_name: employee.name,
      tokens: { input: inputTokens, output: outputTokens, cost_krw: costKrw }
    });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
// note: token tracking added inline above
