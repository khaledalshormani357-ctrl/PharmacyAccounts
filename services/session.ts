// Current-user session — thin public API over the actor state that lives in
// services/erp-database.ts (see the "CURRENT ACTOR (SESSION)" section there).
// The session is in-memory only and is never persisted to AsyncStorage:
// a cloud login binds it, logout clears it, and a fresh app start has no
// actor until the user signs in again.
//
// Resolution rule: a cloud login whose username matches an active local
// User (case-insensitive, trimmed) becomes that user; a cloud login with no
// matching local record binds to null, which may read data but is denied
// every guarded write in the services. The legacy local mode (no Supabase
// login) never binds a session, so existing behaviour is unchanged.
import { getEffectivePermissions } from './employee-permissions';
import {
  clearCurrentActorId,
  getCurrentActor as getDbActor,
  getUsers,
  isCurrentActorBound,
  setCurrentActorId,
  type EmployeePermissionMap,
  type User,
} from './database';

export type { User };

/** Bind the session to a local user, or to null for a cloud login with no local record. */
export function setCurrentActor(user: User | null): void {
  setCurrentActorId(user ? user.id : null);
}

/** The bound local user, or null when the session is bound to no local record or is unbound. */
export function getCurrentActor(): User | null {
  return getDbActor();
}

/** Unbind the session entirely (logout / legacy local mode). */
export function clearCurrentActor(): void {
  clearCurrentActorId();
}

/** True once a login (or an explicit test actor) has bound the session. */
export function isSessionBound(): boolean {
  return isCurrentActorBound();
}

/**
 * Find the active local user for a login username (case-insensitive,
 * trimmed). Returns null when there is no matching active local user.
 */
export function resolveActorForUsername(username: string): User | null {
  const wanted = username.trim().toLowerCase();
  if (!wanted) return null;
  return getUsers().find(
    user => user.active && user.username.trim().toLowerCase() === wanted,
  ) ?? null;
}

/** Effective permissions of the current actor, or null when there is no actor. */
export function getCurrentPermissions(): EmployeePermissionMap | null {
  const actor = getDbActor();
  if (!actor) return null;
  return getEffectivePermissions(actor.role, actor.permissions);
}

/** True only when the current actor exists, is active, and holds the permission. */
export function can(permissionId: string): boolean {
  const actor = getDbActor();
  if (!actor || !actor.active) return false;
  return getEffectivePermissions(actor.role, actor.permissions)[permissionId] === true;
}

/** Throw when the current actor may not perform `permissionId`. */
export function requirePermission(permissionId: string): void {
  if (!can(permissionId)) throw new Error(`PERMISSION_DENIED: ${permissionId}`);
}
