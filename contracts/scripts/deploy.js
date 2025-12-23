const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

function parseArgs(value) {
  if (!value || !value.trim()) {
    return [];
  }
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) {
      throw new Error("CONSTRUCTOR_ARGS must be a JSON array");
    }
    return parsed;
  } catch (error) {
    throw new Error(`Failed to parse CONSTRUCTOR_ARGS: ${error.message}`);
  }
}

function saveDeployment(networkName, contractName, details) {
  const deploymentsDir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(deploymentsDir, { recursive: true });
  const filePath = path.join(deploymentsDir, `${networkName}.json`);

  let existing = {};
  if (fs.existsSync(filePath)) {
    existing = JSON.parse(fs.readFileSync(filePath, "utf8"));
  }

  existing[contractName] = {
    address: details.address,
    constructorArgs: details.constructorArgs,
    txHash: details.txHash,
    updatedAt: new Date().toISOString(),
  };

  fs.writeFileSync(filePath, JSON.stringify(existing, null, 2));
}

async function main() {
  const { ethers, network } = hre;
  const contractName = process.env.CONTRACT_NAME;
  if (!contractName) {
    throw new Error("CONTRACT_NAME environment variable is required");
  }

  const constructorArgs = parseArgs(process.env.CONSTRUCTOR_ARGS || "[]");

  console.log(`\n🚀 Deploying ${contractName} to ${network.name}...`);
  const factory = await ethers.getContractFactory(contractName);
  const contract = await factory.deploy(...constructorArgs);
  await contract.waitForDeployment();

  const address = await contract.getAddress();
  const tx = contract.deploymentTransaction();
  console.log(`✅ ${contractName} deployed at ${address}`);
  if (tx?.hash) {
    console.log(`   tx: ${tx.hash}`);
  }

  if (network.name !== "hardhat" && network.name !== "localhost") {
    saveDeployment(network.name, contractName, {
      address,
      constructorArgs,
      txHash: tx?.hash || null,
    });
    console.log(`📄 Deployment saved to deployments/${network.name}.json`);
  } else {
    console.log("ℹ️ Local deployments are not persisted.");
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
