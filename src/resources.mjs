// 8단계: 자료실 자원을 구역으로 나누고, 요청마다 서버가 구별할 수 있는 자원 ID를 붙입니다.
// 이 모듈은 파일·네트워크를 쓰지 않는 순수 함수만 둡니다. 서버 함수와 판정기가 같은 규칙을 씁니다.
//
//   구역(zone)         자원 ID                 경로 모양
//   owner_notes       notes / note:<id>        /api/notes, /api/notes/:id  (판정 요청에서는 /notes, /notes/:id)
//   class_notices     notices / notice:<id>    /api/notices, /api/notices/:id (판정 요청에서는 /notices, /notices/:id)
//   instructor_materials  materials / material:<id>  /api/materials, /api/materials/:id (판정 요청에서는 /materials, /materials/:id)
//
// - owner_notes: 학생 자신의 메모. 기존 주소·응답 모양을 그대로 씁니다.
// - class_notices: 반(강사) 공지. 학생은 읽기만 합니다. 아직 데이터와 API는 없고, 자원 ID와 경로 모양만 먼저 정합니다.
// - instructor_materials: 강사 자료. 학생은 읽기만 합니다. 공지와 같은 방식으로 자원 ID와 경로 모양만 정합니다.
// - 이 표에 없는 경로는 null을 돌려줍니다(알 수 없는 자원). 쓰는 쪽은 null을 거부로 다룹니다.
// - 자원 ID는 경로에서만 만듭니다. 브라우저가 보낸 본문·헤더·쿼리의 값으로 자원을 정하지 않습니다.

export const ZONES = Object.freeze({
  OWNER_NOTES: 'owner_notes',
  CLASS_NOTICES: 'class_notices',
  INSTRUCTOR_MATERIALS: 'instructor_materials',
});

const COLLECTIONS = Object.freeze({
  notes: Object.freeze({ zone: ZONES.OWNER_NOTES, collectionId: 'notes', itemPrefix: 'note' }),
  notices: Object.freeze({ zone: ZONES.CLASS_NOTICES, collectionId: 'notices', itemPrefix: 'notice' }),
  materials: Object.freeze({ zone: ZONES.INSTRUCTOR_MATERIALS, collectionId: 'materials', itemPrefix: 'material' }),
});

// 자원 하나의 id 모양: 영문·숫자·_·- 1~64자. (메모 API는 여기에 더해 UUID인지 따로 검사합니다.)
const ITEM_ID = /^[A-Za-z0-9_-]{1,64}$/u;

// 판정 요청의 route 모양과 구역. aleph.config.json의 allowedRoutes(/api/…)와 짝을 이룹니다.
export const RESOURCE_ROUTES = Object.freeze([
  Object.freeze({ route: 'GET /notes', zone: ZONES.OWNER_NOTES }),
  Object.freeze({ route: 'POST /notes', zone: ZONES.OWNER_NOTES }),
  Object.freeze({ route: 'GET /notes/:id', zone: ZONES.OWNER_NOTES }),
  Object.freeze({ route: 'PUT /notes/:id', zone: ZONES.OWNER_NOTES }),
  Object.freeze({ route: 'DELETE /notes/:id', zone: ZONES.OWNER_NOTES }),
  Object.freeze({ route: 'GET /notices', zone: ZONES.CLASS_NOTICES }),
  Object.freeze({ route: 'GET /notices/:id', zone: ZONES.CLASS_NOTICES }),
  Object.freeze({ route: 'GET /materials', zone: ZONES.INSTRUCTOR_MATERIALS }),
  Object.freeze({ route: 'GET /materials/:id', zone: ZONES.INSTRUCTOR_MATERIALS }),
]);

// 경로 → { zone, kind, resourceId } 또는 null
//   '/api/notes'            → { zone: 'owner_notes',   kind: 'collection', resourceId: 'notes' }
//   '/api/notes/<id>'       → { zone: 'owner_notes',   kind: 'item',       resourceId: 'note:<id>' }
//   '/notices/<id>'         → { zone: 'class_notices', kind: 'item',       resourceId: 'notice:<id>' }
export function resourceFromPath(path) {
  if (typeof path !== 'string' || path.length > 256) return null;
  const match = /^(?:\/api)?\/(notes|notices|materials)(?:\/([^/?#]+))?\/?$/u.exec(path);
  if (!match) return null;
  const collection = COLLECTIONS[match[1]];
  if (match[2] === undefined) {
    return Object.freeze({ zone: collection.zone, kind: 'collection', resourceId: collection.collectionId });
  }
  if (!ITEM_ID.test(match[2])) return null;
  const id = match[2].toLowerCase();
  return Object.freeze({ zone: collection.zone, kind: 'item', resourceId: `${collection.itemPrefix}:${id}` });
}
