const SMALL = new Set(["of", "the", "and", "for", "a", "an", "in", "on", "at", "to"]);
const ACRONYMS = new Set(["SF", "SFMTA", "GGRWA", "PG&E", "LLC", "INC"]);

export function displayVendor(raw: string): string {
  let s = raw.trim();
  s = s.replace(/\s+#?\d{3,5}\s*$/i, "");
  s = s.replace(/\s+(GA|HLF)-[\w-]+\s*$/i, "");
  s = s.replace(/\bMKTPLACE\b/gi, "Marketplace");
  s = s.replace(/\bPMTS\b/gi, "Payments");
  s = s.replace(/\bINC\b/g, "Inc.");
  s = s.replace(/\bL\.P\.\b/gi, "L.P.");

  const words = s.split(/\s+/).filter(Boolean);
  return words
    .map((w, i) => {
      const upper = w.toUpperCase();
      if (ACRONYMS.has(upper) || ACRONYMS.has(w)) return w.includes("&") ? w : upper;
      if (i > 0 && SMALL.has(w.toLowerCase())) return w.toLowerCase();
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    })
    .join(" ");
}
