// Explicit material constraints, with SI inputs and documented applicability.
export function fresnelNormal(n1,n2) {
  if (![n1,n2].every(n=>Number.isFinite(n)&&n>0)) throw new Error('折射率须为正的有限实数。');
  const R=((n1-n2)/(n1+n2))**2;return {R,T:1-R};
}
export function thermalPhase({wavelengthM,lengthM,dnDT,thermalResistanceKW,powerW}) {
  if (![wavelengthM,lengthM,dnDT,thermalResistanceKW].every(n=>Number.isFinite(n)&&n>0)||!Number.isFinite(powerW)||powerW<0) throw new Error('热光参数或单位无效。');
  const pPiW=wavelengthM/(2*lengthM*dnDT*thermalResistanceKW);
  return {phaseRad:Math.PI*powerW/pPiW,pPiW,deltaTemperatureK:thermalResistanceKW*powerW};
}
