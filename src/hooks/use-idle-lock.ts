import { useEffect, useRef, useState } from "react";

import { getSecurityPolicy } from "@/services/owner-control-service";

// ===================================================================
// useIdleLock
//
// Session Timeout / Automatic Lock (Phase 8: Security Hardening).
// Tracks mouse/keyboard/touch activity and reports whether the app
// should be showing the Lock Screen -- i.e. whether the configured
// `sessionTimeoutMinutes` (Settings > Security > Session Timeout &
// Automatic Lock) has elapsed with no activity.
//
// This hook only tracks *whether* the app is idle; it does not itself
// decide what "locked" means for the rest of the app (that's
// AuthGate, which renders the Lock Screen in place of the app when
// this hook reports isLocked === true). Unlocking (re-entering the
// password) is handled by the Lock Screen component itself, which
// calls `unlock()` to reset the timer once the correct password is
// confirmed.
// ===================================================================

export function useIdleLock(enabled: boolean): {
  isLocked: boolean;
  unlock: () => void;
} {

  const [timeoutMinutes, setTimeoutMinutes] = useState(0);
  const [isLocked, setIsLocked] = useState(false);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load (and keep in sync with) the configured timeout. Re-checked
  // whenever the app re-mounts this hook's owner (AuthGate), which
  // covers the common case of the Owner changing the policy and it
  // taking effect on the next login without requiring an app restart.
  useEffect(() => {

    if (!enabled) return;

    let cancelled = false;

    getSecurityPolicy()
      .then(policy => {
        if (!cancelled) setTimeoutMinutes(policy.sessionTimeoutMinutes);
      })
      .catch(() => {
        // Fail safe: if the policy can't be read, auto-lock stays off
        // rather than locking the person out of an app that can't
        // even tell them the current setting.
      });

    return () => { cancelled = true; };

  }, [enabled]);

  useEffect(() => {

    if (!enabled || timeoutMinutes <= 0) {
      return;
    }

    function resetTimer() {

      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }

      timerRef.current = setTimeout(() => {
        setIsLocked(true);
      }, timeoutMinutes * 60 * 1000);

    }

    const activityEvents = ["mousemove", "mousedown", "keydown", "touchstart", "wheel", "scroll"];

    function handleActivity() {

      // Once locked, activity alone must not silently dismiss the
      // lock screen -- only a correct password (unlock()) does that.
      if (isLocked) return;

      resetTimer();

    }

    activityEvents.forEach(event => window.addEventListener(event, handleActivity, { passive: true }));

    resetTimer();

    return () => {

      activityEvents.forEach(event => window.removeEventListener(event, handleActivity));

      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }

    };

  }, [enabled, timeoutMinutes, isLocked]);

  function unlock() {
    setIsLocked(false);
  }

  return { isLocked, unlock };

}
