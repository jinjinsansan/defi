export type ActivityCategory =
  | "guardian"
  | "swap"
  | "liquidity"
  | "staking"
  | "lending"
  | "system";

export interface ActivityLogEntry {
  id: string | number;
  category: ActivityCategory;
  description: string;
  txHash?: string | null;
  account?: string | null;
  created_at: string;
}

export interface CreateActivityPayload {
  category: ActivityCategory;
  description: string;
  txHash?: string;
  account?: string;
}

export interface SignedActivityPayload extends CreateActivityPayload {
  account: string;
  nonce: string;
}

export function buildActivityMessage(payload: SignedActivityPayload) {
  const safeHash = payload.txHash ?? "";
  const normalizedAccount = payload.account.toLowerCase();
  return `ActivityLog|${normalizedAccount}|${payload.category}|${payload.description}|${safeHash}|${payload.nonce}`;
}
