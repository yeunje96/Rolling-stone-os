RollingStone OpenAI Migration Package

수동 적용 대상:
- report.js
- briefing.js
- news.js
- learn.js
- coo-report.js

공통 변경:
1. anthropic.com -> api.openai.com/v1/responses
2. ANTHROPIC_API_KEY -> OPENAI_API_KEY
3. Supabase 하드코딩 제거
4. GOOGLE_CLIENT_SECRET 환경변수 추가
5. report.js config API 제거

이 패키지는 현재 대화에서 확인한 수정 사항 요약본입니다.
