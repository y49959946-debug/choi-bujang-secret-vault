// 5단계: 로그인·토큰 갱신·로그아웃을 서버 함수로 옮깁니다. 화면 코드에는 Supabase 키를 두지 않습니다.
//   POST /api/auth/login    {email, password}  → 200 {access_token, refresh_token, expires_at, user:{email}}
//   POST /api/auth/refresh  {refresh_token}    → 200 같은 모양
//   POST /api/auth/logout   Authorization: Bearer <access_token> → 204
// (/api/auth/:action은 vercel.json rewrites가 이 함수로 보냅니다.)
//
// 로그인은 공식 Supabase JS SDK(signInWithPassword·refreshSession)를 서버에서 부릅니다.
// 비밀번호·JWT는 서버가 직접 만들지 않고, 받은 비밀번호는 Supabase로만 보내며 저장·기록하지 않습니다.
// SUPABASE_URL, 공개용 SUPABASE_PUBLISHABLE_KEY, 서버 전용 SUPABASE_SECRET_KEY는 Vercel 환경변수에서만 읽고
// 키·토큰·비밀번호는 로그에 남기지 않습니다. 발급된 토큰은 로그인한 본인에게만 응답으로 돌려줍니다.
import { createClient } from '@supabase/supabase-js';

const NO_SESSION = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
const BEARER = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/u;

function fail(response, status, error, message) {
  return response.status(status).json({ error, message });
}

function readBody(request) {
  const raw = request.body;
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw;
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    } catch { return null; }
  }
  return null;
}

function actionFrom(request) {
  if (typeof request.query?.action === 'string') return request.query.action;
  return /^\/api\/auth\/([a-z]+)/u.exec(request.url ?? '')?.[1] ?? null;
}

function sessionBody(session) {
  return {
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_at: session.expires_at,
    user: { email: session.user?.email ?? null },
  };
}

// 로그인 실패 이유를 화면에 보여 줄 수 있게 짧은 코드와 한국어 문장으로 돌려줍니다.
function loginFailure(response, error) {
  const code = error?.code ?? '';
  const raw = error?.message ?? '';
  if (code === 'invalid_credentials' || /invalid login credentials/iu.test(raw)) {
    return fail(response, 401, 'INVALID_CREDENTIALS', '이메일 또는 비밀번호가 맞지 않습니다.');
  }
  if (code === 'email_not_confirmed' || /email not confirmed/iu.test(raw)) {
    return fail(response, 403, 'EMAIL_NOT_CONFIRMED', '이메일 인증이 끝나지 않은 계정입니다. Supabase에서 계정을 확인 처리해 주세요.');
  }
  if (error?.status === 429 || /rate limit/iu.test(raw)) {
    return fail(response, 429, 'TOO_MANY_ATTEMPTS', '시도가 너무 많습니다. 잠시 뒤 다시 시도해 주세요.');
  }
  console.error('auth: 로그인 실패', code || 'unknown');
  return fail(response, 502, 'LOGIN_FAILED', '로그인 서버에서 요청을 처리하지 못했습니다.');
}

export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store');

  const url = process.env.SUPABASE_URL;
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!url || !publishableKey || !secretKey) {
    console.error('auth: SUPABASE_URL·SUPABASE_PUBLISHABLE_KEY·SUPABASE_SECRET_KEY 환경변수 중 빠진 것이 있습니다.');
    return fail(response, 500, 'SERVER_NOT_CONFIGURED', '로그인 서버 설정이 끝나지 않았습니다.');
  }
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    return fail(response, 405, 'METHOD_NOT_ALLOWED', 'POST로 요청해 주세요.');
  }

  const action = actionFrom(request);
  const body = readBody(request) ?? {};

  try {
    if (action === 'login') {
      const email = typeof body.email === 'string' ? body.email.trim() : '';
      const password = typeof body.password === 'string' ? body.password : '';
      if (!email || !password || email.length > 320 || password.length > 1024) {
        return fail(response, 400, 'INVALID_INPUT', '이메일과 비밀번호를 입력해 주세요.');
      }
      const supabase = createClient(url, publishableKey, NO_SESSION);
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error || !data?.session) return loginFailure(response, error);
      return response.status(200).json(sessionBody(data.session));
    }

    if (action === 'refresh') {
      const refreshToken = typeof body.refresh_token === 'string' ? body.refresh_token : '';
      if (!refreshToken || refreshToken.length > 4096) {
        return fail(response, 400, 'INVALID_INPUT', '다시 로그인해 주세요.');
      }
      const supabase = createClient(url, publishableKey, NO_SESSION);
      const { data, error } = await supabase.auth.refreshSession({ refresh_token: refreshToken });
      if (error || !data?.session) {
        return fail(response, 401, 'SESSION_EXPIRED', '로그인이 만료되었습니다. 다시 로그인해 주세요.');
      }
      return response.status(200).json(sessionBody(data.session));
    }

    if (action === 'logout') {
      const match = BEARER.exec(request.headers?.authorization ?? '');
      if (match) {
        // 이 로그인 세션의 갱신 토큰을 Supabase에서 무효화합니다(관리 API, 서버 전용 키).
        const admin = createClient(url, secretKey, NO_SESSION);
        const { error } = await admin.auth.admin.signOut(match[1], 'local');
        if (error) console.error('auth: 로그아웃 처리 실패', error.code ?? error.status ?? 'unknown');
      }
      // 토큰이 없거나 이미 만료됐어도 화면에서는 로그아웃 상태가 되도록 204를 돌려줍니다.
      return response.status(204).end();
    }

    return fail(response, 404, 'NOT_FOUND', '없는 경로입니다.');
  } catch {
    console.error('auth: 서버 오류');
    return fail(response, 500, 'AUTH_SERVER_ERROR', '로그인 서버에서 오류가 났습니다.');
  }
}
