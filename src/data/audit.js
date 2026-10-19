// src/data/audit.js
import { save, uuid, nowIso } from './db.js'
import { getUser } from './session.js'

export function audit(action, entity, entityId, details = {}) {
  return save('audit_logs', {
    id: uuid(),
    user_id: getUser()?.id ?? null,
    action,
    entity: entity ?? null,
    entity_id: entityId == null ? null : String(entityId),
    details: JSON.stringify(details ?? {}),
    ip: null,
    created_at: nowIso(),
  })
}
