"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import {
  BrowserProvider,
  Contract,
  JsonRpcProvider,
  ZeroAddress,
  formatEther,
  formatUnits,
  getAddress,
  isAddress,
  parseEther,
  parseUnits,
  type Eip1193Provider,
  type Signer,
} from "ethers";
import EthereumProvider from "@walletconnect/ethereum-provider";
import type { ActivityLogEntry, CreateActivityPayload, ActivityCategory } from "@/lib/activityLog";
import { buildActivityMessage } from "@/lib/activityLog";
import {
  guardianVaultAddress,
  rpcUrl,
  getGuardianVaultContract,
  type WithdrawalStruct,
} from "@/lib/contracts/guardianVault";
import {
  fetchSimpleSwapSnapshot,
  getSimpleSwapContract,
  simpleSwapAddress,
  tokenMetadata,
} from "@/lib/contracts/simpleSwap";
import {
  getStakingPoolContract,
  stakingMetadata,
} from "@/lib/contracts/stakingPool";
import { getLendingPoolContract, lendingMetadata } from "@/lib/contracts/lendingPool";

declare global {
  interface Window {
    ethereum?: unknown;
  }
}

type WithdrawalEntry = {
  id: bigint;
  data: WithdrawalStruct;
};

const MAX_HISTORY = 5;
const ERC20_ABI = [
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
];
const OPTIONAL_CHAIN_IDS = [11155111, 80002, 97];
const CHAIN_EXPLORERS: Record<number, string> = {
  11155111: "https://sepolia.etherscan.io",
  80002: "https://amoy.polygonscan.com",
  97: "https://testnet.bscscan.com",
};

type TokenSide = "token0" | "token1";

