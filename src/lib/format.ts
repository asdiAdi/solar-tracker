export const isNA = (n: unknown) =>
  typeof n !== "number" || !Number.isFinite(n);

export const php = (n: number) => {
  if (isNA(n)) return "N/A";
  const v = Math.round(n);
  return `${v < 0 ? "−₱" : "₱"}${Math.abs(v).toLocaleString("en-PH", { maximumFractionDigits: 0, minimumFractionDigits: 0 })}`;
};

export const fmtKw = (n: number) => (isNA(n) ? "N/A" : `${Math.round(n)} W`);
export const fmtKwh = (n: number) => (isNA(n) ? "N/A" : `${n.toFixed(1)} kWh`);

export const kwParts = (n: number) =>
  isNA(n)
    ? { value: "N/A", unit: "" }
    : { value: String(Math.round(n)), unit: "W" };
export const kwhParts = (n: number) =>
  isNA(n) ? { value: "N/A", unit: "" } : { value: n.toFixed(1), unit: "kWh" };

export const kwh1 = (n: number) => (isNA(n) ? "N/A" : `${n.toFixed(1)} kWh`);
export const sunH = (n: number) => (isNA(n) ? "N/A" : n.toFixed(1));
