import { JsonRpcProvider, type Provider, type Signer } from "ethers";
import { StakingPool__factory } from "./types/factories/StakingPool__factory";
import type { StakingPool } from "./types/StakingPool";

const stakingPoolAddress = process.env.NEXT_PUBLIC_STAKING_POOL_ADDRESS ?? "";
const stakingTokenAddress = process.env.NEXT_PUBLIC_STAKING_TOKEN_ADDRESS ?? "";
const rewardTokenAddress = process.env.NEXT_PUBLIC_REWARD_TOKEN_ADDRESS ?? "";
const stakingTokenSymbol = process.env.NEXT_PUBLIC_STAKING_TOKEN_SYMBOL ?? "sTOKEN";
const rewardTokenSymbol = process.env.NEXT_PUBLIC_REWARD_TOKEN_SYMBOL ?? "rTOKEN";
const stakingTokenDecimals = Number(process.env.NEXT_PUBLIC_STAKING_TOKEN_DECIMALS ?? "18");
const rewardTokenDecimals = Number(process.env.NEXT_PUBLIC_REWARD_TOKEN_DECIMALS ?? "18");
const rpcEndpoint = process.env.NEXT_PUBLIC_RPC_URL ?? "";

export const stakingMetadata = {
  poolAddress: stakingPoolAddress,
  stakingToken: {
    address: stakingTokenAddress,
    symbol: stakingTokenSymbol,
    decimals: stakingTokenDecimals,
  },
  rewardToken: {
    address: rewardTokenAddress,
    symbol: rewardTokenSymbol,
    decimals: rewardTokenDecimals,
  },
};

export function assertStakingPoolAddress(): string {
  if (!stakingPoolAddress) {
    throw new Error("StakingPool address is not configured. Set NEXT_PUBLIC_STAKING_POOL_ADDRESS.");
  }
  return stakingPoolAddress;
}

export function getStakingPoolContract(signerOrProvider: Signer | Provider): StakingPool {
  return StakingPool__factory.connect(assertStakingPoolAddress(), signerOrProvider);
}

export function getReadOnlyStakingPool(): StakingPool | null {
  if (!stakingPoolAddress || !rpcEndpoint) {
    return null;
  }
  const provider = new JsonRpcProvider(rpcEndpoint);
  return getStakingPoolContract(provider);
}
