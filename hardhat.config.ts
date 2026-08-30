import "dotenv/config";
import { defineConfig, configVariable } from "hardhat/config";
import hardhatEthers from "@nomicfoundation/hardhat-ethers";
import hardhatNodeTestRunner from "@nomicfoundation/hardhat-node-test-runner";

export default defineConfig({
  plugins: [hardhatEthers, hardhatNodeTestRunner],
  solidity: "0.8.20",
  networks: {
    hardhatMainnet: {
      type: "edr-simulated",
      chainType: "l1",
    },
    arc: {
      type: "http",
      url: "https://rpc.testnet.arc.network",
      chainId: 5042002,
      accounts: [configVariable("ARC_PRIVATE_KEY")],
    },
  },
});
