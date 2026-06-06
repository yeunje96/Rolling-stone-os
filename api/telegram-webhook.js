// 텔레그램 Webhook — 김서연(비서) / 이준혁(총괄이사) 양방향 대화
const SUPABASE_URL = 'https://lkcmgritsfjgvqsldqmc.supabase.co/rest/v1';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxrY21ncml0c2ZqZ3Zxc2xkcW1jIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg4NTA3MzcsImV4cCI6MjA5NDQyNjczN30.x8v1q8-nCaRRtEJT-9GBoYl34R_KL0wB-UVmBJx_D9Q';

const BOT_IDS = {
  seoyeon: 'e6ed7944-f471-4bbf-bd06-ecd3717f9ecd', // 김서연
  junhyuk: 'c89622e1-2c5f-4c6d-8f61-61a8cf938307', // 이준혁
};

async function sb(path, opts = {}) {
  const res = await fetch(SUPABASE_URL + path, {
    ...opts,
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': 'Bearer ' + SUPABASE_KEY,
      'Content-Type': 'application/json',
      ...(opts.headers || {})
    }
  });
  const text = await res.text();
  return text ? JSON.parse(text) : [];
}

async function sendTelegram(chatId, text) {
  await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' })
  });
}

// 대화 상태 관리 (어떤 봇과 대화 중인지)
// Supabase settings 테이블에 저장
async function getActiveBotKey(chatId) {
  try {
    const rows = await sb(`/settings?key=eq.tg_active_bot_${chatId}&select=value`);
    return rows?.[0]?.value || 'seoyeon'; // 기본값: 김서연
  } catch(e) { return 'seoyeon'; }
}

async function setActiveBotKey(chatId, botKey) {
  try {
    await sb('/settings', {
      method: 'POST',
      headers: { 'Prefer': 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ key: `tg_active_bot_${chatId}`, value: botKey })
    });
  } catch(e) {}
}

async function getEmpPrompt(botKey) {
  try {
    const empId = BOT_IDS[botKey];
    const rows = await sb(`/employees?id=eq.${empId}&select=prompt,name`);
    return { prompt: rows?.[0]?.prompt || '', name: rows?.[0]?.name || '' };
  } catch(e) { return { prompt: '', name: '' }; }
}

