/**
 * date-range-presets.ts
 *
 * Centralized date-range calculations for the Accounting date filter.
 * Pure functions only (no React, no IO) so the same presets can be reused
 * anywhere a "Today / This Week / This Month ..." style filter is needed,
 * without duplicating date math across components.
 */

export type DateRangePresetKey =
    | "all"
    | "today"
    | "yesterday"
    | "thisWeek"
    | "lastWeek"
    | "thisMonth"
    | "lastMonth"
    | "thisQuarter"
    | "lastQuarter"
    | "thisYear"
    | "lastYear"
    | "custom";

export interface DateRangePresetOption {
    key: DateRangePresetKey;
    label: string;
}

// Order matches the requested UX: most recent / most common ranges first,
// "Custom Range" last since it requires extra input.
export const DATE_RANGE_PRESETS: DateRangePresetOption[] = [
    { key: "all", label: "All Time" },
    { key: "today", label: "Today" },
    { key: "yesterday", label: "Yesterday" },
    { key: "thisWeek", label: "This Week" },
    { key: "lastWeek", label: "Last Week" },
    { key: "thisMonth", label: "This Month" },
    { key: "lastMonth", label: "Last Month" },
    { key: "thisQuarter", label: "This Quarter" },
    { key: "lastQuarter", label: "Last Quarter" },
    { key: "thisYear", label: "This Year" },
    { key: "lastYear", label: "Last Year" },
    { key: "custom", label: "Custom Range" }
];

export interface ResolvedDateRange {
    fromDate?: string;
    toDate?: string;
}

function pad2(value: number): string {
    return String(value).padStart(2, "0");
}

function toISODate(date: Date): string {
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function startOfDay(date: Date): Date {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

// Business week: Monday -> Sunday.
function startOfWeek(date: Date): Date {
    const day = startOfDay(date);
    const weekday = day.getDay(); // 0 = Sunday ... 6 = Saturday
    const diffToMonday = weekday === 0 ? -6 : 1 - weekday;
    day.setDate(day.getDate() + diffToMonday);
    return day;
}

function endOfWeek(date: Date): Date {
    const start = startOfWeek(date);
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    return end;
}

/**
 * Resolves a preset key (plus optional custom start/end) into a concrete
 * { fromDate, toDate } range in YYYY-MM-DD format, matching what the
 * accounting repository's date filter expects.
 *
 * Returns undefined fromDate/toDate for "all" (no filter applied).
 */
export function getPresetDateRange(
    preset: DateRangePresetKey,
    customStart?: string,
    customEnd?: string
): ResolvedDateRange {
    const now = new Date();

    switch (preset) {
        case "today": {
            const iso = toISODate(startOfDay(now));
            return { fromDate: iso, toDate: iso };
        }

        case "yesterday": {
            const yesterday = new Date(now);
            yesterday.setDate(yesterday.getDate() - 1);
            const iso = toISODate(startOfDay(yesterday));
            return { fromDate: iso, toDate: iso };
        }

        case "thisWeek": {
            return {
                fromDate: toISODate(startOfWeek(now)),
                toDate: toISODate(endOfWeek(now))
            };
        }

        case "lastWeek": {
            const lastWeekAnchor = new Date(now);
            lastWeekAnchor.setDate(lastWeekAnchor.getDate() - 7);
            return {
                fromDate: toISODate(startOfWeek(lastWeekAnchor)),
                toDate: toISODate(endOfWeek(lastWeekAnchor))
            };
        }

        case "thisMonth": {
            const start = new Date(now.getFullYear(), now.getMonth(), 1);
            const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
            return { fromDate: toISODate(start), toDate: toISODate(end) };
        }

        case "lastMonth": {
            const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
            const end = new Date(now.getFullYear(), now.getMonth(), 0);
            return { fromDate: toISODate(start), toDate: toISODate(end) };
        }

        case "thisQuarter": {
            const quarterStartMonth = Math.floor(now.getMonth() / 3) * 3;
            const start = new Date(now.getFullYear(), quarterStartMonth, 1);
            const end = new Date(now.getFullYear(), quarterStartMonth + 3, 0);
            return { fromDate: toISODate(start), toDate: toISODate(end) };
        }

        case "lastQuarter": {
            const currentQuarterStartMonth = Math.floor(now.getMonth() / 3) * 3;
            const start = new Date(now.getFullYear(), currentQuarterStartMonth - 3, 1);
            const end = new Date(now.getFullYear(), currentQuarterStartMonth, 0);
            return { fromDate: toISODate(start), toDate: toISODate(end) };
        }

        case "thisYear": {
            const start = new Date(now.getFullYear(), 0, 1);
            const end = new Date(now.getFullYear(), 11, 31);
            return { fromDate: toISODate(start), toDate: toISODate(end) };
        }

        case "lastYear": {
            const start = new Date(now.getFullYear() - 1, 0, 1);
            const end = new Date(now.getFullYear() - 1, 11, 31);
            return { fromDate: toISODate(start), toDate: toISODate(end) };
        }

        case "custom": {
            return {
                fromDate: customStart || undefined,
                toDate: customEnd || undefined
            };
        }

        case "all":
        default:
            return { fromDate: undefined, toDate: undefined };
    }
}
