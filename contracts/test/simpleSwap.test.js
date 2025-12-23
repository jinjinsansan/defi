const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

const MAX_UINT = ethers.MaxUint256;

function sqrt(value) {
  if (value < 0n) {
    throw new Error("negative");
  }
  if (value < 2n) {
    return value;
  }
  let x0 = value / 2n;
  let x1 = (x0 + value / x0) / 2n;
  while (x1 < x0) {
    x0 = x1;
    x1 = (x0 + value / x0) / 2n;
  }
  return x0;
}

async function deployFixture() {
  const [admin, lp, trader, treasury] = await ethers.getSigners();
  const Token = await ethers.getContractFactory("TestToken");
  const token0 = await Token.deploy("Token0", "TK0");
  await token0.waitForDeployment();
  const token1 = await Token.deploy("Token1", "TK1");
  await token1.waitForDeployment();

  const SimpleSwap = await ethers.getContractFactory("SimpleSwap");
  const swap = await SimpleSwap.deploy(token0, token1, treasury.address, admin.address);
  await swap.waitForDeployment();

  const seedAmount = ethers.parseEther("1000");
  await token0.mint(lp.address, seedAmount);
  await token1.mint(lp.address, seedAmount);
  await token0.mint(trader.address, seedAmount);
  await token1.mint(trader.address, seedAmount);

  await token0.connect(lp).approve(swap, MAX_UINT);
  await token1.connect(lp).approve(swap, MAX_UINT);
  await token0.connect(trader).approve(swap, MAX_UINT);
  await token1.connect(trader).approve(swap, MAX_UINT);

  return { admin, lp, trader, treasury, token0, token1, swap };
}

describe("SimpleSwap", function () {
  describe("liquidity", function () {
    it("mints LP tokens based on geometric mean for initial liquidity", async function () {
      const { lp, swap } = await loadFixture(deployFixture);
      const amount0 = ethers.parseEther("10");
      const amount1 = ethers.parseEther("20");

      const tx = await swap
        .connect(lp)
        .addLiquidity(amount0, amount1, 0, lp.address);
      await tx.wait();

      const expectedShares = sqrt(amount0 * amount1);
      const balance = await swap.balanceOf(lp.address);
      expect(balance).to.equal(expectedShares);

      const reserves = await swap.getReserves();
      expect(reserves[0]).to.equal(amount0);
      expect(reserves[1]).to.equal(amount1);
    });

    it("redeems liquidity proportionally", async function () {
      const { lp, swap } = await loadFixture(deployFixture);
      const amount0 = ethers.parseEther("5");
      const amount1 = ethers.parseEther("5");
      await swap.connect(lp).addLiquidity(amount0, amount1, 0, lp.address);
      const shares = await swap.balanceOf(lp.address);

      const removeTx = await swap.connect(lp).removeLiquidity(shares / 2n, 0, 0, lp.address);
      const receipt = await removeTx.wait();
      const event = receipt.logs.find((log) => log.fragment?.name === "LiquidityRemoved");
      expect(event.args.amount0).to.equal(amount0 / 2n);
      expect(event.args.amount1).to.equal(amount1 / 2n);
    });
  });

  describe("swap", function () {
    it("applies fee structure and sends treasury fee", async function () {
      const { lp, trader, swap, token0, token1, treasury } = await loadFixture(deployFixture);
      const reserve0 = ethers.parseEther("10");
      const reserve1 = ethers.parseEther("40");
      await swap.connect(lp).addLiquidity(reserve0, reserve1, 0, lp.address);

      const amountIn = ethers.parseEther("1");
      const swapTx = await swap
        .connect(trader)
        .swap(await token0.getAddress(), amountIn, 0, trader.address);
      const receipt = await swapTx.wait();
      const swapEvent = receipt.logs.find((log) => log.fragment?.name === "Swap");
      const treasuryCut = (amountIn * 5n) / 10_000n;
      const totalFee = (amountIn * 30n) / 10_000n;
      const amountInAfterFee = amountIn - totalFee;
      const expectedOut = (amountInAfterFee * reserve1) / (reserve0 + amountInAfterFee);

      expect(swapEvent.args.treasuryFee).to.equal(treasuryCut);
      expect(swapEvent.args.amountOut).to.equal(expectedOut);

      const treasuryBalance = await token0.balanceOf(treasury.address);
      expect(treasuryBalance).to.equal(treasuryCut);
    });
  });

  describe("quotes", function () {
    it("returns quote for additional liquidity", async function () {
      const { lp, swap } = await loadFixture(deployFixture);
      await swap.connect(lp).addLiquidity(ethers.parseEther("10"), ethers.parseEther("10"), 0, lp.address);

      const [amount0, amount1, shares] = await swap.quoteAddLiquidity(
        ethers.parseEther("5"),
        ethers.parseEther("10")
      );
      expect(amount0).to.equal(ethers.parseEther("5"));
      expect(amount1).to.equal(ethers.parseEther("5"));
      expect(shares).to.be.gt(0n);
    });
  });
});
