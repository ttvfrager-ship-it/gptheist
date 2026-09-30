/** PonsV2BondingCurveMath._amountOut with feeBps=0, preserving uint256 overflow checks. */
const MAX_UINT256 = (1n << 256n) - 1n;
export function uint256(value: bigint): bigint {
  if (value < 0n || value > MAX_UINT256) throw new Error("UINT256_OVERFLOW");
  return value;
}
export function curveAmountOut(amount: bigint, reserveIn: bigint, reserveOut: bigint): bigint {
  if (amount <= 0n || reserveIn <= 0n || reserveOut <= 0n) throw new Error("INVALID_CURVE_INPUT");
  const scaled = uint256(amount * 10_000n);
  const numerator = uint256(scaled * reserveOut);
  const denominator = uint256(uint256(reserveIn * 10_000n) + scaled);
  const result = numerator / denominator;
  if (result === 0n) throw new Error("INSUFFICIENT_OUTPUT_AMOUNT");
  return result;
}
