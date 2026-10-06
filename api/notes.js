// 3단계: 자료 API가 요청자의 로그인 토큰을 서버에서 직접 확인합니다.
// 토큰 검사는 시작 틀의 src/verify-login.mjs(createLoginVerifier)만 씁니다.
// 브라우저가 보낸 userId·role 같은 값은 읽지도 믿지도 않습니다.
// SUPABASE_URL과 서버 전용 SUPABASE_SECRET_KEY는 Vercel 환경변수에서만 읽고,
// 키·토큰은 응답·로그·브라우저 파일에 넣지 않습니다.
// 남은 약점(4단계에서 막을 것): 로그인한 사람은 owner_id와 상관없이 가상 메모 전체를 봅니다.
import { createClient } from '@supabase/supabase-js';
import config from '../aleph.config.json' with { type: 'json' };
import { createLoginVerifier } from '../src/verify-login.mjs';

const SAMPLE_MARKER = 'SAMPLE_NOTE_1';

let verifyLogin = null;
function loginVerifier() {
  // 함수 인스턴스마다 한 번만 만듭니다. 설정이나 키가 잘못되면 예외가 납니다.
  verifyLogin ??= createLoginVerifier({ config, supabaseSecretKey: process.env.SUPABASE_SECRET_KEY });
  return verifyLogin;
}

export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Vary', 'Authorization');

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

  let verify;
  try {
    verify = loginVerifier();
  } catch (error) {
    // 오류 이름만 남깁니다(예: invalid_student_identity_provider). 키는 남기지 않습니다.
    console.error('notes: 로그인 검사기 설정 오류', error?.message ?? 'unknown');
    return response.status(500).json({ error: 'LOGIN_VERIFIER_NOT_CONFIGURED' });
  }

  // 신원은 Authorization: Bearer 토큰 검사 결과로만 정합니다.
  let identity = null;
  try {
    identity = await verify(request.headers?.authorization);
  } catch {
    identity = null;
  }
  if (!identity) {
    response.setHeader('WWW-Authenticate', 'Bearer');
    return response.status(401).json({ error: 'LOGIN_REQUIRED' });
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
      console.error('notes: 조회 실패', error.code ?? 'unknown');
      return response.status(502).json({ error: 'NOTES_READ_FAILED' });
    }

    return response.status(200).json({
      notes: (data ?? []).map(({ title, content }) => ({ title, content })),
    });
  } catch {
    console.error('notes: 서버 오류');
    return response.status(500).json({ error: 'NOTES_SERVER_ERROR' });
  }
}