export default function Home() {
  const [account, setAccount] = useState<string>("");
  const [signer, setSigner] = useState<Signer | null>(null);
  const [threshold, setThreshold] = useState<number>(0);
  const [vaultBalance, setVaultBalance] = useState<string>("0");
  const [status, setStatus] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [withdrawals, setWithdrawals] = useState<WithdrawalEntry[]>([]);
  const [formData, setFormData] = useState({ recipient: "", amount: "", expiryMinutes: "" });
  const [swapSnapshot, setSwapSnapshot] = useState({ reserve0: "0", reserve1: "0", totalSupply: "0" });
  const [userLpBalance, setUserLpBalance] = useState("0");
  const [liquidityForm, setLiquidityForm] = useState({ amount0: "", amount1: "", minShares: "" });
  const [removeForm, setRemoveForm] = useState({ shares: "", minAmount0: "", minAmount1: "" });
  const [swapForm, setSwapForm] = useState({
    amountIn: "",
    minAmountOut: "",
    direction: "token0ToToken1" as "token0ToToken1" | "token1ToToken0",
  });
  const [stakingAmount, setStakingAmount] = useState({ deposit: "", withdraw: "" });
  const [pendingRewards, setPendingRewards] = useState("0");
  const [stakedBalance, setStakedBalance] = useState("0");
  const [lendingForms, setLendingForms] = useState({
    deposit: "",
    withdraw: "",
    borrow: "",
    repay: "",
  });
  const [lendingSnapshot, setLendingSnapshot] = useState({
    collateral: "0",
    debt: "0",
    borrowLimit: "0",
    healthFactor: "-",
    availableLiquidity: "0",
    utilization: "0%",
    totalCollateral: "0",
    totalBorrows: "0",
    collateralPrice: "-",
    debtPrice: "-",
  });
  const [connectionMethod, setConnectionMethod] = useState<"metamask" | "walletconnect" | null>(null);
  const [walletConnectProvider, setWalletConnectProvider] = useState<EthereumProvider | null>(null);
  const [activityLogs, setActivityLogs] = useState<ActivityLogEntry[]>([]);
  const walletConnectProjectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? "";
  const defaultChainIdEnv = Number.parseInt(process.env.NEXT_PUBLIC_DEFAULT_CHAIN_ID ?? "11155111", 10);
  const primaryChainId = Number.isNaN(defaultChainIdEnv) ? 11155111 : defaultChainIdEnv;
  const supportedChainIds = useMemo(() => {
    return Array.from(new Set([primaryChainId, ...OPTIONAL_CHAIN_IDS]));
  }, [primaryChainId]);
  const walletConnectRpcMap = useMemo(() => {
    if (!rpcUrl) {
      return undefined;
    }
    return { [primaryChainId]: rpcUrl };
  }, [primaryChainId]);
  const activityEnabled = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const explorerBaseUrl = CHAIN_EXPLORERS[primaryChainId];
  const formattedBalance = useMemo(() => {
    const parsed = parseFloat(vaultBalance);
    return Number.isFinite(parsed) ? parsed.toFixed(4) : vaultBalance;
  }, [vaultBalance]);
  const formattedLpBalance = useMemo(() => {
    const parsed = parseFloat(userLpBalance);
    return Number.isFinite(parsed) ? parsed.toFixed(4) : userLpBalance;
  }, [userLpBalance]);

  const simpleSwapConfigured = Boolean(
    simpleSwapAddress && tokenMetadata.token0.address && tokenMetadata.token1.address,
  );
  const stakingConfigured = Boolean(stakingMetadata.poolAddress && stakingMetadata.stakingToken.address);
  const lendingConfigured = Boolean(
    lendingMetadata.poolAddress && lendingMetadata.collateralToken.address && lendingMetadata.debtToken.address,
  );

  const readProvider = useMemo(() => {
    if (!rpcUrl) return null;
    try {
      return new JsonRpcProvider(rpcUrl);
    } catch (err) {
      console.error(err);
      return null;
    }
  }, []);

  const ensureSimpleSwapContract = () => {
    if (!simpleSwapConfigured) {
      throw new Error("SimpleSwap コントラクトの環境変数を設定してください。");
    }
    if (!signer) {
      throw new Error("先にウォレットを接続してください。");
    }
    return getSimpleSwapContract(signer);
  };

  const ensureStakingContract = () => {
    if (!stakingConfigured) {
      throw new Error("StakingPool の環境変数を設定してください。");
    }
    if (!signer) {
      throw new Error("先にウォレットを接続してください。");
    }
    return getStakingPoolContract(signer);
  };

  const ensureLendingContract = () => {
    if (!lendingConfigured) {
      throw new Error("LendingPool の環境変数を設定してください。");
    }
    if (!signer) {
      throw new Error("先にウォレットを接続してください。");
    }
    return getLendingPoolContract(signer);
  };

  const ensureTokenAllowance = async (
    tokenAddress: string,
    spender: string,
    required: bigint,
  ) => {
    if (required === 0n) return;
    if (!signer || !account) {
      throw new Error("ウォレットを接続してください。");
    }
    if (!tokenAddress || !spender) {
      throw new Error("トークンまたはコントラクトアドレスが未設定です。");
    }
    const erc20 = new Contract(tokenAddress, ERC20_ABI, signer);
    const allowance = await erc20.allowance(account, spender);
    if (allowance < required) {
      const tx = await erc20.approve(spender, required);
      await tx.wait();
    }
  };

  const resetMessages = useCallback(() => {
    setError("");
    setStatus("");
  }, []);

  const loadActivityLogs = useCallback(async () => {
    if (!activityEnabled) {
      setActivityLogs([]);
      return;
    }
    try {
      const response = await fetch("/api/activity");
      if (!response.ok) {
        console.error("Failed to fetch activity logs");
        return;
      }
      const payload = (await response.json()) as { data?: ActivityLogEntry[] };
      setActivityLogs(payload.data ?? []);
    } catch (err) {
      console.error(err);
    }
  }, [activityEnabled]);

  const logActivity = useCallback(
    async (payload: CreateActivityPayload) => {
      if (!activityEnabled || !signer || !account) {
        return;
      }
      try {
        const nonce = Date.now().toString();
        const message = buildActivityMessage({
          ...payload,
          account,
          nonce,
        });
        const signature = await signer.signMessage(message);
        const response = await fetch("/api/activity", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...payload,
            account,
            nonce,
            signature,
          }),
        });
        if (!response.ok) {
          const body = (await response.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? "Failed to log activity");
        }
        await loadActivityLogs();
      } catch (err) {
        console.error("Activity log failed", err);
      }
    },
    [account, activityEnabled, loadActivityLogs, signer],
  );

  const loadSnapshot = useCallback(async () => {
    if (!guardianVaultAddress || !readProvider) {
      return;
    }
    try {
      const vault = getGuardianVaultContract(readProvider);
      const [nextId, approvals, balance] = await Promise.all([
        vault.nextRequestId(),
        vault.approvalsRequired(),
        readProvider.getBalance(guardianVaultAddress),
      ]);

      setThreshold(Number(approvals));
      setVaultBalance(formatEther(balance));

      const latestId = Number(nextId);
      if (latestId <= 1) {
        setWithdrawals([]);
        return;
      }

      const start = Math.max(1, latestId - MAX_HISTORY);
      const ids = Array.from({ length: latestId - start }, (_, idx) => BigInt(start + idx));
      if (ids.length === 0) {
        setWithdrawals([]);
        return;
      }
      const responses = await Promise.all(ids.map((id) => vault.getWithdrawal(id)));
      const rows = responses
        .map((data, idx) => ({ id: ids[idx], data }))
        .filter((row) => row.data.amount > 0n)
        .reverse();
      setWithdrawals(rows);
    } catch (err) {
      console.error(err);
      setError((err as Error).message);
    }
  }, [readProvider]);

  const loadSwapSnapshot = useCallback(async () => {
    if (!simpleSwapConfigured || !readProvider) {
      setSwapSnapshot({ reserve0: "0", reserve1: "0", totalSupply: "0" });
      return;
    }
    try {
      const snapshot = await fetchSimpleSwapSnapshot(readProvider);
      setSwapSnapshot({
        reserve0: formatUnits(snapshot.reserve0, tokenMetadata.token0.decimals),
        reserve1: formatUnits(snapshot.reserve1, tokenMetadata.token1.decimals),
        totalSupply: formatUnits(snapshot.totalSupply, 18),
      });
    } catch (err) {
      console.error(err);
      setError((err as Error).message);
    }
  }, [readProvider, simpleSwapConfigured]);

  const loadUserLpBalance = useCallback(async () => {
    if (!account || !readProvider || !simpleSwapConfigured) {
      setUserLpBalance("0");
      return;
    }
    try {
      const contract = getSimpleSwapContract(readProvider);
      const balance = await contract.balanceOf(account);
      setUserLpBalance(formatUnits(balance, 18));
    } catch (err) {
      console.error(err);
    }
  }, [account, readProvider, simpleSwapConfigured]);

  const loadStakingSnapshot = useCallback(async () => {
    if (!stakingConfigured || !readProvider) {
      setPendingRewards("0");
      setStakedBalance("0");
      return;
    }
    try {
      const contract = getStakingPoolContract(readProvider);
      const [userInfo, pending] = await Promise.all([
        account ? contract.userInfo(account) : Promise.resolve({ amount: 0n, rewardDebt: 0n }),
        account ? contract.pendingReward(account) : Promise.resolve(0n),
      ]);
      setStakedBalance(formatUnits(userInfo.amount ?? 0n, stakingMetadata.stakingToken.decimals));
      setPendingRewards(formatUnits(pending ?? 0n, stakingMetadata.rewardToken.decimals));
    } catch (err) {
      console.error(err);
    }
  }, [account, readProvider, stakingConfigured]);

  const loadLendingSnapshot = useCallback(async () => {
    if (!lendingConfigured || !readProvider) {
      setLendingSnapshot({
        collateral: "0",
        debt: "0",
        borrowLimit: "0",
        healthFactor: "-",
        availableLiquidity: "0",
        utilization: "0%",
        totalCollateral: "0",
        totalBorrows: "0",
        collateralPrice: "-",
        debtPrice: "-",
      });
      return;
    }
    try {
      const contract = getLendingPoolContract(readProvider);
      const [poolData, accountData, priceData] = await Promise.all([
        contract.getPoolData(),
        account ? contract.getAccountData(account) : Promise.resolve<[bigint, bigint, bigint, bigint]>([0n, 0n, 0n, 0n]),
        contract.getPriceData(),
      ]);
      const [poolCollateral, poolBorrows, availableLiquidityRaw, utilizationRaw] = poolData;
      const [collateralRaw, debtRaw, healthRaw, borrowLimitRaw] = accountData;
      const [collateralPriceRaw, debtPriceRaw] = priceData;
      setLendingSnapshot({
        collateral: formatLendingAmount(collateralRaw, lendingMetadata.collateralToken.decimals),
        debt: formatLendingAmount(debtRaw, lendingMetadata.debtToken.decimals),
        borrowLimit: formatLendingAmount(borrowLimitRaw, lendingMetadata.debtToken.decimals),
        healthFactor: formatHealthFactorDisplay(healthRaw, debtRaw > 0n),
        availableLiquidity: formatLendingAmount(
          availableLiquidityRaw,
          lendingMetadata.debtToken.decimals,
        ),
        utilization: formatPercentDisplay(utilizationRaw),
        totalCollateral: formatLendingAmount(
          poolCollateral,
          lendingMetadata.collateralToken.decimals,
        ),
        totalBorrows: formatLendingAmount(poolBorrows, lendingMetadata.debtToken.decimals),
        collateralPrice: formatUsdDisplay(collateralPriceRaw),
        debtPrice: formatUsdDisplay(debtPriceRaw),
      });
    } catch (err) {
      console.error(err);
    }
  }, [account, lendingConfigured, readProvider]);

  useEffect(() => {
    loadSnapshot();
  }, [loadSnapshot]);

  useEffect(() => {
    loadSwapSnapshot();
  }, [loadSwapSnapshot]);

  useEffect(() => {
    loadUserLpBalance();
  }, [loadUserLpBalance]);

  useEffect(() => {
    loadStakingSnapshot();
  }, [loadStakingSnapshot]);

  useEffect(() => {
    loadLendingSnapshot();
  }, [loadLendingSnapshot]);

  useEffect(() => {
    if (!walletConnectProvider) {
      return;
    }
    const handleAccountsChanged = async (accounts: string[]) => {
      if (!accounts || accounts.length === 0) {
        await disconnectWallet();
        return;
      }
      try {
        const browserProvider = new BrowserProvider(walletConnectProvider as unknown as Eip1193Provider);
        const walletSigner = await browserProvider.getSigner();
        setSigner(walletSigner);
        setAccount(normalizeAccount(accounts[0]!));
      } catch (err) {
        console.error("WalletConnect account change handling failed", err);
      }
    };

    const handleDisconnect = () => {
      setWalletConnectProvider(null);
      setSigner(null);
      setAccount("");
      setConnectionMethod(null);
      setStatus("WalletConnect が切断されました。");
    };

    walletConnectProvider.on("accountsChanged", handleAccountsChanged);
    walletConnectProvider.on("disconnect", handleDisconnect);

    return () => {
      walletConnectProvider.removeListener("accountsChanged", handleAccountsChanged);
      walletConnectProvider.removeListener("disconnect", handleDisconnect);
    };
  }, [disconnectWallet, normalizeAccount, walletConnectProvider]);

  useEffect(() => {
    loadActivityLogs();
  }, [loadActivityLogs]);

  const connectWallet = useCallback(async () => {
    resetMessages();
    if (!window.ethereum) {
      setError("MetaMask などの EVM ウォレットが必要です。");
      return;
    }
    try {
      if (walletConnectProvider) {
        await walletConnectProvider.disconnect();
        setWalletConnectProvider(null);
      }
      const provider = new BrowserProvider(window.ethereum as unknown as Eip1193Provider);
      await provider.send("eth_requestAccounts", []);
      const walletSigner = await provider.getSigner();
      setSigner(walletSigner);
      const address = await walletSigner.getAddress();
      setAccount(normalizeAccount(address));
      setConnectionMethod("metamask");
      setStatus("MetaMask と接続しました。");
    } catch (err) {
      setError((err as Error).message);
    }
  }, [walletConnectProvider, resetMessages, normalizeAccount]);

  const connectWalletConnect = useCallback(async () => {
    resetMessages();
    if (!walletConnectProjectId) {
      setError("NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID を設定してください。");
      return;
    }
    try {
      if (walletConnectProvider) {
        await walletConnectProvider.disconnect();
      }
      const provider = await EthereumProvider.init({
        projectId: walletConnectProjectId,
        showQrModal: true,
        chains: supportedChainIds,
        optionalChains: supportedChainIds,
        methods: [
          "eth_sendTransaction",
          "eth_sign",
          "personal_sign",
          "eth_signTypedData",
          "eth_signTransaction",
        ],
        events: ["accountsChanged", "chainChanged", "disconnect"],
        rpcMap: walletConnectRpcMap,
      });
      await provider.enable();
      const browserProvider = new BrowserProvider(provider as unknown as Eip1193Provider);
      const walletSigner = await browserProvider.getSigner();
      setSigner(walletSigner);
      const address = await walletSigner.getAddress();
      setAccount(normalizeAccount(address));
      setWalletConnectProvider(provider);
      setConnectionMethod("walletconnect");
      setStatus("WalletConnect で接続しました。");
    } catch (err) {
      console.error(err);
      setError((err as Error).message ?? "WalletConnect 接続に失敗しました。");
    }
  }, [
    normalizeAccount,
    resetMessages,
    supportedChainIds,
    walletConnectProjectId,
    walletConnectProvider,
    walletConnectRpcMap,
  ]);

  const disconnectWallet = useCallback(async () => {
    resetMessages();
    try {
      if (connectionMethod === "walletconnect" && walletConnectProvider) {
        await walletConnectProvider.disconnect();
        setWalletConnectProvider(null);
      }
      setSigner(null);
      setAccount("");
      setConnectionMethod(null);
      setStatus("ウォレット接続を解除しました。");
    } catch (err) {
      console.error(err);
      setError((err as Error).message ?? "ウォレット接続の解除に失敗しました。");
    }
  }, [connectionMethod, resetMessages, walletConnectProvider]);

  const ensureSigner = () => {
    if (!signer) {
      throw new Error("先にウォレットを接続してください。");
    }
    return getGuardianVaultContract(signer);
  };

  const handleCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    resetMessages();
    if (!guardianVaultAddress) {
      setError("NEXT_PUBLIC_GUARDIAN_VAULT_ADDRESS を設定してください。");
      return;
    }
    if (!formData.amount || !formData.recipient) {
      setError("受取人と金額を入力してください。");
      return;
    }
    if (!isAddress(formData.recipient)) {
      setError("受取人アドレスが不正です。");
      return;
    }
    requireAccount();
    const recipient = formData.recipient;
    const amountLabel = formData.amount;
    const amountWei = parseEther(formData.amount);
    const expiryMinutes = formData.expiryMinutes.trim() ? Number(formData.expiryMinutes) : 0;
    if (Number.isNaN(expiryMinutes) || expiryMinutes < 0) {
      setError("期限は 0 以上の数値で入力してください。");
      return;
    }
    const expiry = expiryMinutes
      ? BigInt(Math.floor(Date.now() / 1000) + expiryMinutes * 60)
      : 0n;

    try {
      setBusy(true);
      const contract = ensureSigner();
      const tx = await contract.createWithdrawal(ZeroAddress, formData.recipient, amountWei, expiry);
      await tx.wait();
      setStatus("出金リクエストを作成しました。");
      await logActivity({
        category: "guardian",
        description: `出金リクエスト ${amountLabel} ETH → ${shorten(recipient)}`,
        txHash: tx.hash,
      });
      setFormData({ recipient: "", amount: "", expiryMinutes: "" });
      await loadSnapshot();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleApproval = async (id: bigint) => {
    resetMessages();
    requireAccount();
    try {
      setBusy(true);
      const contract = ensureSigner();
      const tx = await contract.approveWithdrawal(id);
      await tx.wait();
      setStatus(`リクエスト #${id.toString()} を承認しました。`);
      await logActivity({
        category: "guardian",
        description: `リクエスト #${id.toString()} を承認`,
        txHash: tx.hash,
      });
      await loadSnapshot();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleExecute = async (id: bigint) => {
    resetMessages();
    requireAccount();
    try {
      setBusy(true);
      const contract = ensureSigner();
      const tx = await contract.executeWithdrawal(id);
      await tx.wait();
      setStatus(`リクエスト #${id.toString()} を実行しました。`);
      await logActivity({
        category: "guardian",
        description: `リクエスト #${id.toString()} を実行`,
        txHash: tx.hash,
      });
      await loadSnapshot();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleAddLiquidity = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    resetMessages();
    if (!simpleSwapConfigured) {
      setError("SimpleSwap の設定を確認してください。");
      return;
    }
    const amount0 = parseTokenAmount(liquidityForm.amount0, "token0");
    const amount1 = parseTokenAmount(liquidityForm.amount1, "token1");
    if (amount0 === 0n || amount1 === 0n) {
      setError("両トークンの金額を入力してください。");
      return;
    }
    const minShares = liquidityForm.minShares ? parseUnits(liquidityForm.minShares, 18) : 0n;
    try {
      setBusy(true);
      const walletAccount = requireAccount();
      await ensureTokenAllowance(tokenMetadata.token0.address, simpleSwapAddress, amount0);
      await ensureTokenAllowance(tokenMetadata.token1.address, simpleSwapAddress, amount1);
      const contract = ensureSimpleSwapContract();
      const tx = await contract.addLiquidity(amount0, amount1, minShares, walletAccount);
      await tx.wait();
      setStatus("流動性を追加しました。");
      await logActivity({
        category: "liquidity",
        description: `流動性追加 ${liquidityForm.amount0 || "0"} ${tokenMetadata.token0.symbol} / ${liquidityForm.amount1 || "0"} ${tokenMetadata.token1.symbol}`,
        txHash: tx.hash,
      });
      setLiquidityForm({ amount0: "", amount1: "", minShares: "" });
      await Promise.all([loadSwapSnapshot(), loadUserLpBalance()]);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleRemoveLiquidity = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    resetMessages();
    if (!simpleSwapConfigured) {
      setError("SimpleSwap の設定を確認してください。");
      return;
    }
    const shares = removeForm.shares ? parseUnits(removeForm.shares, 18) : 0n;
    if (shares === 0n) {
      setError("引き出す LP 数量を入力してください。");
      return;
    }
    const minAmount0 = parseTokenAmount(removeForm.minAmount0, "token0");
    const minAmount1 = parseTokenAmount(removeForm.minAmount1, "token1");
    try {
      setBusy(true);
      const walletAccount = requireAccount();
      const contract = ensureSimpleSwapContract();
      const tx = await contract.removeLiquidity(shares, minAmount0, minAmount1, walletAccount);
      await tx.wait();
      setStatus("流動性を引き出しました。");
      await logActivity({
        category: "liquidity",
        description: `流動性除去 ${removeForm.shares || "0"} LP`,
        txHash: tx.hash,
      });
      setRemoveForm({ shares: "", minAmount0: "", minAmount1: "" });
      await Promise.all([loadSwapSnapshot(), loadUserLpBalance()]);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleSwap = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    resetMessages();
    if (!simpleSwapConfigured) {
      setError("SimpleSwap の設定を確認してください。");
      return;
    }
    const inputSide: TokenSide = swapForm.direction === "token0ToToken1" ? "token0" : "token1";
    const outputSide: TokenSide = inputSide === "token0" ? "token1" : "token0";
    const amountIn = parseTokenAmount(swapForm.amountIn, inputSide);
    if (amountIn === 0n) {
      setError("スワップ金額を入力してください。");
      return;
    }
    const minAmountOut = parseTokenAmount(swapForm.minAmountOut, outputSide);
    try {
      setBusy(true);
      const walletAccount = requireAccount();
      await ensureTokenAllowance(tokenMetadata[inputSide].address, simpleSwapAddress, amountIn);
      const contract = ensureSimpleSwapContract();
      const tx = await contract.swap(
        tokenMetadata[inputSide].address,
        amountIn,
        minAmountOut,
        walletAccount,
      );
      await tx.wait();
      setStatus("スワップが完了しました。");
      await logActivity({
        category: "swap",
        description: `${tokenMetadata[inputSide].symbol} → ${tokenMetadata[outputSide].symbol} をスワップ (${swapForm.amountIn || "0"})`,
        txHash: tx.hash,
      });
      setSwapForm((prev) => ({ ...prev, amountIn: "", minAmountOut: "" }));
      await Promise.all([loadSwapSnapshot(), loadUserLpBalance()]);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const toggleSwapDirection = () => {
    setSwapForm((prev) => ({
      ...prev,
      direction: prev.direction === "token0ToToken1" ? "token1ToToken0" : "token0ToToken1",
    }));
  };

  const handleStakingDeposit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    resetMessages();
    if (!stakingConfigured) {
      setError("StakingPool の設定を確認してください。");
      return;
    }
    const amount = stakingAmount.deposit
      ? parseUnits(stakingAmount.deposit, stakingMetadata.stakingToken.decimals)
      : 0n;
    if (amount === 0n) {
      setError("ステーク金額を入力してください。");
      return;
    }
    try {
      setBusy(true);
      requireAccount();
      await ensureTokenAllowance(
        stakingMetadata.stakingToken.address,
        stakingMetadata.poolAddress,
        amount,
      );
      const contract = ensureStakingContract();
      const tx = await contract.deposit(amount);
      await tx.wait();
      setStatus("ステーキングが完了しました。");
      await logActivity({
        category: "staking",
        description: `${stakingAmount.deposit} ${stakingMetadata.stakingToken.symbol} をステーク`,
        txHash: tx.hash,
      });
      setStakingAmount((prev) => ({ ...prev, deposit: "" }));
      await loadStakingSnapshot();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleStakingWithdraw = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    resetMessages();
    if (!stakingConfigured) {
      setError("StakingPool の設定を確認してください。");
      return;
    }
    const amount = stakingAmount.withdraw
      ? parseUnits(stakingAmount.withdraw, stakingMetadata.stakingToken.decimals)
      : 0n;
    if (amount === 0n) {
      setError("引き出す金額を入力してください。");
      return;
    }
    try {
      setBusy(true);
      requireAccount();
      const contract = ensureStakingContract();
      const tx = await contract.withdraw(amount);
      await tx.wait();
      setStatus("ステーキングを引き出しました。");
      await logActivity({
        category: "staking",
        description: `${stakingAmount.withdraw} ${stakingMetadata.stakingToken.symbol} を引き出し`,
        txHash: tx.hash,
      });
      setStakingAmount((prev) => ({ ...prev, withdraw: "" }));
      await loadStakingSnapshot();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleLendingDeposit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    resetMessages();
    if (!lendingConfigured) {
      setError("LendingPool の設定を確認してください。");
      return;
    }
    const amount = lendingForms.deposit
      ? parseUnits(lendingForms.deposit, lendingMetadata.collateralToken.decimals)
      : 0n;
    if (amount === 0n) {
      setError("預け入れる担保量を入力してください。");
      return;
    }
    try {
      setBusy(true);
      requireAccount();
      await ensureTokenAllowance(
        lendingMetadata.collateralToken.address,
        lendingMetadata.poolAddress,
        amount,
      );
      const contract = ensureLendingContract();
      const tx = await contract.depositCollateral(amount);
      await tx.wait();
      setStatus("担保を預け入れました。");
      await logActivity({
        category: "lending",
        description: `${lendingForms.deposit} ${lendingMetadata.collateralToken.symbol} を担保として預け入れ`,
        txHash: tx.hash,
      });
      setLendingForms((prev) => ({ ...prev, deposit: "" }));
      await loadLendingSnapshot();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleLendingWithdraw = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    resetMessages();
    if (!lendingConfigured) {
      setError("LendingPool の設定を確認してください。");
      return;
    }
    const amount = lendingForms.withdraw
      ? parseUnits(lendingForms.withdraw, lendingMetadata.collateralToken.decimals)
      : 0n;
    if (amount === 0n) {
      setError("引き出す担保量を入力してください。");
      return;
    }
    try {
      setBusy(true);
      requireAccount();
      const contract = ensureLendingContract();
      const tx = await contract.withdrawCollateral(amount);
      await tx.wait();
      setStatus("担保を引き出しました。");
      await logActivity({
        category: "lending",
        description: `${lendingForms.withdraw} ${lendingMetadata.collateralToken.symbol} の担保を引き出し`,
        txHash: tx.hash,
      });
      setLendingForms((prev) => ({ ...prev, withdraw: "" }));
      await loadLendingSnapshot();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleLendingBorrow = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    resetMessages();
    if (!lendingConfigured) {
      setError("LendingPool の設定を確認してください。");
      return;
    }
    const amount = lendingForms.borrow
      ? parseUnits(lendingForms.borrow, lendingMetadata.debtToken.decimals)
      : 0n;
    if (amount === 0n) {
      setError("借入額を入力してください。");
      return;
    }
    try {
      setBusy(true);
      requireAccount();
      const contract = ensureLendingContract();
      const tx = await contract.borrow(amount);
      await tx.wait();
      setStatus("借入が完了しました。");
      await logActivity({
        category: "lending",
        description: `${lendingForms.borrow} ${lendingMetadata.debtToken.symbol} を借入`,
        txHash: tx.hash,
      });
      setLendingForms((prev) => ({ ...prev, borrow: "" }));
      await loadLendingSnapshot();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleLendingRepay = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    resetMessages();
    if (!lendingConfigured) {
      setError("LendingPool の設定を確認してください。");
      return;
    }
    const amount = lendingForms.repay
      ? parseUnits(lendingForms.repay, lendingMetadata.debtToken.decimals)
      : 0n;
    if (amount === 0n) {
      setError("返済額を入力してください。");
      return;
    }
    try {
      setBusy(true);
      requireAccount();
      await ensureTokenAllowance(
        lendingMetadata.debtToken.address,
        lendingMetadata.poolAddress,
        amount,
      );
      const contract = ensureLendingContract();
      const tx = await contract.repay(amount);
      await tx.wait();
      setStatus("返済が完了しました。");
      await logActivity({
        category: "lending",
        description: `${lendingForms.repay} ${lendingMetadata.debtToken.symbol} を返済`,
        txHash: tx.hash,
      });
      setLendingForms((prev) => ({ ...prev, repay: "" }));
      await loadLendingSnapshot();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const formatAmount = (entry: WithdrawalEntry) => {
    if (entry.data.asset === ZeroAddress) {
      const ethAmount = parseFloat(formatEther(entry.data.amount));
      return `${ethAmount.toFixed(4)} ETH`;
    }
    return `${entry.data.amount.toString()} (ERC20)`;
  };

  const formatDeadline = (deadline: bigint) => {
    if (deadline === 0n) return "期限なし";
    const date = new Date(Number(deadline) * 1000);
    return date.toLocaleString();
  };

  const parseTokenAmount = (value: string, side: TokenSide) => {
    if (!value.trim()) return 0n;
    const decimals = tokenMetadata[side].decimals;
    return parseUnits(value, decimals);
  };

  const formatTokenDisplay = (value: string, side: TokenSide) =>
    `${value} ${tokenMetadata[side].symbol}`;
  const formatStakingToken = (value: string, token: "staking" | "reward") => {
    const meta = token === "staking" ? stakingMetadata.stakingToken : stakingMetadata.rewardToken;
    return `${value} ${meta.symbol}`;
  };
  const formatLendingToken = (value: string, token: "collateral" | "debt") => {
    const meta = token === "collateral" ? lendingMetadata.collateralToken : lendingMetadata.debtToken;
    return `${value} ${meta.symbol}`;
  };
  const formatLendingAmount = (raw: bigint, decimals: number) => {
    const numeric = Number(formatUnits(raw, decimals));
    return Number.isFinite(numeric) ? numeric.toFixed(4) : "0.0000";
  };
  const formatHealthFactorDisplay = (raw: bigint, hasDebt: boolean) => {
    if (!hasDebt) {
      return "-";
    }
    const numeric = Number(formatUnits(raw, 18));
    if (!Number.isFinite(numeric)) {
      return "-";
    }
    return `${Math.min(numeric, 999).toFixed(2)}x`;
  };
  const formatPercentDisplay = (raw: bigint) => {
    const numeric = Number(formatUnits(raw, 18)) * 100;
    return Number.isFinite(numeric) ? `${numeric.toFixed(1)}%` : "0%";
  };
  const formatUsdDisplay = (raw: bigint) => {
    const numeric = Number(formatUnits(raw, 18));
    if (!Number.isFinite(numeric)) {
      return "-";
    }
    return `$${numeric.toFixed(4)}`;
  };
  const formatTimestamp = (value: string) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return value;
    }
    return date.toLocaleString("ja-JP", { hour12: false });
  };

  const shorten = (value: string) => `${value.slice(0, 6)}…${value.slice(-4)}`;
  const normalizeAccount = useCallback((value: string) => {
    try {
      return getAddress(value);
    } catch (err) {
      console.warn("Failed to normalize address", err);
      return value;
    }
  }, []);
  const activityCategoryLabels: Record<ActivityCategory, string> = {
    guardian: "マルチシグ",
    swap: "スワップ",
    liquidity: "流動性",
    staking: "ステーキング",
    lending: "レンディング",
    system: "システム",
  };

  const guardrailMessage = !guardianVaultAddress || !rpcUrl;
  const simpleSwapGuardrail = !simpleSwapConfigured || !rpcUrl;
  const stakingGuardrail = !stakingConfigured || !rpcUrl;
  const lendingGuardrail = !lendingConfigured || !rpcUrl;
  const swapDirectionLabel =
    swapForm.direction === "token0ToToken1"
      ? `${tokenMetadata.token0.symbol} → ${tokenMetadata.token1.symbol}`
      : `${tokenMetadata.token1.symbol} → ${tokenMetadata.token0.symbol}`;

  const requireAccount = () => {
    if (!account) {
      throw new Error("ウォレットを接続してください。");
    }
    return account;
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <div className="mx-auto flex max-w-5xl flex-col gap-8 px-6 py-10">
        <header className="space-y-3">
          <p className="text-sm uppercase tracking-widest text-emerald-400">Guardian Vault</p>
          <h1 className="text-3xl font-semibold">マルチシグ金庫ダッシュボード</h1>
          <p className="text-sm text-slate-300">
            Pausable なマルチシグ金庫の状況確認と、ETH 出金リクエストの作成・承認・実行を行えます。
          </p>
        </header>

        {guardrailMessage && (
          <div className="rounded border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
            <p className="font-semibold text-amber-300">環境変数が未設定です。</p>
            <p className="text-amber-100">NEXT_PUBLIC_RPC_URL と NEXT_PUBLIC_GUARDIAN_VAULT_ADDRESS を設定してください。</p>
          </div>
        )}

        {(error || status) && (
          <div
            className={`rounded border p-3 text-sm ${
              error ? "border-red-500/40 bg-red-500/10 text-red-200" : "border-emerald-500/40 bg-emerald-500/10 text-emerald-100"
            }`}
          >
            {error || status}
          </div>
        )}

        <section className="grid gap-4 sm:grid-cols-3">
          <div className="rounded-xl border border-white/10 bg-white/5 p-4">
            <p className="text-xs text-slate-300">金庫アドレス</p>
            <p className="truncate text-lg font-semibold">{guardianVaultAddress || "未設定"}</p>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/5 p-4">
            <p className="text-xs text-slate-300">必要承認数</p>
            <p className="text-3xl font-semibold">{threshold || "-"}</p>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/5 p-4">
            <p className="text-xs text-slate-300">ETH 残高</p>
            <p className="text-3xl font-semibold">{formattedBalance} ETH</p>
          </div>
        </section>

        <section className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-white/10 bg-white/5 p-4">
          <div>
            <p className="text-xs text-slate-300">接続中ウォレット</p>
            <p className="text-lg font-semibold">{account ? shorten(account) : "未接続"}</p>
            <p className="text-xs text-slate-400">
              {connectionMethod === "walletconnect"
                ? "WalletConnect"
                : connectionMethod === "metamask"
                  ? "MetaMask"
                  : "未接続"}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              className="rounded bg-emerald-500 px-5 py-2 text-sm font-semibold text-black transition hover:bg-emerald-400 disabled:opacity-40"
              onClick={connectWallet}
              disabled={busy}
            >
              MetaMask 接続
            </button>
            <button
              className="rounded border border-emerald-400 px-5 py-2 text-sm font-semibold text-emerald-200 transition hover:border-emerald-300 hover:text-emerald-100 disabled:opacity-40"
              onClick={connectWalletConnect}
              disabled={busy || !walletConnectProjectId}
            >
              WalletConnect
            </button>
            {account && (
              <button
                className="rounded border border-white/30 px-4 py-2 text-sm text-slate-200 transition hover:border-white/60"
                onClick={disconnectWallet}
                disabled={busy}
              >
                切断
              </button>
            )}
          </div>
        </section>

        {activityEnabled && (
          <section className="rounded-2xl border border-white/10 bg-white/5 p-6">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold">最新アクティビティ</h2>
                <p className="text-sm text-slate-300">Supabase activity_logs テーブルの最新 25 件を表示します。</p>
              </div>
              <button
                className="rounded border border-white/30 px-3 py-1 text-xs text-slate-200 transition hover:border-white/60"
                onClick={loadActivityLogs}
              >
                再読込
              </button>
            </div>
            {activityLogs.length === 0 ? (
              <p className="text-sm text-slate-400">まだ記録がありません。</p>
            ) : (
              <ul className="space-y-3">
                {activityLogs.map((entry) => (
                  <li key={entry.id} className="rounded border border-white/10 bg-slate-950/40 p-3">
                    <div className="flex items-center justify-between text-xs text-slate-400">
                      <span className="font-semibold text-emerald-300">
                        {activityCategoryLabels[entry.category] ?? entry.category}
                      </span>
                      <span>{formatTimestamp(entry.created_at)}</span>
                    </div>
                    <p className="mt-1 text-sm text-slate-100">{entry.description}</p>
                    <div className="mt-1 flex flex-wrap gap-3 text-[11px] text-slate-400">
                      {entry.account && <span>by {shorten(entry.account)}</span>}
                      {entry.txHash && explorerBaseUrl && (
                        <a
                          href={`${explorerBaseUrl}/tx/${entry.txHash}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-emerald-300 underline"
                        >
                          Tx を開く
                        </a>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        <section className="rounded-2xl border border-white/10 bg-white/5 p-6">
          <h2 className="mb-4 text-xl font-semibold">ETH 出金リクエストを作成</h2>
          <form className="grid gap-4" onSubmit={handleCreate}>
            <label className="text-sm">
              <span className="mb-1 block text-slate-300">受取人アドレス</span>
              <input
                className="w-full rounded border border-white/20 bg-slate-900/60 p-2 text-sm focus:border-emerald-400 focus:outline-none"
                value={formData.recipient}
                onChange={(e) => setFormData((prev) => ({ ...prev, recipient: e.target.value }))}
                placeholder="0x..."
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-slate-300">金額 (ETH)</span>
              <input
                className="w-full rounded border border-white/20 bg-slate-900/60 p-2 text-sm focus:border-emerald-400 focus:outline-none"
                value={formData.amount}
                onChange={(e) => setFormData((prev) => ({ ...prev, amount: e.target.value }))}
                placeholder="1.0"
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-slate-300">期限 (分, 任意)</span>
              <input
                className="w-full rounded border border-white/20 bg-slate-900/60 p-2 text-sm focus:border-emerald-400 focus:outline-none"
                value={formData.expiryMinutes}
                onChange={(e) => setFormData((prev) => ({ ...prev, expiryMinutes: e.target.value }))}
                placeholder="60"
              />
            </label>
            <button
              type="submit"
              className="rounded bg-emerald-500 px-6 py-2 text-sm font-semibold text-black transition hover:bg-emerald-400 disabled:opacity-40"
              disabled={busy}
            >
              リクエストを送信
            </button>
          </form>
        </section>

        <section className="rounded-2xl border border-white/10 bg-white/5 p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-xl font-semibold">最新のリクエスト</h2>
            <button
              className="text-sm text-emerald-300 hover:underline disabled:opacity-40"
              onClick={loadSnapshot}
              disabled={busy}
            >
              更新
            </button>
          </div>
          {withdrawals.length === 0 ? (
            <p className="text-sm text-slate-300">保留中のリクエストはありません。</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="text-slate-300">
                    <th className="pb-2">ID</th>
                    <th className="pb-2">受取人</th>
                    <th className="pb-2">金額</th>
                    <th className="pb-2">期限</th>
                    <th className="pb-2">承認状況</th>
                    <th className="pb-2">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {withdrawals.map((entry) => {
                    const approved = Number(entry.data.approvals);
                    const isActive = !entry.data.executed && !entry.data.cancelled;
                    const canExecute = isActive && approved >= threshold;
                    return (
                      <tr key={entry.id.toString()} className="align-top">
                        <td className="py-2">#{entry.id.toString()}</td>
                        <td className="py-2">
                          <div className="font-mono text-xs">{shorten(entry.data.to)}</div>
                        </td>
                        <td className="py-2">{formatAmount(entry)}</td>
                        <td className="py-2">{formatDeadline(entry.data.deadline)}</td>
                        <td className="py-2">
                          <span className="text-xs text-slate-300">
                            {approved}/{threshold} 承認
                          </span>
                          <div className="text-xs text-slate-400">
                            {entry.data.executed
                              ? "実行済み"
                              : entry.data.cancelled
                                ? "キャンセル済み"
                                : "承認待ち"}
                          </div>
                        </td>
                        <td className="py-2">
                          <div className="flex flex-wrap gap-2">
                            <button
                              className="rounded border border-white/30 px-3 py-1 text-xs hover:border-emerald-400 disabled:opacity-40"
                              onClick={() => handleApproval(entry.id)}
                              disabled={!isActive || busy}
                            >
                              承認
                            </button>
                            <button
                              className="rounded bg-emerald-500 px-3 py-1 text-xs font-semibold text-black hover:bg-emerald-400 disabled:opacity-40"
                              onClick={() => handleExecute(entry.id)}
                              disabled={!canExecute || busy}
                            >
                              実行
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-white/10 bg-white/5 p-6">
          <div className="mb-4 space-y-1">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold">SimpleSwap プール</h2>
              <span className="text-xs text-slate-400">LP トークン: GLP</span>
            </div>
            <p className="text-sm text-slate-300">
              {tokenMetadata.token0.symbol}/{tokenMetadata.token1.symbol} の流動性を追加・削除し、固定積 AMM でスワップできます。
            </p>
          </div>

          {simpleSwapGuardrail ? (
            <div className="rounded border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-100">
              SimpleSwap 用の環境変数 (アドレス/トークン情報) を設定してください。
            </div>
          ) : (
            <div className="space-y-6">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-xl border border-white/10 bg-slate-900/40 p-4">
                  <p className="text-xs text-slate-300">リザーブ ({tokenMetadata.token0.symbol})</p>
                  <p className="text-lg font-semibold">
                    {formatTokenDisplay(swapSnapshot.reserve0, "token0")}
                  </p>
                </div>
                <div className="rounded-xl border border-white/10 bg-slate-900/40 p-4">
                  <p className="text-xs text-slate-300">リザーブ ({tokenMetadata.token1.symbol})</p>
                  <p className="text-lg font-semibold">
                    {formatTokenDisplay(swapSnapshot.reserve1, "token1")}
                  </p>
                </div>
                <div className="rounded-xl border border-white/10 bg-slate-900/40 p-4">
                  <p className="text-xs text-slate-300">LP 総供給</p>
                  <p className="text-lg font-semibold">{swapSnapshot.totalSupply} GLP</p>
                </div>
                <div className="rounded-xl border border-white/10 bg-slate-900/40 p-4">
                  <p className="text-xs text-slate-300">あなたの LP</p>
                  <p className="text-lg font-semibold">{formattedLpBalance} GLP</p>
                </div>
              </div>

              <div className="grid gap-6 lg:grid-cols-3">
                <div className="rounded-xl border border-white/10 bg-slate-900/40 p-4">
                  <h3 className="mb-3 text-base font-semibold">流動性を追加</h3>
                  <form className="grid gap-3 text-sm" onSubmit={handleAddLiquidity}>
                    <label>
                      <span className="mb-1 block text-slate-300">{tokenMetadata.token0.symbol} 金額</span>
                      <input
                        className="w-full rounded border border-white/20 bg-slate-950/60 p-2 focus:border-emerald-400 focus:outline-none"
                        value={liquidityForm.amount0}
                        onChange={(e) => setLiquidityForm((prev) => ({ ...prev, amount0: e.target.value }))}
                        placeholder="0.0"
                      />
                    </label>
                    <label>
                      <span className="mb-1 block text-slate-300">{tokenMetadata.token1.symbol} 金額</span>
                      <input
                        className="w-full rounded border border-white/20 bg-slate-950/60 p-2 focus:border-emerald-400 focus:outline-none"
                        value={liquidityForm.amount1}
                        onChange={(e) => setLiquidityForm((prev) => ({ ...prev, amount1: e.target.value }))}
                        placeholder="0.0"
                      />
                    </label>
                    <label>
                      <span className="mb-1 block text-slate-300">最小受取 LP (任意)</span>
                      <input
                        className="w-full rounded border border-white/20 bg-slate-950/60 p-2 focus:border-emerald-400 focus:outline-none"
                        value={liquidityForm.minShares}
                        onChange={(e) => setLiquidityForm((prev) => ({ ...prev, minShares: e.target.value }))}
                        placeholder="0"
                      />
                    </label>
                    <button
                      type="submit"
                      className="rounded bg-emerald-500 px-4 py-2 font-semibold text-black hover:bg-emerald-400 disabled:opacity-40"
                      disabled={busy}
                    >
                      追加する
                    </button>
                  </form>
                </div>

                <div className="rounded-xl border border-white/10 bg-slate-900/40 p-4">
                  <h3 className="mb-3 text-base font-semibold">流動性を引き出す</h3>
                  <form className="grid gap-3 text-sm" onSubmit={handleRemoveLiquidity}>
                    <label>
                      <span className="mb-1 block text-slate-300">バーンする LP 数量</span>
                      <input
                        className="w-full rounded border border-white/20 bg-slate-950/60 p-2 focus:border-emerald-400 focus:outline-none"
                        value={removeForm.shares}
                        onChange={(e) => setRemoveForm((prev) => ({ ...prev, shares: e.target.value }))}
                        placeholder="0.0"
                      />
                    </label>
                    <label>
                      <span className="mb-1 block text-slate-300">最小 {tokenMetadata.token0.symbol}</span>
                      <input
                        className="w-full rounded border border-white/20 bg-slate-950/60 p-2 focus:border-emerald-400 focus:outline-none"
                        value={removeForm.minAmount0}
                        onChange={(e) => setRemoveForm((prev) => ({ ...prev, minAmount0: e.target.value }))}
                        placeholder="0"
                      />
                    </label>
                    <label>
                      <span className="mb-1 block text-slate-300">最小 {tokenMetadata.token1.symbol}</span>
                      <input
                        className="w-full rounded border border-white/20 bg-slate-950/60 p-2 focus:border-emerald-400 focus:outline-none"
                        value={removeForm.minAmount1}
                        onChange={(e) => setRemoveForm((prev) => ({ ...prev, minAmount1: e.target.value }))}
                        placeholder="0"
                      />
                    </label>
                    <button
                      type="submit"
                      className="rounded bg-slate-100 px-4 py-2 font-semibold text-black hover:bg-slate-200 disabled:opacity-40"
                      disabled={busy}
                    >
                      引き出す
                    </button>
                  </form>
                </div>

                <div className="rounded-xl border border-white/10 bg-slate-900/40 p-4">
                  <h3 className="mb-3 text-base font-semibold">スワップ</h3>
                  <form className="grid gap-3 text-sm" onSubmit={handleSwap}>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-slate-300">方向</span>
                      <button
                        type="button"
                        className="text-xs text-emerald-300 hover:underline"
                        onClick={toggleSwapDirection}
                      >
                        {swapDirectionLabel}
                      </button>
                    </div>
                    <label>
                      <span className="mb-1 block text-slate-300">スワップ入力</span>
                      <input
                        className="w-full rounded border border-white/20 bg-slate-950/60 p-2 focus:border-emerald-400 focus:outline-none"
                        value={swapForm.amountIn}
                        onChange={(e) => setSwapForm((prev) => ({ ...prev, amountIn: e.target.value }))}
                        placeholder="0.0"
                      />
                    </label>
                    <label>
                      <span className="mb-1 block text-slate-300">最小受取 (任意)</span>
                      <input
                        className="w-full rounded border border-white/20 bg-slate-950/60 p-2 focus:border-emerald-400 focus:outline-none"
                        value={swapForm.minAmountOut}
                        onChange={(e) => setSwapForm((prev) => ({ ...prev, minAmountOut: e.target.value }))}
                        placeholder="0"
                      />
                    </label>
                    <button
                      type="submit"
                      className="rounded bg-emerald-500 px-4 py-2 font-semibold text-black hover:bg-emerald-400 disabled:opacity-40"
                      disabled={busy}
                    >
                      スワップする
                    </button>
                  </form>
                </div>
              </div>
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-white/10 bg-white/5 p-6">
          <div className="mb-4 space-y-1">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold">レンディングプール</h2>
              <span className="text-xs text-slate-400">
                担保: {lendingMetadata.collateralToken.symbol} / 借入: {lendingMetadata.debtToken.symbol}
              </span>
            </div>
            <p className="text-sm text-slate-300">
              担保トークンを預け入れて、最大 {lendingMetadata.debtToken.symbol} を借り入れできます。ヘルスファクターが 1.0 を下回ると清算対象になります。
            </p>
          </div>

          {lendingGuardrail ? (
            <div className="rounded border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-100">
              LendingPool 用の環境変数 (プール/担保/借入トークン) を設定してください。
            </div>
          ) : (
            <div className="space-y-6">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-xl border border-white/10 bg-slate-900/40 p-4">
                  <p className="text-xs text-slate-300">あなたの担保</p>
                  <p className="text-lg font-semibold">
                    {formatLendingToken(lendingSnapshot.collateral, "collateral")}
                  </p>
                </div>
                <div className="rounded-xl border border-white/10 bg-slate-900/40 p-4">
                  <p className="text-xs text-slate-300">あなたの借入残高</p>
                  <p className="text-lg font-semibold">
                    {formatLendingToken(lendingSnapshot.debt, "debt")}
                  </p>
                </div>
                <div className="rounded-xl border border-white/10 bg-slate-900/40 p-4">
                  <p className="text-xs text-slate-300">借入上限 (CF)</p>
                  <p className="text-lg font-semibold">
                    {formatLendingToken(lendingSnapshot.borrowLimit, "debt")}
                  </p>
                </div>
                <div className="rounded-xl border border-white/10 bg-slate-900/40 p-4">
                  <p className="text-xs text-slate-300">ヘルスファクター</p>
                  <p className="text-lg font-semibold">{lendingSnapshot.healthFactor}</p>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-xl border border-white/10 bg-slate-900/40 p-4">
                  <p className="text-xs text-slate-300">プール担保総額</p>
                  <p className="text-lg font-semibold">
                    {formatLendingToken(lendingSnapshot.totalCollateral, "collateral")}
                  </p>
                </div>
                <div className="rounded-xl border border-white/10 bg-slate-900/40 p-4">
                  <p className="text-xs text-slate-300">借入総額</p>
                  <p className="text-lg font-semibold">
                    {formatLendingToken(lendingSnapshot.totalBorrows, "debt")}
                  </p>
                </div>
                <div className="rounded-xl border border-white/10 bg-slate-900/40 p-4">
                  <p className="text-xs text-slate-300">利用可能流動性</p>
                  <p className="text-lg font-semibold">
                    {formatLendingToken(lendingSnapshot.availableLiquidity, "debt")}
                  </p>
                </div>
                <div className="rounded-xl border border-white/10 bg-slate-900/40 p-4">
                  <p className="text-xs text-slate-300">利用率</p>
                  <p className="text-lg font-semibold">{lendingSnapshot.utilization}</p>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="rounded-xl border border-white/10 bg-slate-900/40 p-4">
                  <p className="text-xs text-slate-300">担保トークン価格 (USD)</p>
                  <p className="text-lg font-semibold">{lendingSnapshot.collateralPrice}</p>
                </div>
                <div className="rounded-xl border border-white/10 bg-slate-900/40 p-4">
                  <p className="text-xs text-slate-300">借入トークン価格 (USD)</p>
                  <p className="text-lg font-semibold">{lendingSnapshot.debtPrice}</p>
                </div>
              </div>

              <div className="grid gap-6 lg:grid-cols-2">
                <div className="rounded-xl border border-white/10 bg-slate-900/40 p-4">
                  <h3 className="mb-3 text-base font-semibold">担保を預け入れ</h3>
                  <form className="grid gap-3 text-sm" onSubmit={handleLendingDeposit}>
                    <label>
                      <span className="mb-1 block text-slate-300">{lendingMetadata.collateralToken.symbol} 金額</span>
                      <input
                        className="w-full rounded border border-white/20 bg-slate-950/60 p-2 focus:border-emerald-400 focus:outline-none"
                        value={lendingForms.deposit}
                        onChange={(e) => setLendingForms((prev) => ({ ...prev, deposit: e.target.value }))}
                        placeholder="0.0"
                      />
                    </label>
                    <button
                      type="submit"
                      className="rounded bg-emerald-500 px-4 py-2 font-semibold text-black hover:bg-emerald-400 disabled:opacity-40"
                      disabled={busy}
                    >
                      預け入れる
                    </button>
                  </form>
                </div>

                <div className="rounded-xl border border-white/10 bg-slate-900/40 p-4">
                  <h3 className="mb-3 text-base font-semibold">担保を引き出す</h3>
                  <form className="grid gap-3 text-sm" onSubmit={handleLendingWithdraw}>
                    <label>
                      <span className="mb-1 block text-slate-300">{lendingMetadata.collateralToken.symbol} 金額</span>
                      <input
                        className="w-full rounded border border-white/20 bg-slate-950/60 p-2 focus:border-emerald-400 focus:outline-none"
                        value={lendingForms.withdraw}
                        onChange={(e) => setLendingForms((prev) => ({ ...prev, withdraw: e.target.value }))}
                        placeholder="0.0"
                      />
                    </label>
                    <button
                      type="submit"
                      className="rounded bg-slate-100 px-4 py-2 font-semibold text-black hover:bg-slate-200 disabled:opacity-40"
                      disabled={busy}
                    >
                      引き出す
                    </button>
                  </form>
                </div>
              </div>

              <div className="grid gap-6 lg:grid-cols-2">
                <div className="rounded-xl border border-white/10 bg-slate-900/40 p-4">
                  <h3 className="mb-3 text-base font-semibold">借入</h3>
                  <form className="grid gap-3 text-sm" onSubmit={handleLendingBorrow}>
                    <label>
                      <span className="mb-1 block text-slate-300">{lendingMetadata.debtToken.symbol} 金額</span>
                      <input
                        className="w-full rounded border border-white/20 bg-slate-950/60 p-2 focus:border-emerald-400 focus:outline-none"
                        value={lendingForms.borrow}
                        onChange={(e) => setLendingForms((prev) => ({ ...prev, borrow: e.target.value }))}
                        placeholder="0.0"
                      />
                    </label>
                    <button
                      type="submit"
                      className="rounded bg-emerald-500 px-4 py-2 font-semibold text-black hover:bg-emerald-400 disabled:opacity-40"
                      disabled={busy}
                    >
                      借り入れる
                    </button>
                  </form>
                </div>

                <div className="rounded-xl border border-white/10 bg-slate-900/40 p-4">
                  <h3 className="mb-3 text-base font-semibold">返済</h3>
                  <form className="grid gap-3 text-sm" onSubmit={handleLendingRepay}>
                    <label>
                      <span className="mb-1 block text-slate-300">{lendingMetadata.debtToken.symbol} 金額</span>
                      <input
                        className="w-full rounded border border-white/20 bg-slate-950/60 p-2 focus:border-emerald-400 focus:outline-none"
                        value={lendingForms.repay}
                        onChange={(e) => setLendingForms((prev) => ({ ...prev, repay: e.target.value }))}
                        placeholder="0.0"
                      />
                    </label>
                    <button
                      type="submit"
                      className="rounded bg-slate-100 px-4 py-2 font-semibold text-black hover:bg-slate-200 disabled:opacity-40"
                      disabled={busy}
                    >
                      返済する
                    </button>
                  </form>
                </div>
              </div>
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-white/10 bg-white/5 p-6">
          <div className="mb-4 space-y-1">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold">ステーキング</h2>
              <span className="text-xs text-slate-400">
                トークン: {stakingMetadata.stakingToken.symbol} → 報酬: {stakingMetadata.rewardToken.symbol}
              </span>
            </div>
            <p className="text-sm text-slate-300">
              ステーキングトークンを預けて報酬を獲得します。APR は rewardRate に応じて変動します。
            </p>
          </div>

          {stakingGuardrail ? (
            <div className="rounded border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-100">
              StakingPool 用の環境変数 (プール/トークン情報) を設定してください。
            </div>
          ) : (
            <div className="space-y-6">
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="rounded-xl border border-white/10 bg-slate-900/40 p-4">
                  <p className="text-xs text-slate-300">あなたのステーク残高</p>
                  <p className="text-lg font-semibold">
                    {formatStakingToken(stakedBalance, "staking")}
                  </p>
                </div>
                <div className="rounded-xl border border-white/10 bg-slate-900/40 p-4">
                  <p className="text-xs text-slate-300">獲得可能な報酬</p>
                  <p className="text-lg font-semibold">
                    {formatStakingToken(pendingRewards, "reward")}
                  </p>
                </div>
                <div className="rounded-xl border border-white/10 bg-slate-900/40 p-4">
                  <p className="text-xs text-slate-300">プールアドレス</p>
                  <p className="text-xs font-mono text-slate-400">{stakingMetadata.poolAddress}</p>
                </div>
              </div>

              <div className="grid gap-6 sm:grid-cols-2">
                <div className="rounded-xl border border-white/10 bg-slate-900/40 p-4">
                  <h3 className="mb-3 text-base font-semibold">預け入れ</h3>
                  <form className="grid gap-3 text-sm" onSubmit={handleStakingDeposit}>
                    <label>
                      <span className="mb-1 block text-slate-300">{stakingMetadata.stakingToken.symbol} 金額</span>
                      <input
                        className="w-full rounded border border-white/20 bg-slate-950/60 p-2 focus:border-emerald-400 focus:outline-none"
                        value={stakingAmount.deposit}
                        onChange={(e) => setStakingAmount((prev) => ({ ...prev, deposit: e.target.value }))}
                        placeholder="0.0"
                      />
                    </label>
                    <button
                      type="submit"
                      className="rounded bg-emerald-500 px-4 py-2 font-semibold text-black hover:bg-emerald-400 disabled:opacity-40"
                      disabled={busy}
                    >
                      ステーキングする
                    </button>
                  </form>
                </div>

                <div className="rounded-xl border border-white/10 bg-slate-900/40 p-4">
                  <h3 className="mb-3 text-base font-semibold">引き出し</h3>
                  <form className="grid gap-3 text-sm" onSubmit={handleStakingWithdraw}>
                    <label>
                      <span className="mb-1 block text-slate-300">引き出す {stakingMetadata.stakingToken.symbol}</span>
                      <input
                        className="w-full rounded border border-white/20 bg-slate-950/60 p-2 focus:border-emerald-400 focus:outline-none"
                        value={stakingAmount.withdraw}
                        onChange={(e) => setStakingAmount((prev) => ({ ...prev, withdraw: e.target.value }))}
                        placeholder="0.0"
                      />
                    </label>
                    <button
                      type="submit"
                      className="rounded bg-slate-100 px-4 py-2 font-semibold text-black hover:bg-slate-200 disabled:opacity-40"
                      disabled={busy}
                    >
                      引き出す
                    </button>
                  </form>
                </div>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
