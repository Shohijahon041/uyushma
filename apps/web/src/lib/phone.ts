/** +998901234567 -> "+998 90 123 45 67". */
export function formatUzPhone(value: string | null | undefined): string {
  const raw = (value ?? "").trim();
  const digits = raw.replace(/\D/g, "");
  const local =
    digits.length === 12 && digits.startsWith("998")
      ? digits.slice(3)
      : digits.length === 9
        ? digits
        : "";
  if (!local) return raw;
  return `+998 ${local.slice(0, 2)} ${local.slice(2, 5)} ${local.slice(5, 7)} ${local.slice(7, 9)}`;
}
