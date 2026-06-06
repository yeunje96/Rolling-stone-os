// 뉴스 API - 구글뉴스 RSS로 한국일보/NYT 실제 기사 수집, NYT는 Claude로 번역
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const source = req.query.source || 'mk';

  // 한국일보: 구글뉴스 RSS로 실제 기사 수집
  // NYT: 구글뉴스 RSS로 영문 기사 수집 후 Claude 번역
  // 매일경제: 자체 RSS
  const RSS_FEEDS = {
    mk:  { url: 'https://www.mk.co.kr/rss/30100041/', lang: 'ko', name: '매일경제' },
    kh:  { url: 'https://news.google.com/rss/search?q=site:hankookilbo.com&hl=ko&gl=KR&ceid=KR:ko', lang: 'ko', name: '한국일보' },
    nyt: { url: 'https://news.google.com/rss/search?q=site:nytimes.com&hl=en-US&gl=US&ceid=US:en', lang: 'en', name: '뉴욕타임즈' },
  };

  const feed = RSS_FEEDS[source];
  if (!feed) return res.status(400).json({ error: '지원하지 않는 소스' });

  try {
    const response = await fetch(feed.url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36' },
      signal: AbortSignal.timeout(10000)
    });

    if (!response.ok) throw new Error(`RSS 오류: ${response.status}`);
    const xml = await response.text();
    const items = [];
    const itemBlocks = xml.split(/<item[\s>]/i).slice(1);

    for (const block of itemBlocks) {
      const getCdata = (tag) => {
        const m = block.match(new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`, 'i'));
        return m ? m[1].replace(/<[^>]+>/g,'').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/\s+/g,' ').trim() : '';
      };

      let title = getCdata('title');
      let link = getCdata('link') || getCdata('guid');
      const pubDate = getCdata('pubDate');

      if (!title || title === feed.name) continue;

      // 구글뉴스는 " - 매체명" 형식이므로 정리
      if (source === 'kh') title = title.replace(/\s*-\s*한국일보\s*$/, '').trim();
      if (source === 'nyt') title = title.replace(/\s*-\s*The New York Times\s*$/, '').trim();

      if (!link || !link.startsWith('http')) continue;

      items.push({
        headline: title,
        displayTitle: title,
        url: link,
        published_at: pubDate ? new Date(pubDate).toISOString() : null,
        source,
        source_name: feed.name
      });
      if (items.length >= 10) break;
    }

    // NYT 영문 → Claude 번역
    if (source === 'nyt' && items.length && process.env.OPENAI_API_KEY) {
      try {
        const titles = items.map((it, i) => `${i+1}. ${it.headline}`).join('\n');
        const apiRes = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
          },
          body: JSON.stringify({
            model: 'gpt-4o',
            max_tokens: 1500,
            messages: [{
              role: 'user',
              content: `다음 뉴욕타임즈 기사 제목들을 자연스러운 한국어로 번역해줘. 번호와 번역문만 출력하고 다른 말은 하지 마.\n\n${titles}`
            }]
          })
        });

        if (apiRes.ok) {
          const data = await apiRes.json();
          const translated = (data.choices?.[0]?.message?.content || '').split('\n').filter(Boolean);
          translated.forEach(line => {
            const m = line.match(/^(\d+)[..)]\s*(.+)$/);
            if (m) {
              const idx = parseInt(m[1]) - 1;
              if (items[idx]) items[idx].displayTitle = m[2].trim();
            }
          });
        }
      } catch(e) { /* 번역 실패 시 원문 유지 */ }
    }

    return res.status(200).json({ items, source, source_name: feed.name, fetched_at: new Date().toISOString() });
  } catch (e) {
    return res.status(500).json({ error: e.message, source });
  }
}
