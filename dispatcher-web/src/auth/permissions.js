const ROLE_PERMISSIONS = {
  dispatcher: new Set(['view_dashboard', 'approve_alert', 'dismiss_alert']),
  admin: new Set(['view_dashboard', 'approve_alert', 'dismiss_alert', 'simulate']),
}

/**
 * Check whether a user role is permitted to perform an action.
 * Add new roles by appending a key to ROLE_PERMISSIONS above.
 */
export function can(role, action) {
  if (!role || !action) return false
  const allowed = ROLE_PERMISSIONS[role]
  return Boolean(allowed && allowed.has(action))
}
