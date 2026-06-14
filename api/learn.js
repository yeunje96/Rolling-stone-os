// 직원 파일 학습 API — 브라우저에서 직접 Anthropic 호출 시 CORS 차단되므로 서버 프록시
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { emp_name, file_type, file_data, note, media_type } = req.body || {};
  if (!emp_name || !file_data) return res.status(400).json({ error: 'emp_name, file_data 필요' });

  try {
    let messages;

    if (file_type === 'image') {
      messages = [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: media_type || 'image/jpeg',
              data: file_data
            }
          },
          {
            type: 'text',
            text: `이 이미지를 분석해서 ${emp_name}이(가) 업무에 활용할 수 있는 핵심 정보를 추출해줘.${note ? ' 참고: ' + note : ''}\n\nJSON만 반환 (최대 8개):\n{"memories":[{"category":"분류명","content":"핵심 내용 2~3문장"},...]}`
          }
        ]
      }];
    } else {
      const truncated = file_data.slice(0, 60000);
      messages = [{
        role: 'user',
        content: `다음 문서를 분석해서 ${emp_name}이(가) 업무에 활용할 수 있는 핵심 정보를 추출해줘.${note ? ' 참고: ' + note : ''}\n\n[문서 내용]\n${truncated}${file_data.length > 60000 ? '\n\n(이하 생략)' : ''}\n\nJSON만 반환 (최대 10개):\n{"memories":[{"category":"분류명","content":"핵심 내용 2~3문장"},...]}`
      }];
    }

    const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-opus-4-8',
        max_tokens: 2000,
        messages
      })
    });

    if (!apiRes.ok) throw new Error('Claude API 오류: ' + await apiRes.text());
    const data = await apiRes.json();
    const raw = data.content?.[0]?.text || '{}';
    const match = raw.match(/\{[\s\S]*\}/);
    const parsed = match ? JSON.parse(match[0]) : { memories: [] };

    return res.status(200).json({ memories: parsed.memories || [] });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
