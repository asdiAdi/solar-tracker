// Bypass math, shared by every card.
//
// energy.bypass_kwh is the GROSS house-meter estimate (whole house, manual
// reading). SolarMAN already counted part of that grid power as import, so
// the only subtraction in the app lives here:
//
//   net bypass = max(0, gross - import)
//
// Floored at 0 because a stale manual reading can lag behind import.
export function netBypassKwh(energy: {
  bypass_kwh: number;
  grid_import_kwh: number;
}): number {
  if (!Number.isFinite(energy.bypass_kwh)) return Number.NaN;
  if (!Number.isFinite(energy.grid_import_kwh)) return Number.NaN;
  return Math.max(
    0,
    Math.round((energy.bypass_kwh - energy.grid_import_kwh) * 10) / 10,
  );
}
