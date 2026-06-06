export default async function handler(req, res) {
  const clientId = process.env.GOOGLE_CLIENT_ID;

  if (!clientId) {
    return res.status(500).json({
      error: 'GOOGLE_CLIENT_ID 환경변수가 설정되지 않았습니다. Vercel Settings → Environment Variables에서 설정하세요.'
    });
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
