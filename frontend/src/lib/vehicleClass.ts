export function isHypercarClass(value?: string | null) {
  const label = (value || "").trim();
  return /(^|\W)hypercar(\W|$)/i.test(label) || /^hyper$/i.test(label);
}
