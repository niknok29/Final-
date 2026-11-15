// Presentation only: backup routes are supplied by the backend (contract K).
export function routeNoticeKey(route) {
  return route?.offline ? "OFFLINE_BACKUP_ROUTE_MODE" : null;
}

export function routeWarningKey(route) {
  if (route?.fallbackMode === "cache") return "backupCacheWarning";
  if (route?.fallbackMode === "static_matrix") return "backupMatrixWarning";
  return "fallbackWarning";
}

export function shelterKindIcon(kind) {
  return (
    { shelter: "\u{1f3e0}", park: "\u{1f333}", stadium: "\u{1f3df}" }[kind] ||
    "\u{1f3e0}"
  );
}
