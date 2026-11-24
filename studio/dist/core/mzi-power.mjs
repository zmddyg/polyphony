export function mziPowerA(phaseRadians) {
  return phaseRadians === Math.PI ? 0 : Math.cos(phaseRadians / 2) ** 2;
}
