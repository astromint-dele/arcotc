# ArcOTC — Trustless P2P OTC Escrow on Arc

A non-custodial OTC trading escrow protocol built natively on [Arc](https://arc.network) by Circle. USDC as gas, on-chain settlement, funds locked in a contract rather than held by an operator.

**Live demo:** https://astromint-dele.github.io/arcotc

## The Problem

OTC trades happen daily on pure trust — someone sends first and hopes the other side delivers. Rugs happen constantly. ArcOTC removes the trust requirement by locking funds in a smart contract until both parties confirm.

## How It Works

1. Buyer calls `createTrade()` with seller address, amount, deadline, and description
2. Buyer approves USDC and calls `deposit()` — funds lock in contract
3. Seller delivers their side of the deal
4. Buyer calls `release()` — USDC goes to seller minus 0.5% protocol fee
5. If dispute arises, arbiter steps in to resolve
6. If deadline passes with no action, `expiredRefund()` returns funds to buyer automatically

## Contract Features

- **Multi-trade** — one contract handles unlimited simultaneous trades, each with a unique ID
- **Timelock** — every trade has a deadline, with a minimum lock duration of 1 hour
- **Expired refund** — after the deadline plus a 24-hour grace period, anyone can trigger a refund to the buyer. No arbiter needed
- **Dispute freeze** — either party can dispute a trade, which blocks expired refund and restricts settlement to the arbiter
- **Fee capture** — 0.5% deducted on every release, sent to the protocol wallet automatically
- **Fully on-chain** — no backend, no custodian, every action verifiable on the explorer

## Trust Model

Read this before using the contract with real funds.

On the happy path — deposit, deliver, release — no third party can touch the funds. If the buyer stalls, the expired refund path returns their USDC without anyone's cooperation.

Once either party calls `dispute()`, that changes. A disputed trade can only be settled by the arbiter, in either direction, with no time limit and no fallback. The arbiter is a single address set at deployment, identical for every trade, with no rotation path. Either party can force a trade into this state at will.

Two consequences follow. The arbiter has standing authority over any contested trade for as long as it stays open. And if the arbiter key is lost or its holder never acts, a disputed trade's funds cannot be moved by any function in the contract.

This is deliberate — it's what stops a buyer from taking delivery and then reclaiming payment — but it means the protocol is trustless on the happy path and arbiter-dependent under dispute.

## Status

Deployed on Arc testnet only. **Unaudited.** Do not use with funds you can't afford to lose.

## Deployed Contracts (Arc Testnet)

| Contract | Address |
|---|---|
| ArcOTC v1 (multi-trade + fee capture) | `0x37530FaE4a39685738113138a84BC9e5a7270C7F` |
| Escrow v2 (timelock) | `0x006F859ca97EcA0EFB3395568d032270b18ad85E` |

Explorer: [testnet.arcscan.app](https://testnet.arcscan.app)

Testnet builder wallet: `0x30A29b88f86001ecb8ec9FB552a558b7eE56D9D0`

## On-Chain Activity

- 4 contracts deployed across two versions
- 62 completed escrow cycles
- Continuous activity since June 2026

## Tech Stack

- **Contracts** — Solidity 0.8.20
- **Tooling** — Hardhat 3 + ethers.js
- **Network** — Arc testnet (Chain ID 5042002)
- **Gas token** — USDC (`0x3600000000000000000000000000000000000000`)

## Getting Started

```bash
git clone https://github.com/astromint-dele/arcotc.git
cd arcotc
npm install
```

Add your private key to `hardhat.config.ts` under `networks.arc.accounts`. Use a dedicated testnet wallet — never a wallet holding real funds.

```bash
npx hardhat compile
npx hardhat run scripts/deploy.ts
npx hardhat run scripts/interact.ts
```

## Roadmap

- [x] Multi-trade architecture with timelock and dispute logic
- [x] Fee capture (0.5%)
- [x] Web interface with wallet connect
- [ ] Marketplace and on-site trade chat
- [ ] Mainnet deployment (Arc public mainnet: September 16, 2026)

## License

MIT
