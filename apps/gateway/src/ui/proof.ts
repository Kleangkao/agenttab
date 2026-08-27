/**
 * The settled Mainnet pair every surface points at: exact-deficit DFlow buy,
 * then the x402 payment that used it. `apps/gateway/src/ui/app.js` keeps its
 * own copy because it is served as a static asset; product-surfaces.test.ts
 * asserts the two stay identical.
 */
export const MAINNET_DFLOW_TX =
  "3dCCXbhyEpYP2bDwstVLR1r9zUbrNyompLRM1jZUWhEvEMguRuim5XVNXNTrPoFjRdZLbxZtcJwSst9RD5gM1reg";
export const MAINNET_X402_TX =
  "27yBXf4RLuVNTG3hDE5mDYdYZHjYGHLZM6dy4TeGyqQtjrBR8L4eAeBs9MVXBkxKY1nUgSQiEQohhxeF4DvMh9yR";

export function solscanTx(signature: string): string {
  return `https://solscan.io/tx/${signature}`;
}
