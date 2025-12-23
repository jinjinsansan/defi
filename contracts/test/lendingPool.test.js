const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");

const MAX_UINT = ethers.MaxUint256;
const toWei = (value) => ethers.parseEther(value);

const COLLATERAL_FACTOR = toWei("0.7");
const LIQ_THRESHOLD = toWei("0.8");
const LIQ_BONUS = toWei("1.05");
const INTEREST_RATE = toWei("0.000001");
const FEED_DECIMALS = 8;
const collateralPriceFeed = ethers.parseUnits("2", FEED_DECIMALS); // $2
const debtPriceFeed = ethers.parseUnits("1", FEED_DECIMALS); // $1

async function deployFixture() {
  const [admin, user, liquidator] = await ethers.getSigners();
  const Token = await ethers.getContractFactory("TestToken");
  const collateral = await Token.deploy("Collateral", "COL");
  await collateral.waitForDeployment();
  const debt = await Token.deploy("Debt", "DEBT");
  await debt.waitForDeployment();

  const Aggregator = await ethers.getContractFactory("MockV3Aggregator");
  const collateralOracle = await Aggregator.deploy(FEED_DECIMALS, collateralPriceFeed);
  await collateralOracle.waitForDeployment();
  const debtOracle = await Aggregator.deploy(FEED_DECIMALS, debtPriceFeed);
  await debtOracle.waitForDeployment();

  const LendingPool = await ethers.getContractFactory("LendingPool");
  const pool = await LendingPool.deploy(
    collateral,
    debt,
    COLLATERAL_FACTOR,
    LIQ_THRESHOLD,
    LIQ_BONUS,
    INTEREST_RATE,
    admin.address,
    collateralOracle,
    debtOracle,
  );
  await pool.waitForDeployment();

  await collateral.mint(user.address, toWei("1000"));
  await debt.mint(admin.address, toWei("2000"));
  await debt.mint(user.address, toWei("200"));
  await debt.mint(liquidator.address, toWei("500"));

  await collateral.connect(user).approve(pool, MAX_UINT);
  await debt.connect(admin).approve(pool, MAX_UINT);
  await debt.connect(user).approve(pool, MAX_UINT);
  await debt.connect(liquidator).approve(pool, MAX_UINT);

  await pool.connect(admin).provideLiquidity(toWei("1000"));

  return { admin, user, liquidator, collateral, debt, pool, collateralOracle, debtOracle };
}

describe("LendingPool", function () {
  it("allows borrowing within collateral factor", async function () {
    const { pool, user } = await loadFixture(deployFixture);
    await pool.connect(user).depositCollateral(toWei("100"));
    await pool.connect(user).borrow(toWei("120"));
    await expect(pool.connect(user).borrow(toWei("30"))).to.be.revertedWith("Insufficient collateral");
  });

  it("accrues interest over time", async function () {
    const { pool, user } = await loadFixture(deployFixture);
    await pool.connect(user).depositCollateral(toWei("150"));
    await pool.connect(user).borrow(toWei("50"));
    await time.increase(24 * 60 * 60);
    const debt = await pool.getBorrowBalance(user.address);
    expect(debt).to.be.gt(toWei("50"));
  });

  it("prevents withdrawing collateral below required health", async function () {
    const { pool, user } = await loadFixture(deployFixture);
    await pool.connect(user).depositCollateral(toWei("120"));
    await pool.connect(user).borrow(toWei("60"));
    await expect(pool.connect(user).withdrawCollateral(toWei("90"))).to.be.revertedWith(
      "Insufficient collateral",
    );
  });

  it("allows repayment and clears debt", async function () {
    const { pool, user } = await loadFixture(deployFixture);
    await pool.connect(user).depositCollateral(toWei("80"));
    await pool.connect(user).borrow(toWei("40"));
    const repaid = await pool.connect(user).repay(toWei("100"));
    await repaid.wait();
    const remaining = await pool.getBorrowBalance(user.address);
    expect(remaining).to.equal(0);
  });

  it("allows liquidation when account unhealthy", async function () {
    const { pool, user, liquidator, collateralOracle } = await loadFixture(deployFixture);
    await pool.connect(user).depositCollateral(toWei("100"));
    await pool.connect(user).borrow(toWei("70"));
    await collateralOracle.updateAnswer(ethers.parseUnits("0.5", FEED_DECIMALS));
    await expect(
      pool.connect(liquidator).liquidate(user.address, toWei("10")),
    ).to.emit(pool, "Liquidated");
  });

  it("restricts manager withdrawals to available liquidity", async function () {
    const { pool, admin, user } = await loadFixture(deployFixture);
    await pool.connect(user).depositCollateral(toWei("100"));
    await pool.connect(user).borrow(toWei("60"));
    await expect(pool.connect(admin).withdrawLiquidity(toWei("950"))).to.be.revertedWith(
      "Insufficient liquidity",
    );
  });

  it("exposes price data", async function () {
    const { pool } = await loadFixture(deployFixture);
    const [collateralPrice, debtPrice] = await pool.getPriceData();
    expect(collateralPrice).to.equal(ethers.parseEther("2"));
    expect(debtPrice).to.equal(ethers.parseEther("1"));
  });
});
