import { network } from "hardhat";

const ARCOTC_ADDRESS = "0x5522F89478F9dF853D1D7913828558aC5E16A5c3";
const USDC_ADDRESS   = "0x3600000000000000000000000000000000000000";
const DUMMY_SELLER   = "0x000000000000000000000000000000000000dEaD";

const USDC_ABI = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function balanceOf(address account) external view returns (uint256)",
];

const ARCOTC_ABI = [
  "function createTrade(address _seller, uint256 _amount, uint256 _lockDuration, string _description) external returns (uint256)",
  "function deposit(uint256 _id) external",
  "function release(uint256 _id) external",
  "function refund(uint256 _id) external",
  "function dispute(uint256 _id) external",
  "function expiredRefund(uint256 _id) external",
  "function getTrade(uint256 _id) external view returns (tuple(uint256 id, address buyer, address seller, address arbiter, uint256 amount, uint256 deadline, bool isDeposited, bool isReleased, bool isRefunded, bool isDisputed, string description))",
  "function tradeCount() external view returns (uint256)",
  "function contractBalance() external view returns (uint256)",
];

function randomUSDC(): bigint {
  const usdc = Math.floor(Math.random() * 6) + 1;
  return BigInt(usdc * 1_000_000);
}

function randomDescription(): string {
  const descriptions = [
    "OTC trade: token allocation",
    "P2P deal: NFT purchase",
    "Private sale: whitelist spot",
    "OTC swap: early access tokens",
    "Direct deal: community allocation",
  ];
  return descriptions[Math.floor(Math.random() * descriptions.length)];
}

async function main() {
  const connection = await network.connect("arc");
  const ethers     = connection.ethers;

  const [deployer] = await ethers.getSigners();
  console.log("Using wallet:", deployer.address);

  const usdc   = new ethers.Contract(USDC_ADDRESS, USDC_ABI, deployer);
  const arcotc = new ethers.Contract(ARCOTC_ADDRESS, ARCOTC_ABI, deployer);

  const balance = await usdc.balanceOf(deployer.address);
  console.log("USDC balance:", Number(balance) / 1e6, "USDC");

  const tradeCount = await arcotc.tradeCount();
  console.log("Total trades on contract:", Number(tradeCount));

  const amount       = randomUSDC();
  const description  = randomDescription();
  const usdcDisplay  = Number(amount) / 1e6;
  const lockDuration = 3600;

  console.log(`\nCreating trade: "${description}"`);
  console.log("Amount:", usdcDisplay, "USDC");

  // Step 1 — Create trade
  const createTx = await arcotc.createTrade(
    DUMMY_SELLER,
    amount,
    lockDuration,
    description
  );
  await createTx.wait();
  const newTradeId = Number(tradeCount);
  console.log("✅ Trade created! ID:", newTradeId, "Tx:", createTx.hash);

  // Step 2 — Approve USDC
  console.log("\nStep 1: Approving", usdcDisplay, "USDC...");
  const approveTx = await usdc.approve(ARCOTC_ADDRESS, amount);
  await approveTx.wait();
  console.log("✅ Approved! Tx:", approveTx.hash);

  // Step 3 — Deposit
  console.log("\nStep 2: Depositing into trade #" + newTradeId + "...");
  const depositTx = await arcotc.deposit(newTradeId);
  await depositTx.wait();
  console.log("✅ Deposited! Tx:", depositTx.hash);

  // Step 4 — View trade state
  const trade    = await arcotc.getTrade(newTradeId);
  const deadline = new Date(Number(trade.deadline) * 1000).toLocaleTimeString();
  console.log("Timelock expires at:", deadline);
  console.log("Contract balance:", Number(await arcotc.contractBalance()) / 1e6, "USDC");

  // Step 5 — Release
  console.log("\nStep 3: Releasing funds...");
  const releaseTx = await arcotc.release(newTradeId);
  await releaseTx.wait();
  console.log("✅ Released! Tx:", releaseTx.hash);
  console.log("Contract balance after release:", Number(await arcotc.contractBalance()) / 1e6, "USDC");

  console.log("\n🎉 Trade #" + newTradeId + " complete!");
  console.log("Total trades:", Number(await arcotc.tradeCount()));
  console.log("Explorer: https://testnet.arcscan.app/address/" + ARCOTC_ADDRESS);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
