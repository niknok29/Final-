const ROLE_PERMISSIONS = {
  dispatcher: new Set([
    'view_dashboard',
    'dispatch',
    'approve_alert',
    'dismiss_alert',
    'clear_suspicious',
    'simulate',
  ]),
  admin: new Set([
    'view_dashboard',
    'dispatch',
    'approve_alert',
    'dismiss_alert',
    'clear_suspicious',
    'simulate',
    'admin',
  ]),
  observer: new Set(['view_dashboard']),
  viewer: new Set(['view_dashboard']),
}

const DISPATCH_ACTIONS = new Set(['dispatch', 'approve_alert', 'dismiss_alert', 'clear_suspicious'])

/**
 * Return the list of permissions granted to a role.
 */
export function getRolePermissions(role) {
  const allowed = role ? ROLE_PERMISSIONS[role] : null
  return allowed ? Array.from(allowed) : []
}

/**
 * Check whether a user object or role string is permitted to perform an action.
 */
export function can(roleOrUser, action) {
  if (!roleOrUser || !action) return false
  if (typeof roleOrUser === 'object') {
    if (Array.isArray(roleOrUser.permissions) && roleOrUser.permissions.length > 0) {
      const explicit = new Set(roleOrUser.permissions)
      if (explicit.has(action)) return true
      if (DISPATCH_ACTIONS.has(action) && explicit.has('dispatch')) return true
      if (action === 'view_dashboard' && roleOrUser.role) {
        return Boolean(ROLE_PERMISSIONS[roleOrUser.role]?.has('view_dashboard'))
      }
      return false
    }
    return can(roleOrUser.role, action)
  }
  const allowed = ROLE_PERMISSIONS[roleOrUser]
  return Boolean(allowed && allowed.has(action))
}

/**
 * Check whether a user or role has operational dispatch permissions (approve, dismiss, clear flood).
 */
export function canDispatch(userOrRole) {
  return can(userOrRole, 'dispatch') || can(userOrRole, 'approve_alert')
}

/**
 * Check whether a user or role can trigger simulation scenarios.
 */
export function canSimulate(userOrRole) {
  return can(userOrRole, 'simulate')
}