async function getConvHistory(empId) {
  try {
    const rows = await sb(`/sops?department=eq._chat&title=eq.chat_${empId}&order=created_at.desc&limit=16`);
    return rows.reverse().map(r => { try { return JSON.parse(r.content); } catch(e) { return null; } }).filter(Boolean);
  } catch(e) { return []; }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Telegram Webhook POST
  if (req.method === 'POST') {
    const body = req.body;
    const message = body?.message;
    if (!message) return res.status(200).json({ ok: true });

    const chatId = message.chat?.id;
    const text = message.text?.trim() || '';

    if (!chatId || !text) return res.status(200).json({ ok: true });

    // 명령어 처리
    if (text === '/start' || text === '시작') {
      await sendTelegram(chatId,
        '안녕하세요, 대표님! 👋\n\n현재 <b>김서연 비서실장</b>과 대화 중입니다.\n\n명령어:\n/서연 — 김서연 비서실장\n/준혁 — 이준혁 총괄이사\n/상태 — 현재 대화 상대 확인');
      return res.status(200).json({ ok: true });
    }

    // /서연 또는 /준혁 뒤에 메시지가 붙어도 인식
    const isSeoyeon = text === '/서연' || text === '/seoyeon' || text.startsWith('/서연 ') || text.startsWith('/seoyeon ');
    const isJunhyuk = text === '/준혁' || text === '/junhyuk' || text.startsWith('/준혁 ') || text.startsWith('/junhyuk ');

    if (isSeoyeon) {
      await setActiveBotKey(chatId, 'seoyeon');
      const followUpMsg = text.replace(/^\/서연\s*|^\/seoyeon\s*/,'').trim();
      if (!followUpMsg) {
        await sendTelegram(chatId, '✅ 김서연 비서실장에게 연결됐습니다.\n무엇을 도와드릴까요, 대표님?');
        return res.status(200).json({ ok: true });
      }
      // 명령어 뒤 메시지가 있으면 바로 처리
      text.replace = text.replace; // 아래에서 followUpMsg로 처리
    }

    if (isJunhyuk) {
      await setActiveBotKey(chatId, 'junhyuk');
      const followUpMsg = text.replace(/^\/준혁\s*|^\/junhyuk\s*/,'').trim();
      if (!followUpMsg) {
        await sendTelegram(chatId, '✅ 이준혁 총괄이사에게 연결됐습니다.\n업무 지시나 현황 확인 말씀해 주십시오, 대표님.');
        return res.status(200).json({ ok: true });
      }
      // 명령어 뒤 메시지가 있으면 바로 처리 (아래 로직에서 처리)
    }

    if (text === '/상태') {
      const botKey = await getActiveBotKey(chatId);
      const names = { seoyeon: '김서연 비서실장', junhyuk: '이준혁 총괄이사' };
      await sendTelegram(chatId, `현재 대화 상대: <b>${names[botKey] || botKey}</b>`);
      return res.status(200).json({ ok: true });
    }

    // 실제 처리할 메시지 (명령어 prefix 제거)
    const actualMessage = isSeoyeon
      ? text.replace(/^\/서연\s*|^\/seoyeon\s*/,'').trim() || text
      : isJunhyuk
      ? text.replace(/^\/준혁\s*|^\/junhyuk\s*/,'').trim() || text
      : text;

    // 현재 활성 봇 확인
    const botKey = await getActiveBotKey(chatId);
    const empId = BOT_IDS[botKey];
    const { prompt: empPrompt, name: empName } = await getEmpPrompt(botKey);

    // actualMessage가 비어있으면 처리 불필요
    if (!actualMessage) return res.status(200).json({ ok: true });

    // 컨텍스트 수집
    let tasks = [], projects = [], approvals = [], memories = [];
    try { tasks = await sb('/tasks?select=title,status,assigned_employee_name&status=neq.완료&limit=10'); } catch(e) {}
    try { projects = await sb('/projects?select=name,status&limit=8'); } catch(e) {}
    try { approvals = await sb('/approvals?select=title,status&status=eq.승인대기&limit=5'); } catch(e) {}
    try { memories = await sb(`/sops?department=eq._memory&title=eq.mem_${empId}&select=content&limit=8`); } catch(e) {}

    const ctx = [
      tasks.length ? `[진행중 업무]\n${tasks.map(t=>`• [${t.status}] ${t.title} (${t.assigned_employee_name||'미지정'})`).join('\n')}` : '',
      projects.length ? `[프로젝트]\n${projects.map(p=>`• ${p.name}[${p.status}]`).join('\n')}` : '',
      approvals.length ? `[승인대기]\n${approvals.map(a=>`• ${a.title}`).join('\n')}` : '',
      memories.length ? `[학습된 자료]\n${memories.map(m=>`• ${m.content}`).join('\n')}` : '',
    ].filter(Boolean).join('\n\n');

    const systemPrompt = `${empPrompt || `당신은 Rolling Stone Design의 ${empName}입니다.`}

[공통 지침]
대표님께 깍듯이. 결론 먼저. 짧고 명확하게. 거짓말 금지. 맞춤법 철저.
텔레그램 특성상 응답은 300자 이내로 간결하게.

${ctx}`;

    // 대화 히스토리
    const history = await getConvHistory(empId);

    try {
      const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-opus-4-8',
          max_tokens: 500,
          system: systemPrompt,
          messages: [
            ...history.slice(-12).map(c => ({ role: c.role, content: c.content })),
            { role: 'user', content: actualMessage }
          ]
        })
      });

      if (!apiRes.ok) throw new Error('Claude API 오류: ' + await apiRes.text());
      const apiData = await apiRes.json();
      const reply = apiData.content?.[0]?.text?.trim() || '처리 중 오류가 발생했습니다.';

      // 텔레그램 발송
      await sendTelegram(chatId, reply);

      // 대화 히스토리 저장
      await sb('/sops', {
        method: 'POST',
        headers: { 'Prefer': 'return=minimal' },
        body: JSON.stringify([
          { department: '_chat', title: `chat_${empId}`, content: JSON.stringify({ role: 'user', content: actualMessage }), status: 'active' },
          { department: '_chat', title: `chat_${empId}`, content: JSON.stringify({ role: 'assistant', content: reply }), status: 'active' }
        ])
      });

    } catch(e) {
      await sendTelegram(chatId, `[오류] ${e.message}`);
    }

    return res.status(200).json({ ok: true });
  }

  // GET — Webhook 등록 확인용
  if (req.method === 'GET') {
    return res.status(200).json({ status: 'Telegram Webhook Active', bots: ['seoyeon', 'junhyuk'] });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
