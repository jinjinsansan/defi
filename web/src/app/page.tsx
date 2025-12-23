"use client";

import { useCallback, useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from "react";
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
const ACTIVITY_CATEGORIES: ActivityCategory[] = ["guardian", "swap", "liquidity", "staking", "lending", "system"];

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
  const [activityNotice, setActivityNotice] = useState<string | null>(null);
  const [activityFilter, setActivityFilter] = useState<ActivityCategory | "all">("all");
  const [activityAutoRefresh, setActivityAutoRefresh] = useState(false);
  const [adminForms, setAdminForms] = useState({
    simpleSwapTreasury: "",
    simpleSwapInit0: "",
    simpleSwapInit1: "",
    simpleSwapInitMinShares: "",
    stakingRewardRate: "",
    lendingCollateralFactor: "",
    lendingLiquidationThreshold: "",
    lendingLiquidationBonus: "",
    lendingInterestRate: "",
    lendingCollateralOracle: "",
    lendingDebtOracle: "",
    lendingProvideAmount: "",
    lendingWithdrawAmount: "",
  });
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
  const adminAddress = (process.env.NEXT_PUBLIC_ADMIN_ADDRESS ?? "").toLowerCase();
  const adminConfigured = Boolean(adminAddress);
  const isAdmin = useMemo(() => {
    if (!account || !adminAddress) {
      return false;
    }
    return account.toLowerCase() === adminAddress;
  }, [account, adminAddress]);
  const panelClass =
    "rounded-2xl border border-[#1f232b] bg-gradient-to-br from-[#111521] via-[#0b0f17] to-[#05070c] p-6 shadow-[0_10px_40px_rgba(0,0,0,0.55)]";
  const sectionCardClass =
    "rounded-xl border border-[#1c222f] bg-[#0f141d]/90 p-4 shadow-[0_10px_25px_rgba(0,0,0,0.45)]";
  const inputBase =
    "w-full rounded border border-[#232936] bg-[#05070c] p-2 text-sm focus:border-[#f0b90b] focus:outline-none";
  const primaryButtonClass =
    "rounded bg-[#f0b90b] px-5 py-2 text-sm font-semibold text-black transition hover:bg-[#f5c842] disabled:opacity-40";
  const secondaryButtonClass =
    "rounded border border-[#f0b90b]/70 px-5 py-2 text-sm font-semibold text-[#f0b90b] transition hover:border-[#f5c842] hover:text-[#f5c842] disabled:opacity-40";
  const subtleButtonClass =
    "rounded bg-[#131923] px-4 py-2 text-sm font-semibold text-[#f7f8fa] transition hover:bg-[#1a2130] disabled:opacity-40";
  const ghostButtonClass =
    "rounded border border-white/30 px-4 py-2 text-sm text-slate-200 transition hover:border-white/60";
  const accentTextClass = "text-[#f0b90b]";
  const miniGhostButton =
    "rounded border border-[#2a2f3b] px-3 py-1 text-xs text-slate-200 transition hover:border-[#f0b90b]";
  const miniPrimaryButton =
    "rounded bg-[#f0b90b] px-3 py-1 text-xs font-semibold text-black transition hover:bg-[#f5c842] disabled:opacity-40";
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

  const normalizeAccount = useCallback((value: string) => {
    try {
      return getAddress(value);
    } catch (err) {
      console.warn("Failed to normalize address", err);
      return value;
    }
  }, []);

  const updateAdminForm = useCallback(
    (field: keyof typeof adminForms, value: string) => {
      setAdminForms((prev) => ({ ...prev, [field]: value }));
    },
    [],
  );

  const ensureAdminAccess = useCallback(() => {
    if (!isAdmin) {
      throw new Error("管理者権限が必要です。");
    }
  }, [isAdmin]);

  const loadActivityLogs = useCallback(async () => {
    if (!activityEnabled) {
      setActivityLogs([]);
      return;
    }
    try {
      const params = new URLSearchParams();
      if (activityFilter !== "all") {
        params.set("category", activityFilter);
      }
      const query = params.toString();
      const response = await fetch(`/api/activity${query ? `?${query}` : ""}`);
      if (!response.ok) {
        console.error("Failed to fetch activity logs");
        return;
      }
      const payload = (await response.json()) as { data?: ActivityLogEntry[] };
      setActivityLogs(payload.data ?? []);
    } catch (err) {
      console.error(err);
    }
  }, [activityEnabled, activityFilter]);

  const handleActivityFilterChange = useCallback((event: ChangeEvent<HTMLSelectElement>) => {
    setActivityFilter(event.target.value as ActivityCategory | "all");
  }, []);

  const toggleActivityAutoRefresh = useCallback(() => {
    setActivityAutoRefresh((prev) => {
      const next = !prev;
      if (!prev && activityEnabled) {
        loadActivityLogs();
      }
      return next;
    });
  }, [activityEnabled, loadActivityLogs]);

  const logActivity = useCallback(
    async (payload: CreateActivityPayload) => {
      if (!activityEnabled || !signer || !account) {
        return;
      }
      const nonce = Date.now().toString();
      const logMessage = buildActivityMessage({
        ...payload,
        account,
        nonce,
      });
      const signature = await signer.signMessage(logMessage);
      const requestBody = JSON.stringify({
        ...payload,
        account,
        nonce,
        signature,
      });
      const maxAttempts = 3;
      const baseDelay = 750;
      let lastError: Error | null = null;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          const response = await fetch("/api/activity", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: requestBody,
          });
          if (!response.ok) {
            const body = (await response.json().catch(() => ({}))) as { error?: string };
            throw new Error(body.error ?? `Activity API responded ${response.status}`);
          }
          await loadActivityLogs();
          setActivityNotice(null);
          return;
        } catch (err) {
          lastError = err instanceof Error ? err : new Error("Activity log failed");
          console.error("Activity log failed", err);
          if (attempt < maxAttempts) {
            const delay = baseDelay * attempt;
            await new Promise((resolve) => setTimeout(resolve, delay));
          }
        }
      }
      setActivityNotice(`アクティビティログに記録できませんでした: ${lastError?.message ?? "unknown error"}`);
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
    loadActivityLogs();
  }, [loadActivityLogs]);

  useEffect(() => {
    if (!activityEnabled || !activityAutoRefresh) {
      return;
    }
    const timer = window.setInterval(() => {
      loadActivityLogs();
    }, 30000);
    return () => window.clearInterval(timer);
  }, [activityAutoRefresh, activityEnabled, loadActivityLogs]);

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
        chains: [primaryChainId],
        optionalChains: supportedChainIds.length > 0 ? supportedChainIds : [primaryChainId],
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
    primaryChainId,
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

  const handleSimpleSwapSetTreasury = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    resetMessages();
    if (!simpleSwapConfigured) {
      setError("SimpleSwap の設定を確認してください。");
      return;
    }
    const treasuryAddress = adminForms.simpleSwapTreasury.trim();
    if (!isAddress(treasuryAddress)) {
      setError("有効なトレジャリーアドレスを入力してください。");
      return;
    }
    try {
      ensureAdminAccess();
      requireAccount();
      setBusy(true);
      const contract = ensureSimpleSwapContract();
      const normalized = getAddress(treasuryAddress);
      const tx = await contract.setTreasury(normalized);
      await tx.wait();
      setStatus("SimpleSwap のトレジャリーを更新しました。");
      await logActivity({
        category: "system",
        description: `SimpleSwap treasury → ${shorten(normalized)}`,
        txHash: tx.hash,
      });
      setAdminForms((prev) => ({ ...prev, simpleSwapTreasury: "" }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleSimpleSwapAdminLiquidity = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    resetMessages();
    if (!simpleSwapConfigured) {
      setError("SimpleSwap の設定を確認してください。");
      return;
    }
    const amount0 = parseTokenAmount(adminForms.simpleSwapInit0, "token0");
    const amount1 = parseTokenAmount(adminForms.simpleSwapInit1, "token1");
    if (amount0 === 0n || amount1 === 0n) {
      setError("両トークンの金額を入力してください。");
      return;
    }
    const minShares = adminForms.simpleSwapInitMinShares
      ? parseUnits(adminForms.simpleSwapInitMinShares, 18)
      : 0n;
    try {
      ensureAdminAccess();
      const walletAccount = requireAccount();
      setBusy(true);
      await ensureTokenAllowance(tokenMetadata.token0.address, simpleSwapAddress, amount0);
      await ensureTokenAllowance(tokenMetadata.token1.address, simpleSwapAddress, amount1);
      const contract = ensureSimpleSwapContract();
      const tx = await contract.addLiquidity(amount0, amount1, minShares, walletAccount);
      await tx.wait();
      setStatus("管理者として流動性を追加しました。");
      await logActivity({
        category: "liquidity",
        description: `管理流動性追加 ${adminForms.simpleSwapInit0 || "0"} ${tokenMetadata.token0.symbol} (by ${shorten(walletAccount)})`,
        txHash: tx.hash,
      });
      setAdminForms((prev) => ({
        ...prev,
        simpleSwapInit0: "",
        simpleSwapInit1: "",
        simpleSwapInitMinShares: "",
      }));
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

  const handleStakingRewardRateUpdate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    resetMessages();
    if (!stakingConfigured) {
      setError("StakingPool の設定を確認してください。");
      return;
    }
    if (!adminForms.stakingRewardRate.trim()) {
      setError("新しい報酬レートを入力してください。");
      return;
    }
    try {
      ensureAdminAccess();
      requireAccount();
      setBusy(true);
      const newRate = parseUnits(adminForms.stakingRewardRate, stakingMetadata.rewardToken.decimals);
      const contract = ensureStakingContract();
      const tx = await contract.setRewardRate(newRate);
      await tx.wait();
      setStatus("報酬レートを更新しました。");
      await logActivity({
        category: "system",
        description: `Staking rewardRate → ${adminForms.stakingRewardRate} ${stakingMetadata.rewardToken.symbol}/s`,
        txHash: tx.hash,
      });
      setAdminForms((prev) => ({ ...prev, stakingRewardRate: "" }));
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

  const handleLendingRiskParameters = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    resetMessages();
    if (!lendingConfigured) {
      setError("LendingPool の設定を確認してください。");
      return;
    }
    if (!adminForms.lendingCollateralFactor || !adminForms.lendingLiquidationThreshold || !adminForms.lendingLiquidationBonus) {
      setError("全てのリスクパラメータを入力してください。");
      return;
    }
    try {
      ensureAdminAccess();
      requireAccount();
      setBusy(true);
      const collateralFactor = parseUnits(adminForms.lendingCollateralFactor, 18);
      const liquidationThreshold = parseUnits(adminForms.lendingLiquidationThreshold, 18);
      const liquidationBonus = parseUnits(adminForms.lendingLiquidationBonus, 18);
      const contract = ensureLendingContract();
      const tx = await contract.setRiskParameters(collateralFactor, liquidationThreshold, liquidationBonus);
      await tx.wait();
      setStatus("リスクパラメータを更新しました。");
      await logActivity({
        category: "lending",
        description: "リスクパラメータを更新",
        txHash: tx.hash,
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleLendingInterestRateUpdate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    resetMessages();
    if (!lendingConfigured) {
      setError("LendingPool の設定を確認してください。");
      return;
    }
    if (!adminForms.lendingInterestRate.trim()) {
      setError("新しい金利を入力してください。");
      return;
    }
    try {
      ensureAdminAccess();
      requireAccount();
      setBusy(true);
      const newRate = parseUnits(adminForms.lendingInterestRate, 18);
      const contract = ensureLendingContract();
      const tx = await contract.setInterestRate(newRate);
      await tx.wait();
      setStatus("金利を更新しました。");
      await logActivity({
        category: "lending",
        description: `借入利率を ${adminForms.lendingInterestRate} /s に更新`,
        txHash: tx.hash,
      });
      setAdminForms((prev) => ({ ...prev, lendingInterestRate: "" }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleLendingSetOracles = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    resetMessages();
    if (!lendingConfigured) {
      setError("LendingPool の設定を確認してください。");
      return;
    }
    if (!isAddress(adminForms.lendingCollateralOracle) || !isAddress(adminForms.lendingDebtOracle)) {
      setError("有効なオラクルアドレスを入力してください。");
      return;
    }
    try {
      ensureAdminAccess();
      requireAccount();
      setBusy(true);
      const contract = ensureLendingContract();
      const tx = await contract.setOracles(
        getAddress(adminForms.lendingCollateralOracle),
        getAddress(adminForms.lendingDebtOracle),
      );
      await tx.wait();
      setStatus("オラクルアドレスを更新しました。");
      await logActivity({
        category: "lending",
        description: "オラクルアドレスを更新",
        txHash: tx.hash,
      });
      setAdminForms((prev) => ({ ...prev, lendingCollateralOracle: "", lendingDebtOracle: "" }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleLendingProvideLiquidity = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    resetMessages();
    if (!lendingConfigured) {
      setError("LendingPool の設定を確認してください。");
      return;
    }
    const amount = adminForms.lendingProvideAmount
      ? parseUnits(adminForms.lendingProvideAmount, lendingMetadata.debtToken.decimals)
      : 0n;
    if (amount === 0n) {
      setError("追加する流動性量を入力してください。");
      return;
    }
    try {
      ensureAdminAccess();
      const walletAccount = requireAccount();
      setBusy(true);
      await ensureTokenAllowance(lendingMetadata.debtToken.address, lendingMetadata.poolAddress, amount);
      const contract = ensureLendingContract();
      const tx = await contract.provideLiquidity(amount);
      await tx.wait();
      setStatus("プールに流動性を追加しました。");
      await logActivity({
        category: "lending",
        description: `プールへ ${adminForms.lendingProvideAmount} ${lendingMetadata.debtToken.symbol} 追加 (by ${shorten(walletAccount)})`,
        txHash: tx.hash,
      });
      setAdminForms((prev) => ({ ...prev, lendingProvideAmount: "" }));
      await loadLendingSnapshot();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleLendingWithdrawLiquidity = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    resetMessages();
    if (!lendingConfigured) {
      setError("LendingPool の設定を確認してください。");
      return;
    }
    const amount = adminForms.lendingWithdrawAmount
      ? parseUnits(adminForms.lendingWithdrawAmount, lendingMetadata.debtToken.decimals)
      : 0n;
    if (amount === 0n) {
      setError("引き出す流動性量を入力してください。");
      return;
    }
    try {
      ensureAdminAccess();
      requireAccount();
      setBusy(true);
      const contract = ensureLendingContract();
      const tx = await contract.withdrawLiquidity(amount);
      await tx.wait();
      setStatus("プールから流動性を引き出しました。");
      await logActivity({
        category: "lending",
        description: `${adminForms.lendingWithdrawAmount} ${lendingMetadata.debtToken.symbol} を運営ウォレットへ引き出し`,
        txHash: tx.hash,
      });
      setAdminForms((prev) => ({ ...prev, lendingWithdrawAmount: "" }));
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
  const activityCategoryLabels: Record<ActivityCategory, string> = {
    guardian: "マルチシグ",
    swap: "スワップ",
    liquidity: "流動性",
    staking: "ステーキング",
    lending: "レンディング",
    system: "システム",
  };
  const activityFilterOptions: (ActivityCategory | "all")[] = ["all", ...ACTIVITY_CATEGORIES];

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
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,#171f2f,#050608_65%)] text-[#f7f8fa]">
      <div className="mx-auto flex max-w-6xl flex-col gap-8 px-6 py-12">
        <header className="space-y-3">
          <p className="text-sm uppercase tracking-[0.4em] text-[#f0b90b]">Guardian Vault</p>
          <h1 className="text-3xl font-semibold text-white">マルチシグ & DeFi コントロールセンター</h1>
          <p className="text-sm text-slate-200">
            Binance 風のクリアな UI で金庫、スワップ、ステーキング、レンディング、そして管理タスクをまとめて操作できます。
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
          <div className={sectionCardClass}>
            <p className="text-xs uppercase tracking-widest text-slate-400">金庫アドレス</p>
            <p className="truncate text-lg font-semibold text-white">{guardianVaultAddress || "未設定"}</p>
          </div>
          <div className={sectionCardClass}>
            <p className="text-xs uppercase tracking-widest text-slate-400">必要承認数</p>
            <p className={`text-3xl font-semibold ${accentTextClass}`}>{threshold || "-"}</p>
          </div>
          <div className={sectionCardClass}>
            <p className="text-xs uppercase tracking-widest text-slate-400">ETH 残高</p>
            <p className="text-3xl font-semibold text-white">{formattedBalance} ETH</p>
          </div>
        </section>

        <section className={`${panelClass} flex flex-wrap items-center justify-between gap-4`}>
          <div>
            <p className="text-xs uppercase tracking-widest text-slate-400">接続中ウォレット</p>
            <p className="text-lg font-semibold text-white">{account ? shorten(account) : "未接続"}</p>
            <p className="text-xs text-slate-400">
              {connectionMethod === "walletconnect"
                ? "WalletConnect"
                : connectionMethod === "metamask"
                  ? "MetaMask"
                  : "未接続"}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button className={primaryButtonClass} onClick={connectWallet} disabled={busy}>
              MetaMask 接続
            </button>
            <button className={secondaryButtonClass} onClick={connectWalletConnect} disabled={busy || !walletConnectProjectId}>
              WalletConnect
            </button>
            {account && (
              <button className={ghostButtonClass} onClick={disconnectWallet} disabled={busy}>
                切断
              </button>
            )}
          </div>
        </section>

        {isAdmin && (
          <section className={panelClass}>
            <div className="mb-4 space-y-1">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-semibold text-white">管理ツール</h2>
                {!activityEnabled && (
                  <span className="text-xs text-amber-300">Activity ログ (Supabase) が無効です</span>
                )}
              </div>
              {!adminConfigured && <p className="text-xs text-amber-200">NEXT_PUBLIC_ADMIN_ADDRESS が未設定です。</p>}
              <p className="text-sm text-slate-300">SimpleSwap / Staking / Lending の運営操作をここから実行できます。</p>
            </div>
            <div className="grid gap-6 lg:grid-cols-2">
              <div className={`${sectionCardClass} space-y-4`}>
                <h3 className="text-base font-semibold text-white">SimpleSwap 管理</h3>
                <form className="space-y-2 text-sm" onSubmit={handleSimpleSwapSetTreasury}>
                  <label className="block">
                    <span className="mb-1 block text-slate-300">トレジャリーアドレス</span>
                    <input
                      className={inputBase}
                      value={adminForms.simpleSwapTreasury}
                      onChange={(e) => updateAdminForm("simpleSwapTreasury", e.target.value)}
                      placeholder="0x..."
                    />
                  </label>
                  <button type="submit" className={`${primaryButtonClass} w-full`} disabled={busy}>
                    トレジャリーを更新
                  </button>
                </form>
                <form className="space-y-2 text-sm" onSubmit={handleSimpleSwapAdminLiquidity}>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <label>
                      <span className="mb-1 block text-slate-300">{tokenMetadata.token0.symbol}</span>
                      <input className={inputBase}
                        value={adminForms.simpleSwapInit0}
                        onChange={(e) => updateAdminForm("simpleSwapInit0", e.target.value)}
                        placeholder="0.0"
                      />
                    </label>
                    <label>
                      <span className="mb-1 block text-slate-300">{tokenMetadata.token1.symbol}</span>
                      <input className={inputBase}
                        value={adminForms.simpleSwapInit1}
                        onChange={(e) => updateAdminForm("simpleSwapInit1", e.target.value)}
                        placeholder="0.0"
                      />
                    </label>
                  </div>
                  <label className="block">
                    <span className="mb-1 block text-slate-300">最小受取 LP (任意)</span>
                    <input className={inputBase}
                      value={adminForms.simpleSwapInitMinShares}
                      onChange={(e) => updateAdminForm("simpleSwapInitMinShares", e.target.value)}
                      placeholder="0"
                    />
                  </label>
                  <button type="submit" className={`${secondaryButtonClass} w-full`} disabled={busy}>
                    管理者として流動性追加
                  </button>
                </form>
              </div>
              <div className={`${sectionCardClass} space-y-4`}>
                <h3 className="text-base font-semibold text-white">Staking 管理</h3>
                <form className="space-y-2 text-sm" onSubmit={handleStakingRewardRateUpdate}>
                  <label className="block">
                    <span className="mb-1 block text-slate-300">新しい rewardRate ({stakingMetadata.rewardToken.symbol}/秒)</span>
                    <input className={inputBase}
                      value={adminForms.stakingRewardRate}
                      onChange={(e) => updateAdminForm("stakingRewardRate", e.target.value)}
                      placeholder="0.0"
                    />
                  </label>
                  <button type="submit" className={`${primaryButtonClass} w-full`} disabled={busy}>
                    報酬レートを更新
                  </button>
                </form>
              </div>
            </div>
            <div className="mt-6 grid gap-6 lg:grid-cols-2">
              <div className={`${sectionCardClass} space-y-4`}>
                <h3 className="text-base font-semibold text-white">Lending パラメータ</h3>
                <form className="grid gap-2 text-sm" onSubmit={handleLendingRiskParameters}>
                  <label>
                    <span className="mb-1 block text-slate-300">担保係数 (0-1)</span>
                    <input className={inputBase}
                      value={adminForms.lendingCollateralFactor}
                      onChange={(e) => updateAdminForm("lendingCollateralFactor", e.target.value)}
                      placeholder="0.7"
                    />
                  </label>
                  <label>
                    <span className="mb-1 block text-slate-300">清算しきい値 (0-1)</span>
                    <input className={inputBase}
                      value={adminForms.lendingLiquidationThreshold}
                      onChange={(e) => updateAdminForm("lendingLiquidationThreshold", e.target.value)}
                      placeholder="0.8"
                    />
                  </label>
                  <label>
                    <span className="mb-1 block text-slate-300">清算ボーナス (≥1)</span>
                    <input className={inputBase}
                      value={adminForms.lendingLiquidationBonus}
                      onChange={(e) => updateAdminForm("lendingLiquidationBonus", e.target.value)}
                      placeholder="1.05"
                    />
                  </label>
                  <button type="submit" className={primaryButtonClass} disabled={busy}>
                    リスクパラメータ更新
                  </button>
                </form>
                <form className="space-y-2 text-sm" onSubmit={handleLendingInterestRateUpdate}>
                  <label>
                    <span className="mb-1 block text-slate-300">金利 (1 秒あたり, 例: 0.000001)</span>
                    <input className={inputBase}
                      value={adminForms.lendingInterestRate}
                      onChange={(e) => updateAdminForm("lendingInterestRate", e.target.value)}
                      placeholder="0.000001"
                    />
                  </label>
                  <button type="submit" className={`${secondaryButtonClass} w-full`} disabled={busy}>
                    金利を更新
                  </button>
                </form>
                <form className="space-y-2 text-sm" onSubmit={handleLendingSetOracles}>
                  <label>
                    <span className="mb-1 block text-slate-300">担保オラクルアドレス</span>
                    <input className={inputBase}
                      value={adminForms.lendingCollateralOracle}
                      onChange={(e) => updateAdminForm("lendingCollateralOracle", e.target.value)}
                      placeholder="0x..."
                    />
                  </label>
                  <label>
                    <span className="mb-1 block text-slate-300">借入オラクルアドレス</span>
                    <input className={inputBase}
                      value={adminForms.lendingDebtOracle}
                      onChange={(e) => updateAdminForm("lendingDebtOracle", e.target.value)}
                      placeholder="0x..."
                    />
                  </label>
                  <button type="submit" className={`${subtleButtonClass} w-full`} disabled={busy}>
                    オラクルを更新
                  </button>
                </form>
              </div>
              <div className={`${sectionCardClass} space-y-4`}>
                <h3 className="text-base font-semibold text-white">Lending 流動性操作</h3>
                <form className="space-y-2 text-sm" onSubmit={handleLendingProvideLiquidity}>
                  <label>
                    <span className="mb-1 block text-slate-300">追加する {lendingMetadata.debtToken.symbol}</span>
                    <input className={inputBase}
                      value={adminForms.lendingProvideAmount}
                      onChange={(e) => updateAdminForm("lendingProvideAmount", e.target.value)}
                      placeholder="0.0"
                    />
                  </label>
                  <button type="submit" className={`${primaryButtonClass} w-full`} disabled={busy}>
                    流動性を追加
                  </button>
                </form>
                <form className="space-y-2 text-sm" onSubmit={handleLendingWithdrawLiquidity}>
                  <label>
                    <span className="mb-1 block text-slate-300">引き出す {lendingMetadata.debtToken.symbol}</span>
                    <input className={inputBase}
                      value={adminForms.lendingWithdrawAmount}
                      onChange={(e) => updateAdminForm("lendingWithdrawAmount", e.target.value)}
                      placeholder="0.0"
                    />
                  </label>
                  <button type="submit" className={`${ghostButtonClass} w-full`} disabled={busy}>
                    流動性を引き出す
                  </button>
                </form>
              </div>
            </div>
          </section>
        )}

        {activityEnabled && (
          <section className={panelClass}>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
              <div>
                <h2 className="text-xl font-semibold text-white">最新アクティビティ</h2>
                <p className="text-sm text-slate-300">Supabase activity_logs テーブルの最新 25 件を表示します。</p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <div className="w-40 text-xs text-slate-300">
                  <span className="mb-1 block">カテゴリ</span>
                  <select className={inputBase} value={activityFilter} onChange={handleActivityFilterChange}>
                    {activityFilterOptions.map((option) => (
                      <option key={option} value={option}>
                        {option === "all" ? "すべて" : activityCategoryLabels[option]}
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  type="button"
                  className={activityAutoRefresh ? primaryButtonClass : subtleButtonClass}
                  onClick={toggleActivityAutoRefresh}
                >
                  Auto Refresh {activityAutoRefresh ? "ON" : "OFF"}
                </button>
                <button type="button" className={ghostButtonClass} onClick={loadActivityLogs}>
                  再読込
                </button>
              </div>
            </div>
            {activityNotice && (
              <div className="mb-4 rounded border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-100">
                {activityNotice}
              </div>
            )}
            {activityLogs.length === 0 ? (
              <p className="text-sm text-slate-400">まだ記録がありません。</p>
            ) : (
              <ul className="space-y-3">
                {activityLogs.map((entry) => (
                  <li key={entry.id} className={`${sectionCardClass} border border-[#1c222f] bg-[#0c1119]/90 p-3`}>
                    <div className="flex items-center justify-between text-xs text-slate-400">
                      <span className={`font-semibold ${accentTextClass}`}>
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
                          className={`${accentTextClass} underline`}
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

        <section className={panelClass}>
          <h2 className="mb-4 text-xl font-semibold text-white">ETH 出金リクエストを作成</h2>
          <form className="grid gap-4" onSubmit={handleCreate}>
            <label className="text-sm">
              <span className="mb-1 block text-slate-300">受取人アドレス</span>
              <input
                className={inputBase}
                value={formData.recipient}
                onChange={(e) => setFormData((prev) => ({ ...prev, recipient: e.target.value }))}
                placeholder="0x..."
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-slate-300">金額 (ETH)</span>
              <input
                className={inputBase}
                value={formData.amount}
                onChange={(e) => setFormData((prev) => ({ ...prev, amount: e.target.value }))}
                placeholder="1.0"
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-slate-300">期限 (分, 任意)</span>
              <input
                className={inputBase}
                value={formData.expiryMinutes}
                onChange={(e) => setFormData((prev) => ({ ...prev, expiryMinutes: e.target.value }))}
                placeholder="60"
              />
            </label>
            <button type="submit" className={primaryButtonClass} disabled={busy}>
              リクエストを送信
            </button>
          </form>
        </section>

        <section className={panelClass}>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-xl font-semibold text-white">最新のリクエスト</h2>
            <button className={`${accentTextClass} text-sm hover:underline disabled:opacity-40`} onClick={loadSnapshot} disabled={busy}>
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
                              className={miniGhostButton}
                              onClick={() => handleApproval(entry.id)}
                              disabled={!isActive || busy}
                            >
                              承認
                            </button>
                            <button
                              className={miniPrimaryButton}
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

        <section className={panelClass}>
          <div className="mb-4 space-y-1">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold text-white">SimpleSwap プール</h2>
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
                <div className={sectionCardClass}>
                  <p className="text-xs text-slate-300">リザーブ ({tokenMetadata.token0.symbol})</p>
                  <p className="text-lg font-semibold">
                    {formatTokenDisplay(swapSnapshot.reserve0, "token0")}
                  </p>
                </div>
                <div className={sectionCardClass}>
                  <p className="text-xs text-slate-300">リザーブ ({tokenMetadata.token1.symbol})</p>
                  <p className="text-lg font-semibold">
                    {formatTokenDisplay(swapSnapshot.reserve1, "token1")}
                  </p>
                </div>
                <div className={sectionCardClass}>
                  <p className="text-xs text-slate-300">LP 総供給</p>
                  <p className="text-lg font-semibold">{swapSnapshot.totalSupply} GLP</p>
                </div>
                <div className={sectionCardClass}>
                  <p className="text-xs text-slate-300">あなたの LP</p>
                  <p className="text-lg font-semibold">{formattedLpBalance} GLP</p>
                </div>
              </div>

              <div className="grid gap-6 lg:grid-cols-3">
                <div className={sectionCardClass}>
                  <h3 className="mb-3 text-base font-semibold text-white">流動性を追加</h3>
                  <form className="grid gap-3 text-sm" onSubmit={handleAddLiquidity}>
                    <label>
                      <span className="mb-1 block text-slate-300">{tokenMetadata.token0.symbol} 金額</span>
                      <input
                        className={inputBase}
                        value={liquidityForm.amount0}
                        onChange={(e) => setLiquidityForm((prev) => ({ ...prev, amount0: e.target.value }))}
                        placeholder="0.0"
                      />
                    </label>
                    <label>
                      <span className="mb-1 block text-slate-300">{tokenMetadata.token1.symbol} 金額</span>
                      <input
                        className={inputBase}
                        value={liquidityForm.amount1}
                        onChange={(e) => setLiquidityForm((prev) => ({ ...prev, amount1: e.target.value }))}
                        placeholder="0.0"
                      />
                    </label>
                    <label>
                      <span className="mb-1 block text-slate-300">最小受取 LP (任意)</span>
                      <input
                        className={inputBase}
                        value={liquidityForm.minShares}
                        onChange={(e) => setLiquidityForm((prev) => ({ ...prev, minShares: e.target.value }))}
                        placeholder="0"
                      />
                    </label>
                    <button type="submit" className={primaryButtonClass} disabled={busy}>
                      追加する
                    </button>
                  </form>
                </div>

                <div className={sectionCardClass}>
                  <h3 className="mb-3 text-base font-semibold text-white">流動性を引き出す</h3>
                  <form className="grid gap-3 text-sm" onSubmit={handleRemoveLiquidity}>
                    <label>
                      <span className="mb-1 block text-slate-300">バーンする LP 数量</span>
                      <input
                        className={inputBase}
                        value={removeForm.shares}
                        onChange={(e) => setRemoveForm((prev) => ({ ...prev, shares: e.target.value }))}
                        placeholder="0.0"
                      />
                    </label>
                    <label>
                      <span className="mb-1 block text-slate-300">最小 {tokenMetadata.token0.symbol}</span>
                      <input
                        className={inputBase}
                        value={removeForm.minAmount0}
                        onChange={(e) => setRemoveForm((prev) => ({ ...prev, minAmount0: e.target.value }))}
                        placeholder="0"
                      />
                    </label>
                    <label>
                      <span className="mb-1 block text-slate-300">最小 {tokenMetadata.token1.symbol}</span>
                      <input
                        className={inputBase}
                        value={removeForm.minAmount1}
                        onChange={(e) => setRemoveForm((prev) => ({ ...prev, minAmount1: e.target.value }))}
                        placeholder="0"
                      />
                    </label>
                    <button type="submit" className={ghostButtonClass} disabled={busy}>
                      引き出す
                    </button>
                  </form>
                </div>

                <div className={sectionCardClass}>
                  <h3 className="mb-3 text-base font-semibold text-white">スワップ</h3>
                  <form className="grid gap-3 text-sm" onSubmit={handleSwap}>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-slate-300">方向</span>
                      <button
                        type="button"
                        className={`${accentTextClass} text-xs hover:underline`}
                        onClick={toggleSwapDirection}
                      >
                        {swapDirectionLabel}
                      </button>
                    </div>
                    <label>
                      <span className="mb-1 block text-slate-300">スワップ入力</span>
                      <input
                        className={inputBase}
                        value={swapForm.amountIn}
                        onChange={(e) => setSwapForm((prev) => ({ ...prev, amountIn: e.target.value }))}
                        placeholder="0.0"
                      />
                    </label>
                    <label>
                      <span className="mb-1 block text-slate-300">最小受取 (任意)</span>
                      <input
                        className={inputBase}
                        value={swapForm.minAmountOut}
                        onChange={(e) => setSwapForm((prev) => ({ ...prev, minAmountOut: e.target.value }))}
                        placeholder="0"
                      />
                    </label>
                    <button type="submit" className={primaryButtonClass} disabled={busy}>
                      スワップする
                    </button>
                  </form>
                </div>
              </div>
            </div>
          )}
        </section>

        <section className={panelClass}>
          <div className="mb-4 space-y-1">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold text-white">レンディングプール</h2>
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
                <div className={sectionCardClass}>
                  <p className="text-xs text-slate-300">あなたの担保</p>
                  <p className="text-lg font-semibold">
                    {formatLendingToken(lendingSnapshot.collateral, "collateral")}
                  </p>
                </div>
                <div className={sectionCardClass}>
                  <p className="text-xs text-slate-300">あなたの借入残高</p>
                  <p className="text-lg font-semibold">
                    {formatLendingToken(lendingSnapshot.debt, "debt")}
                  </p>
                </div>
                <div className={sectionCardClass}>
                  <p className="text-xs text-slate-300">借入上限 (CF)</p>
                  <p className="text-lg font-semibold">
                    {formatLendingToken(lendingSnapshot.borrowLimit, "debt")}
                  </p>
                </div>
                <div className={sectionCardClass}>
                  <p className="text-xs text-slate-300">ヘルスファクター</p>
                  <p className="text-lg font-semibold">{lendingSnapshot.healthFactor}</p>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div className={sectionCardClass}>
                  <p className="text-xs text-slate-300">プール担保総額</p>
                  <p className="text-lg font-semibold">
                    {formatLendingToken(lendingSnapshot.totalCollateral, "collateral")}
                  </p>
                </div>
                <div className={sectionCardClass}>
                  <p className="text-xs text-slate-300">借入総額</p>
                  <p className="text-lg font-semibold">
                    {formatLendingToken(lendingSnapshot.totalBorrows, "debt")}
                  </p>
                </div>
                <div className={sectionCardClass}>
                  <p className="text-xs text-slate-300">利用可能流動性</p>
                  <p className="text-lg font-semibold">
                    {formatLendingToken(lendingSnapshot.availableLiquidity, "debt")}
                  </p>
                </div>
                <div className={sectionCardClass}>
                  <p className="text-xs text-slate-300">利用率</p>
                  <p className="text-lg font-semibold">{lendingSnapshot.utilization}</p>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className={sectionCardClass}>
                  <p className="text-xs text-slate-300">担保トークン価格 (USD)</p>
                  <p className="text-lg font-semibold">{lendingSnapshot.collateralPrice}</p>
                </div>
                <div className={sectionCardClass}>
                  <p className="text-xs text-slate-300">借入トークン価格 (USD)</p>
                  <p className="text-lg font-semibold">{lendingSnapshot.debtPrice}</p>
                </div>
              </div>

              <div className="grid gap-6 lg:grid-cols-2">
                <div className={sectionCardClass}>
                  <h3 className="mb-3 text-base font-semibold text-white">担保を預け入れ</h3>
                  <form className="grid gap-3 text-sm" onSubmit={handleLendingDeposit}>
                    <label>
                      <span className="mb-1 block text-slate-300">{lendingMetadata.collateralToken.symbol} 金額</span>
                      <input
                        className={inputBase}
                        value={lendingForms.deposit}
                        onChange={(e) => setLendingForms((prev) => ({ ...prev, deposit: e.target.value }))}
                        placeholder="0.0"
                      />
                    </label>
                    <button type="submit" className={primaryButtonClass} disabled={busy}>
                      預け入れる
                    </button>
                  </form>
                </div>

                <div className={sectionCardClass}>
                  <h3 className="mb-3 text-base font-semibold text-white">担保を引き出す</h3>
                  <form className="grid gap-3 text-sm" onSubmit={handleLendingWithdraw}>
                    <label>
                      <span className="mb-1 block text-slate-300">{lendingMetadata.collateralToken.symbol} 金額</span>
                      <input
                        className={inputBase}
                        value={lendingForms.withdraw}
                        onChange={(e) => setLendingForms((prev) => ({ ...prev, withdraw: e.target.value }))}
                        placeholder="0.0"
                      />
                    </label>
                    <button type="submit" className={ghostButtonClass} disabled={busy}>
                      引き出す
                    </button>
                  </form>
                </div>
              </div>

              <div className="grid gap-6 lg:grid-cols-2">
                <div className={sectionCardClass}>
                  <h3 className="mb-3 text-base font-semibold text-white">借入</h3>
                  <form className="grid gap-3 text-sm" onSubmit={handleLendingBorrow}>
                    <label>
                      <span className="mb-1 block text-slate-300">{lendingMetadata.debtToken.symbol} 金額</span>
                      <input
                        className={inputBase}
                        value={lendingForms.borrow}
                        onChange={(e) => setLendingForms((prev) => ({ ...prev, borrow: e.target.value }))}
                        placeholder="0.0"
                      />
                    </label>
                    <button type="submit" className={primaryButtonClass} disabled={busy}>
                      借り入れる
                    </button>
                  </form>
                </div>

                <div className={sectionCardClass}>
                  <h3 className="mb-3 text-base font-semibold text-white">返済</h3>
                  <form className="grid gap-3 text-sm" onSubmit={handleLendingRepay}>
                    <label>
                      <span className="mb-1 block text-slate-300">{lendingMetadata.debtToken.symbol} 金額</span>
                      <input
                        className={inputBase}
                        value={lendingForms.repay}
                        onChange={(e) => setLendingForms((prev) => ({ ...prev, repay: e.target.value }))}
                        placeholder="0.0"
                      />
                    </label>
                    <button type="submit" className={ghostButtonClass} disabled={busy}>
                      返済する
                    </button>
                  </form>
                </div>
              </div>
            </div>
          )}
        </section>

        <section className={panelClass}>
          <div className="mb-4 space-y-1">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold text-white">ステーキング</h2>
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
                <div className={sectionCardClass}>
                  <p className="text-xs text-slate-300">あなたのステーク残高</p>
                  <p className="text-lg font-semibold">
                    {formatStakingToken(stakedBalance, "staking")}
                  </p>
                </div>
                <div className={sectionCardClass}>
                  <p className="text-xs text-slate-300">獲得可能な報酬</p>
                  <p className="text-lg font-semibold">
                    {formatStakingToken(pendingRewards, "reward")}
                  </p>
                </div>
                <div className={sectionCardClass}>
                  <p className="text-xs text-slate-300">プールアドレス</p>
                  <p className="text-xs font-mono text-slate-400">{stakingMetadata.poolAddress}</p>
                </div>
              </div>

              <div className="grid gap-6 sm:grid-cols-2">
                <div className={sectionCardClass}>
                  <h3 className="mb-3 text-base font-semibold text-white">預け入れ</h3>
                  <form className="grid gap-3 text-sm" onSubmit={handleStakingDeposit}>
                    <label>
                      <span className="mb-1 block text-slate-300">{stakingMetadata.stakingToken.symbol} 金額</span>
                      <input
                        className={inputBase}
                        value={stakingAmount.deposit}
                        onChange={(e) => setStakingAmount((prev) => ({ ...prev, deposit: e.target.value }))}
                        placeholder="0.0"
                      />
                    </label>
                    <button type="submit" className={primaryButtonClass} disabled={busy}>
                      ステーキングする
                    </button>
                  </form>
                </div>

                <div className={sectionCardClass}>
                  <h3 className="mb-3 text-base font-semibold text-white">引き出し</h3>
                  <form className="grid gap-3 text-sm" onSubmit={handleStakingWithdraw}>
                    <label>
                      <span className="mb-1 block text-slate-300">引き出す {stakingMetadata.stakingToken.symbol}</span>
                      <input
                        className={inputBase}
                        value={stakingAmount.withdraw}
                        onChange={(e) => setStakingAmount((prev) => ({ ...prev, withdraw: e.target.value }))}
                        placeholder="0.0"
                      />
                    </label>
                    <button type="submit" className={ghostButtonClass} disabled={busy}>
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
