const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

const ZERO_ADDRESS = ethers.ZeroAddress;

async function deployVaultFixture() {
  const [deployer, guardianA, guardianB, guardianC, beneficiary] = await ethers.getSigners();
  const GuardianVault = await ethers.getContractFactory("GuardianVault");
  const vault = await GuardianVault.deploy(
    [guardianA.address, guardianB.address, guardianC.address],
    2,
    deployer.address
  );
  await vault.waitForDeployment();

  return {
    vault,
    deployer,
    guardianA,
    guardianB,
    guardianC,
    beneficiary,
  };
}

async function fundVault(vault, sender, amountEth = "10") {
  await sender.sendTransaction({ to: await vault.getAddress(), value: ethers.parseEther(amountEth) });
}

describe("GuardianVault", function () {
  describe("deployment", function () {
    it("sets roles and approvals", async function () {
      const { vault, guardianA } = await deployVaultFixture();
      expect(await vault.guardianCount()).to.equal(4); // deployer included
      expect(await vault.approvalsRequired()).to.equal(2);
      expect(await vault.hasRole(await vault.GUARDIAN_ROLE(), guardianA.address)).to.be.true;
    });
  });

  describe("withdrawal flow", function () {
    it("requires threshold approvals before executing", async function () {
      const { vault, guardianA, guardianB, guardianC, beneficiary, deployer } = await deployVaultFixture();
      await fundVault(vault, deployer, "5");

      const requestId = await vault.nextRequestId();
      await vault
        .connect(guardianA)
        .createWithdrawal(ZERO_ADDRESS, beneficiary.address, ethers.parseEther("1"), 0);

      await expect(vault.connect(guardianA).executeWithdrawal(requestId)).to.be.revertedWith(
        "Insufficient approvals"
      );

      await vault.connect(guardianA).approveWithdrawal(requestId);
      await vault.connect(guardianB).approveWithdrawal(requestId);

      await expect(() => vault.connect(guardianC).executeWithdrawal(requestId)).to.changeEtherBalances(
        [beneficiary, vault],
        [ethers.parseEther("1"), ethers.parseEther("-1")]
      );

      const stored = await vault.getWithdrawal(requestId);
      expect(stored.executed).to.be.true;
    });

    it("supports ERC20 withdrawals", async function () {
      const { vault, guardianA, guardianB, beneficiary, deployer } = await deployVaultFixture();
      const Token = await ethers.getContractFactory("TestToken");
      const token = await Token.deploy("Test", "TEST");
      await token.waitForDeployment();

      const amount = ethers.parseUnits("100", 18);
      await token.mint(await vault.getAddress(), amount);

      const requestId = await vault.nextRequestId();

      await vault
        .connect(guardianA)
        .createWithdrawal(await token.getAddress(), beneficiary.address, amount, 0);

      await vault.connect(guardianA).approveWithdrawal(requestId);
      await vault.connect(guardianB).approveWithdrawal(requestId);

      await vault.connect(guardianA).executeWithdrawal(requestId);

      expect(await token.balanceOf(beneficiary.address)).to.equal(amount);
    });

    it("respects deadlines and pausing", async function () {
      const { vault, guardianA, guardianB, deployer, beneficiary } = await deployVaultFixture();
      await fundVault(vault, deployer, "2");

      const deadline = (await time.latest()) + 60;
      const requestId = await vault.nextRequestId();
      await vault
        .connect(guardianA)
        .createWithdrawal(ZERO_ADDRESS, beneficiary.address, ethers.parseEther("1"), deadline);

      await vault.connect(guardianA).approveWithdrawal(requestId);
      await vault.connect(guardianB).approveWithdrawal(requestId);

      await vault.pause();
      await expect(vault.connect(guardianA).executeWithdrawal(requestId)).to.be.revertedWithCustomError(
        vault,
        "EnforcedPause"
      );
      await vault.unpause();

      await time.increaseTo(deadline + 1);
      await expect(vault.connect(guardianA).executeWithdrawal(requestId)).to.be.revertedWith("Expired");
    });
  });

  describe("administration", function () {
    it("allows adjusting threshold within guardian count", async function () {
      const { vault, deployer } = await deployVaultFixture();
      await vault.connect(deployer).setApprovalsRequired(3);
      expect(await vault.approvalsRequired()).to.equal(3);
      await expect(vault.connect(deployer).setApprovalsRequired(10)).to.be.revertedWith("Exceeds guardians");
    });

    it("cancels withdrawal and revokes approvals", async function () {
      const { vault, guardianA, guardianB, deployer, beneficiary } = await deployVaultFixture();
      const requestId = await vault.nextRequestId();
      await vault
        .connect(guardianA)
        .createWithdrawal(ZERO_ADDRESS, beneficiary.address, ethers.parseEther("1"), 0);

      await vault.connect(guardianA).approveWithdrawal(requestId);
      await vault.connect(guardianB).approveWithdrawal(requestId);

      await vault.connect(deployer).cancelWithdrawal(requestId);
      const stored = await vault.getWithdrawal(requestId);
      expect(stored.cancelled).to.be.true;
      await expect(vault.connect(guardianA).executeWithdrawal(requestId)).to.be.revertedWith("Inactive");
    });
  });
});
