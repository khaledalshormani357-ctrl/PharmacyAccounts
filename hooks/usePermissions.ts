// Permission-aware hook for screens.
//
// Reads the current session actor (services/session.ts) and refreshes it
// whenever the screen regains focus, because the actor is in-memory only
// and a screen may mount before the login binding lands.
//
// Display rule: when there is no actor at all *and* the session was never
// bound (legacy local mode, no Supabase login), everything is shown as
// before. When the session is bound — to a user, or to null for a cloud
// login with no matching local record — only the permissions the actor
// actually holds are shown. Hiding a link is only a UI hint: the services
// enforce the same permission for real (see services/erp-database.ts).
import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { can as sessionCan, getCurrentActor, isSessionBound, type User } from '@/services/session';

export function usePermissions() {
  const [currentUser, setCurrentUser] = useState<User | null>(() => getCurrentActor());
  const [bound, setBound] = useState<boolean>(() => isSessionBound());

  useFocusEffect(useCallback(() => {
    setCurrentUser(getCurrentActor());
    setBound(isSessionBound());
  }, []));

  const can = useCallback((permissionId: string): boolean => {
    if (!bound) return true; // Legacy local mode: show everything, as before.
    if (!currentUser) return false; // Bound cloud session with no local record.
    return sessionCan(permissionId);
  }, [bound, currentUser]);

  return { currentUser, bound, can };
}
