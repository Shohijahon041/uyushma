/**
 * O'zbekiston davlat raqamini rasmiy ko'rinishda qaytaradi:
 * 60A125UA -> "60 A 125 UA", A125BC -> "A 125 BC".
 */
export function formatUzPlate(plate: string | null | undefined): string {
  const clean = (plate ?? "").replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  if (!clean) return "";
  const standard = /^(\d{2})([A-Z])(\d{3})([A-Z]{2})$/.exec(clean);
  if (standard) {
    return `${standard[1]} ${standard[2]} ${standard[3]} ${standard[4]}`;
  }
  const short = /^([A-Z])(\d{3})([A-Z]{2})$/.exec(clean);
  if (short) return `${short[1]} ${short[2]} ${short[3]}`;
  return clean;
}

export function splitUzPlate(plate: string | null | undefined): {
  region: string;
  body: string;
} {
  const clean = (plate ?? "").replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  const standard = /^(\d{2})([A-Z]\d{3}[A-Z]{2})$/.exec(clean);
  if (standard) {
    return {
      region: standard[1],
      body: `${standard[2].slice(0, 1)} ${standard[2].slice(1, 4)} ${standard[2].slice(4)}`,
    };
  }
  return { region: clean.slice(0, 2), body: clean.slice(2) || clean };
}
