import { JsonRpcProvider, type Provider, type Signer } from "ethers";
import { LendingPool__factory } from "./types/factories/lending/LendingPool__factory";
import type { LendingPool } from "./types/lending/LendingPool";

const lendingPoolAddress = process.env.NEXT_PUBLIC_LENDING_POOL_ADDRESS ?? "";
const collateralTokenAddress = process.env.NEXT_PUBLIC_COLLATERAL_TOKEN_ADDRESS ?? "";
const debtTokenAddress = process.env.NEXT_PUBLIC_DEBT_TOKEN_ADDRESS ?? "";
const collateralTokenSymbol = process.env.NEXT_PUBLIC_COLLATERAL_TOKEN_SYMBOL ?? "cTOKEN";
const debtTokenSymbol = process.env.NEXT_PUBLIC_DEBT_TOKEN_SYMBOL ?? "dTOKEN";
const collateralTokenDecimals = Number(process.env.NEXT_PUBLIC_COLLATERAL_TOKEN_DECIMALS ?? "18");
const debtTokenDecimals = Number(process.env.NEXT_PUBLIC_DEBT_TOKEN_DECIMALS ?? "18");
const rpcEndpoint = process.env.NEXT_PUBLIC_RPC_URL ?? "";

export const lendingMetadata = {
  poolAddress: lendingPoolAddress,
  collateralToken: {
    address: collateralTokenAddress,
    symbol: collateralTokenSymbol,
    decimals: collateralTokenDecimals,
  },
  debtToken: {
    address: debtTokenAddress,
    symbol: debtTokenSymbol,
    decimals: debtTokenDecimals,
  },
};

export function assertLendingPoolAddress(): string {
  if (!lendingPoolAddress) {
    throw new Error("LendingPool address is not configured. Set NEXT_PUBLIC_LENDING_POOL_ADDRESS.");
  }
  return lendingPoolAddress;
}

export function getLendingPoolContract(signerOrProvider: Signer | Provider): LendingPool {
  return LendingPool__factory.connect(assertLendingPoolAddress(), signerOrProvider);
}

export function getReadOnlyLendingPool(): LendingPool | null {
  if (!lendingPoolAddress || !rpcEndpoint) {
    return null;
  }
  const provider = new JsonRpcProvider(rpcEndpoint);
  return getLendingPoolContract(provider);
}
