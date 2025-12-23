import { JsonRpcProvider, type Provider, type Signer } from "ethers";
import { SimpleSwap__factory } from "./types/factories/SimpleSwap__factory";
import type { SimpleSwap } from "./types/SimpleSwap";

export const simpleSwapAddress = process.env.NEXT_PUBLIC_SIMPLE_SWAP_ADDRESS ?? "";

const token0Address = process.env.NEXT_PUBLIC_TOKEN0_ADDRESS ?? "";
const token1Address = process.env.NEXT_PUBLIC_TOKEN1_ADDRESS ?? "";
const token0Symbol = process.env.NEXT_PUBLIC_TOKEN0_SYMBOL ?? "TOKEN0";
const token1Symbol = process.env.NEXT_PUBLIC_TOKEN1_SYMBOL ?? "TOKEN1";
const token0Decimals = Number(process.env.NEXT_PUBLIC_TOKEN0_DECIMALS ?? "18");
const token1Decimals = Number(process.env.NEXT_PUBLIC_TOKEN1_DECIMALS ?? "18");
const rpcEndpoint = process.env.NEXT_PUBLIC_RPC_URL ?? "";

export const tokenMetadata = {
  token0: { address: token0Address, symbol: token0Symbol, decimals: token0Decimals },
  token1: { address: token1Address, symbol: token1Symbol, decimals: token1Decimals },
};

export function assertSimpleSwapAddress(): string {
  if (!simpleSwapAddress) {
    throw new Error("SimpleSwap address is not configured. Set NEXT_PUBLIC_SIMPLE_SWAP_ADDRESS.");
  }
  return simpleSwapAddress;
}

export function getSimpleSwapContract(signerOrProvider: Signer | Provider): SimpleSwap {
  return SimpleSwap__factory.connect(assertSimpleSwapAddress(), signerOrProvider);
}

export function getReadOnlySimpleSwap(): SimpleSwap | null {
  if (!simpleSwapAddress || !rpcEndpoint) {
    return null;
  }
  const provider = new JsonRpcProvider(rpcEndpoint);
  return getSimpleSwapContract(provider);
}

export type SimpleSwapSnapshot = {
  reserve0: bigint;
  reserve1: bigint;
  totalSupply: bigint;
};

export async function fetchSimpleSwapSnapshot(provider: Provider): Promise<SimpleSwapSnapshot> {
  const contract = getSimpleSwapContract(provider);
  const [[reserve0, reserve1], totalSupply] = await Promise.all([
    contract.getReserves(),
    contract.totalSupply(),
  ]);
  return { reserve0, reserve1, totalSupply };
}

export function getTokenInfo(side: "token0" | "token1") {
  return tokenMetadata[side];
}
