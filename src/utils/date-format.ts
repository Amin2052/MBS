const DATE_FORMAT_STORAGE_KEY = "mooral.dateFormat";

export type DateFormatCode = "DMY" | "MDY" | "YMD";

// Module-level (not React state) so the many plain formatDateShort()/
// formatDateTime() call sites across the app -- most of them inside
// .map() renders, not components -- don't each need to become hooks to
// pick up the Settings > Localization > Date Format preference. Mirrors
// how currency used to work before useCurrency(): a localStorage-backed
// module-level value, kept in sync by the Localization settings page
// calling setDateFormatPreference() whenever it loads/saves settings.
let currentFormat: DateFormatCode = readStoredDateFormat();

function readStoredDateFormat(): DateFormatCode {

  const stored = typeof localStorage !== "undefined" ? localStorage.getItem(DATE_FORMAT_STORAGE_KEY) : null;

  if (stored === "DMY" || stored === "MDY" || stored === "YMD") {
    return stored;
  }

  return "DMY";

}

export function setDateFormatPreference(format: DateFormatCode): void {

  currentFormat = format;

  if (typeof localStorage !== "undefined") {
    localStorage.setItem(DATE_FORMAT_STORAGE_KEY, format);
  }

}

function dateParts(date: Date): { day: string; month: string; monthNum: string; year: string } {

  return {
    day: String(date.getDate()).padStart(2, "0"),
    month: new Intl.DateTimeFormat("en-GB", { month: "short" }).format(date),
    monthNum: String(date.getMonth() + 1).padStart(2, "0"),
    year: String(date.getFullYear())
  };

}

function formatDatePart(date: Date): string {

  const { day, month, monthNum, year } = dateParts(date);

  switch (currentFormat) {
    case "MDY": return `${monthNum}/${day}/${year}`;
    case "YMD": return `${year}-${monthNum}-${day}`;
    case "DMY":
    default: return `${day} ${month} ${year}`;
  }

}

export function formatDateShort(
  value: string | Date | null | undefined
): string {
  if (!value) return "-";

  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  return formatDatePart(date);
}

export function formatDateTime(
  value: string | Date | null | undefined
): string {
  if (!value) return "-";

  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  const time = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);

  return `${formatDatePart(date)}, ${time}`;
}
