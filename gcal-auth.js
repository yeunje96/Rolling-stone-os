export default async function handler(req, res) {
  // 환경변수에 여러 줄이 합쳐진 경우 첫 번째 줄(실제 Client ID)만 사용
  const rawClientId = process.env.GOOGLE_CLIENT_ID || '';
  const clientId = rawClientId.split('\n')[0].split('\r')[0].trim();

  const rawSecret = process.env.GOOGLE_CLIENT_SECRET || '';
  const clientSecret = rawSecret.split('\n')[0].split('\r')[0].trim();

  if (!clientId) {
    return res.status(500).json({ error: 'GOOGLE_CLIENT_ID 환경변수가 설정되지 않았습니다.' });
  }
  if (!clientSecret) {
    return res.status(500).json({ error: 'GOOGLE_CLIENT_SECRET 환경변수가 설정되지 않았습니다.' });
  }

  const redirectUri = 'https://rollingstone-ai.vercel.app/api/gcal-callback';
  const scope = 'https://www.googleapis.com/auth/calendar.readonly';

  const url = 'https://accounts.google.com/o/oauth2/v2/auth?' +
    'client_id=' + encodeURIComponent(clientId) +
    '&redirect_uri=' + encodeURIComponent(redirectUri) +
    '&response_type=code' +
    '&scope=' + encodeURIComponent(scope) +
    '&access_type=offline' +
    '&prompt=consent';

  res.redirect(302, url);
}
