import { JsonRpcProvider, type Provider, type Signer } from "ethers";
import guardianVaultArtifact from "./abi/GuardianVault.json";
import { GuardianVault__factory } from "./types/factories/GuardianVault__factory";
import type { GuardianVault } from "./types/GuardianVault";

export const guardianVaultAddress = process.env.NEXT_PUBLIC_GUARDIAN_VAULT_ADDRESS ?? "";
export const rpcUrl = process.env.NEXT_PUBLIC_RPC_URL ?? "";
export const guardianVaultAbi = guardianVaultArtifact.abi;

export type WithdrawalStruct = GuardianVault.WithdrawalRequestStructOutput;

export function assertGuardianVaultAddress(): string {
  if (!guardianVaultAddress) {
    throw new Error("GuardianVault address is not configured. Set NEXT_PUBLIC_GUARDIAN_VAULT_ADDRESS.");
  }
  return guardianVaultAddress;
}

export function getGuardianVaultContract(signerOrProvider: Signer | Provider) {
  return GuardianVault__factory.connect(assertGuardianVaultAddress(), signerOrProvider);
}

export function getReadOnlyGuardianVault(): GuardianVault | null {
  if (!guardianVaultAddress || !rpcUrl) {
    return null;
  }
  const provider = new JsonRpcProvider(rpcUrl);
  return getGuardianVaultContract(provider);
}
