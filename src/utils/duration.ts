export function formatDuration(
  startDate?: string | null,
  endDate?: string | null
): string {
  if (!startDate) return "";

  const start = new Date(startDate);
  const end = endDate ? new Date(endDate) : new Date();

  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    return "";
  }

  if (end < start) {
    return "";
  }

  let years = end.getFullYear() - start.getFullYear();
  let months = end.getMonth() - start.getMonth();

  if (end.getDate() < start.getDate()) {
    months--;
  }

  if (months < 0) {
    years--;
    months += 12;
  }

  const parts: string[] = [];

  if (years > 0) {
    parts.push(`${years} Year${years > 1 ? "s" : ""}`);
  }

  if (months > 0) {
    parts.push(`${months} Month${months > 1 ? "s" : ""}`);
  }

  if (parts.length === 0) {
    return "Less than 1 Month";
  }

  return parts.join(" ");
}