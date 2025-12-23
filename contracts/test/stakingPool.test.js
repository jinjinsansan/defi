const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");

const MAX_UINT = ethers.MaxUint256;

async function deployFixture() {
  const [admin, user, other] = await ethers.getSigners();
  const Token = await ethers.getContractFactory("TestToken");
  const stakingToken = await Token.deploy("Stake", "STK");
  await stakingToken.waitForDeployment();
  const rewardToken = await Token.deploy("Reward", "RWD");
  await rewardToken.waitForDeployment();

  const rewardRate = ethers.parseEther("0.1");
  const StakingPool = await ethers.getContractFactory("StakingPool");
  const pool = await StakingPool.deploy(stakingToken, rewardToken, rewardRate, admin.address);
  await pool.waitForDeployment();

  await stakingToken.mint(user.address, ethers.parseEther("1000"));
  await rewardToken.mint(await pool.getAddress(), ethers.parseEther("1000"));

  await stakingToken.connect(user).approve(pool, MAX_UINT);

  return { admin, user, other, stakingToken, rewardToken, pool, rewardRate };
}

describe("StakingPool", function () {
  it("accrues rewards over time", async function () {
    const { user, pool, rewardToken, rewardRate } = await loadFixture(deployFixture);
    const amount = ethers.parseEther("10");
    await pool.connect(user).deposit(amount);

    await time.increase(10);
    await pool.connect(user).withdraw(amount);

    const earned = await rewardToken.balanceOf(user.address);
    expect(earned).to.be.closeTo(rewardRate * 10n, rewardRate);
  });

  it("supports emergency withdraw without rewards", async function () {
    const { user, pool, stakingToken } = await loadFixture(deployFixture);
    const amount = ethers.parseEther("5");
    await pool.connect(user).deposit(amount);
    await pool.connect(user).emergencyWithdraw();
    const balance = await stakingToken.balanceOf(user.address);
    expect(balance).to.equal(ethers.parseEther("1000"));
  });

  it("allows reward rate adjustments", async function () {
    const { admin, pool } = await loadFixture(deployFixture);
    await pool.connect(admin).setRewardRate(ethers.parseEther("0.2"));
    expect(await pool.rewardRate()).to.equal(ethers.parseEther("0.2"));
  });
});
