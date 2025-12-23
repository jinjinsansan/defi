const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

const ONE_YEAR_IN_SECONDS = 365 * 24 * 60 * 60;

async function deployLock() {
  const unlockTime = (await time.latest()) + ONE_YEAR_IN_SECONDS;
  const lockedAmount = ethers.parseEther("1");
  const [owner, otherAccount] = await ethers.getSigners();

  const Lock = await ethers.getContractFactory("Lock");
  const lock = await Lock.deploy(unlockTime, { value: lockedAmount });
  await lock.waitForDeployment();

  return { lock, unlockTime, lockedAmount, owner, otherAccount };
}

describe("Lock", function () {
  describe("Deployment", function () {
    it("sets the unlock timestamp", async function () {
      const { unlockTime, lock } = await deployLock();
      expect(await lock.unlockTime()).to.equal(unlockTime);
    });

    it("assigns the owner", async function () {
      const { lock, owner } = await deployLock();
      expect(await lock.owner()).to.equal(owner.address);
    });
  });

  describe("Withdrawals", function () {
    it("reverts withdrawal before time", async function () {
      const { lock } = await deployLock();
      await expect(lock.withdraw()).to.be.revertedWith("You can't withdraw yet");
    });

    it("allows owner after unlock", async function () {
      const { lock, unlockTime, lockedAmount, owner } = await deployLock();
      await time.increaseTo(unlockTime);

      const withdrawTx = await lock.withdraw();
      const receipt = await withdrawTx.wait();
      const lockAddress = await lock.getAddress();
      const eventLog = receipt.logs.find((log) => log.address === lockAddress);
      if (!eventLog) {
        throw new Error("Withdrawal event not found");
      }
      const parsed = lock.interface.parseLog(eventLog);
      expect(parsed.args[0]).to.equal(lockedAmount);
      expect(parsed.args[1]).to.be.at.least(unlockTime);

      const lockBalance = await ethers.provider.getBalance(await lock.getAddress());
      expect(lockBalance).to.equal(0n);
      expect(await lock.owner()).to.equal(owner.address);
    });

    it("blocks non-owner after unlock", async function () {
      const { lock, unlockTime, otherAccount } = await deployLock();
      await time.increaseTo(unlockTime);
      await expect(lock.connect(otherAccount).withdraw()).to.be.revertedWith("You aren't the owner");
    });
  });
});
