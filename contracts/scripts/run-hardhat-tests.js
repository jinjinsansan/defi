const { run } = require("hardhat");

async function main() {
  const files = process.argv.slice(2);
  await run("test", files.length ? { testFiles: files } : undefined);
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
