export const isNA = (n: unknown) =>
  typeof n !== "number" || !Number.isFinite(n);

export const php = (n: number | null | undefined) => {
  if (isNA(n)) return "N/A";
  const v = Math.round(n as number);
  return `${v < 0 ? "−₱" : "₱"}${Math.abs(v).toLocaleString("en-PH", { maximumFractionDigits: 0, minimumFractionDigits: 0 })}`;
};

export const fmtKw = (n: number | null | undefined) =>
  isNA(n) ? "N/A" : `${Math.round(n as number)} W`;
export const fmtKwh = (n: number | null | undefined) =>
  isNA(n) ? "N/A" : `${(n as number).toFixed(1)} kWh`;

export const kwParts = (n: number | null | undefined) =>
  isNA(n)
    ? { value: "N/A", unit: "" }
    : { value: String(Math.round(n as number)), unit: "W" };
export const kwhParts = (n: number | null | undefined) =>
  isNA(n)
    ? { value: "N/A", unit: "" }
    : { value: (n as number).toFixed(1), unit: "kWh" };

export const kwh1 = (n: number | null | undefined) =>
  isNA(n) ? "N/A" : `${(n as number).toFixed(1)} kWh`;
export const sunH = (n: number | null | undefined) =>
  isNA(n) ? "N/A" : (n as number).toFixed(1);
