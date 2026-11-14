import { getDatabase } from "../database/database";


// ===============================
// TYPES
// ===============================

export interface NotificationInput {

    module: string;

    action: string;

    message: string;

    // Free-form label for who triggered the notification (real
    // authentication now exists -- see electron/main/auth/ -- but
    // this field predates it and is display-only, not itself an
    // authorization signal).
    user?: string;

    before?: string | null;

    after?: string | null;

}


// ===============================
// GET ALL (most recent first)
// ===============================

// PERFORMANCE (Phase 9 audit): previously had no LIMIT at all -- unlike
// its sibling listAuditLogs() (audit-log-repository.ts), which already
// correctly defaults to 500. notifications is an activity-log-style
// table that only ever grows, and this is called on every Dashboard
// load (see src/pages/dashboard-page.tsx) -- without a bound, both the
// SQLite query and the IPC payload serialized back to the renderer grow
// unboundedly with the installation's age, even though the UI only ever
// needs a recent window to display/search through. 200 matches what a
// person would plausibly scroll through in this UI; older activity is
// still on disk and reachable by narrowing the ORDER BY if a "load more"
// need ever comes up, this just stops the default view from re-fetching
// the entire history every time.
export function getNotifications(limit = 200) {

    const db = getDatabase();

    return db.prepare(`

        SELECT
            id,
            module,
            action,
            message,
            app_user AS user,
            before_data AS "before",
            after_data AS "after",
            created_at

        FROM notifications

        ORDER BY id DESC

        LIMIT ?

    `).all(limit);

}



// ===============================
// CREATE
// ===============================

export function createNotification(notification: NotificationInput) {

    const db = getDatabase();

    return db.prepare(`

        INSERT INTO notifications
        (module, action, message, app_user, before_data, after_data)
        VALUES
        (@module, @action, @message, @user, @before, @after)

    `).run({

        module: notification.module,

        action: notification.action,

        message: notification.message,

        user: notification.user ?? null,

        before: notification.before ?? null,

        after: notification.after ?? null

    });

}



// ===============================
// DELETE (Admin only -- enforced in the IPC handler)
// ===============================

export function deleteNotification(id: number) {

    const db = getDatabase();

    return db.prepare(`

        DELETE FROM notifications

        WHERE id = ?

    `).run(id);

}



// ===============================
// RESET / CLEAR HISTORY (Admin only -- enforced in the IPC handler)
// ===============================

export function resetNotifications() {

    const db = getDatabase();

    return db.prepare(`

        DELETE FROM notifications

    `).run();

}
