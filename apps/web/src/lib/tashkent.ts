export function todayTashkent(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tashkent",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export function periodOf(dateOnly: string): string {
  return dateOnly.slice(0, 7);
}
