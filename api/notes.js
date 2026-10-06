// 2단계: 가상 메모를 Supabase에서 서버 쪽으로만 읽어 화면에 넘깁니다.
// SUPABASE_URL과 서버 전용 SUPABASE_SECRET_KEY는 Vercel 환경변수에서만 읽습니다.
// 키는 응답·로그·브라우저 파일에 절대 넣지 않습니다.
// 약점(3단계에서 막을 것): 이 함수는 아직 로그인 확인 없이 누구나 부를 수 있습니다.
import { createClient } from '@supabase/supabase-js';

const SAMPLE_MARKER = 'SAMPLE_NOTE_1';

export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store');

  if (request.method && request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    return response.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
  }

  const url = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secretKey) {
    console.error('notes: SUPABASE_URL 또는 SUPABASE_SECRET_KEY 환경변수가 없습니다.');
    return response.status(500).json({ error: 'SERVER_NOT_CONFIGURED' });
  }

  try {
    const supabase = createClient(url, secretKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const { data, error } = await supabase
      .from('notes')
      .select('title, content')
      .eq('sample_marker', SAMPLE_MARKER)
      .order('id', { ascending: true });

    if (error) {
      // 오류 코드만 남기고 키·요청 내용은 기록하지 않습니다.
      console.error('notes: 조회 실패', error.code ?? 'unknown');
      return response.status(502).json({ error: 'NOTES_READ_FAILED' });
    }

    return response.status(200).json({
      sampleMarker: SAMPLE_MARKER,
      notes: (data ?? []).map(({ title, content }) => ({ title, content })),
    });
  } catch {
    console.error('notes: 서버 오류');
    return response.status(500).json({ error: 'NOTES_SERVER_ERROR' });
  }
}
