const fs = require("fs");
const path = require("path");

const CONTRACTS = [
  { name: "GuardianVault", artifactPath: ["contracts", "GuardianVault.sol", "GuardianVault.json"] },
  { name: "SimpleSwap", artifactPath: ["contracts", "amm", "SimpleSwap.sol", "SimpleSwap.json"] },
  { name: "StakingPool", artifactPath: ["contracts", "staking", "StakingPool.sol", "StakingPool.json"] },
  { name: "LendingPool", artifactPath: ["contracts", "lending", "LendingPool.sol", "LendingPool.json"] },
];

function ensureFile(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Required file not found: ${filePath}`);
  }
}

function copyFile(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

function main() {
  const contractsDir = path.resolve(__dirname, "..");
  const webDir = path.resolve(contractsDir, "../web/src/lib/contracts");
  fs.mkdirSync(webDir, { recursive: true });

const typechainDir = path.join(contractsDir, "typechain-types");
const typechainDest = path.join(webDir, "types");
ensureFile(path.join(typechainDir, "index.ts"));

  for (const contract of CONTRACTS) {
    const artifactSrc = path.join(contractsDir, "artifacts", ...contract.artifactPath);
    ensureFile(artifactSrc);
    const abiDest = path.join(webDir, "abi", `${contract.name}.json`);
    copyFile(artifactSrc, abiDest);
  }

fs.rmSync(typechainDest, { recursive: true, force: true });
fs.mkdirSync(typechainDest, { recursive: true });
fs.cpSync(typechainDir, typechainDest, { recursive: true });

  console.log("Artifacts synced to web project.");
}

main();
