import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { network } from "hardhat";

const FEE_BPS = 50; // 0.5%
const AMOUNT = 1_000_000n; // 1 mock USDC (6 decimals)
const MIN_LOCK_DURATION = 60 * 60; // must match ArcOTC.MIN_LOCK_DURATION
const GRACE_PERIOD = 24 * 60 * 60; // must match ArcOTC.EXPIRED_REFUND_GRACE_PERIOD

describe("ArcOTC", async function () {
  const { ethers } = await network.getOrCreate("hardhatMainnet");

  async function increaseTime(seconds: number) {
    await ethers.provider.send("evm_increaseTime", [seconds]);
    await ethers.provider.send("evm_mine", []);
  }

  async function deployFixture() {
    const [ownerArbiter, buyer, seller, other] = await ethers.getSigners();

    const usdc = await ethers.deployContract("MockUSDC");
    const arcotc = await ethers.deployContract("ArcOTC", [
      await usdc.getAddress(),
      ownerArbiter.address,
      FEE_BPS,
    ]);

    await usdc.mint(buyer.address, AMOUNT * 10n);
    await usdc.connect(buyer).approve(await arcotc.getAddress(), AMOUNT * 10n);

    return { ownerArbiter, buyer, seller, other, usdc, arcotc };
  }

  // Creates trade #0 (buyer -> seller) and deposits into it. Every test that
  // needs a live, funded trade starts from this so the id is always 0n.
  async function createAndDeposit(lockDuration: number = MIN_LOCK_DURATION) {
    const ctx = await deployFixture();

    await ctx.arcotc
      .connect(ctx.buyer)
      .createTrade(ctx.seller.address, AMOUNT, lockDuration, "test trade");

    await ctx.arcotc.connect(ctx.buyer).deposit(0n);

    return ctx;
  }

  it("rejects a second deposit on the same trade", async function () {
    const { arcotc, buyer } = await createAndDeposit();

    await assert.rejects(
      arcotc.connect(buyer).deposit(0n),
      /Already deposited/,
    );
  });

  it("blocks the buyer from calling release() after the deadline", async function () {
    const { arcotc, buyer } = await createAndDeposit();

    await increaseTime(MIN_LOCK_DURATION + 1);

    await assert.rejects(
      arcotc.connect(buyer).release(0n),
      /Trade expired/,
    );
  });

  it("still lets the arbiter release() after the deadline (required so a dispute can be resolved post-expiry)", async function () {
    const { arcotc, ownerArbiter } = await createAndDeposit();

    await increaseTime(MIN_LOCK_DURATION + 1);
    await arcotc.connect(ownerArbiter).release(0n);

    const trade = await arcotc.getTrade(0n);
    assert.equal(trade.isReleased, true);
  });

  it("rejects refund() from anyone but the arbiter", async function () {
    const { arcotc, buyer, seller, other } = await createAndDeposit();

    await assert.rejects(arcotc.connect(buyer).refund(0n), /Only arbiter/);
    await assert.rejects(arcotc.connect(seller).refund(0n), /Only arbiter/);
    await assert.rejects(arcotc.connect(other).refund(0n), /Only arbiter/);
  });

  it("blocks release() once a dispute is raised, even by the buyer before the deadline", async function () {
    const { arcotc, buyer, seller } = await createAndDeposit();

    await arcotc.connect(seller).dispute(0n);

    await assert.rejects(
      arcotc.connect(buyer).release(0n),
      /Disputed: arbiter only/,
    );
  });

  it("still lets the arbiter resolve a disputed trade via release()", async function () {
    const { arcotc, ownerArbiter, seller } = await createAndDeposit();

    await arcotc.connect(seller).dispute(0n);
    await arcotc.connect(ownerArbiter).release(0n);

    const trade = await arcotc.getTrade(0n);
    assert.equal(trade.isReleased, true);
  });

  it("blocks expiredRefund() before the grace period has elapsed", async function () {
    const { arcotc, other } = await createAndDeposit();

    await increaseTime(MIN_LOCK_DURATION + 1); // deadline passed, grace period has not

    await assert.rejects(
      arcotc.connect(other).expiredRefund(0n),
      /Grace period active/,
    );
  });

  it("allows expiredRefund() once the grace period has elapsed with no dispute", async function () {
    const { arcotc, other } = await createAndDeposit();

    await increaseTime(MIN_LOCK_DURATION + GRACE_PERIOD + 1);
    await arcotc.connect(other).expiredRefund(0n);

    const trade = await arcotc.getTrade(0n);
    assert.equal(trade.isRefunded, true);
  });

  it("blocks expiredRefund() outright once disputed, even after the grace period — this is the buyer-grief fix", async function () {
    const { arcotc, seller, other } = await createAndDeposit();

    await increaseTime(MIN_LOCK_DURATION + 1);
    await arcotc.connect(seller).dispute(0n);
    await increaseTime(GRACE_PERIOD + 1);

    await assert.rejects(
      arcotc.connect(other).expiredRefund(0n),
      /Disputed: arbiter must resolve/,
    );
  });

  it("rejects createTrade() with a lockDuration below the minimum", async function () {
    const { arcotc, buyer, seller } = await deployFixture();

    await assert.rejects(
      arcotc
        .connect(buyer)
        .createTrade(seller.address, AMOUNT, MIN_LOCK_DURATION - 1, "too short"),
      /Lock duration too short/,
    );
  });

  it("rejects createTrade() with seller == address(0)", async function () {
    const { arcotc, buyer } = await deployFixture();

    await assert.rejects(
      arcotc
        .connect(buyer)
        .createTrade(ethers.ZeroAddress, AMOUNT, MIN_LOCK_DURATION, "zero seller"),
      /Seller cannot be zero address/,
    );
  });

  it("documents fee rounding at small amounts: fee = amount * feeBps / 10000 truncates to 0 below 200 units", async function () {
    // At FEE_BPS = 50, fee is nonzero only once amount * 50 >= 10000, i.e. amount >= 200.
    // 1 and 199 units round the fee down to 0 (buyer/seller get the full amount,
    // protocol gets nothing); 200 is the first amount where a fee is actually collected.
    const cases = [
      { amount: 1n, expectedFee: 0n },
      { amount: 199n, expectedFee: 0n },
      { amount: 200n, expectedFee: 1n },
    ];

    for (const { amount, expectedFee } of cases) {
      const { arcotc, buyer, seller } = await deployFixture();

      await arcotc
        .connect(buyer)
        .createTrade(seller.address, amount, MIN_LOCK_DURATION, "rounding check");
      await arcotc.connect(buyer).deposit(0n);

      const tx = await arcotc.connect(buyer).release(0n);
      const receipt = await tx.wait();

      const events = await arcotc.queryFilter(
        arcotc.filters.Released(0n),
        receipt!.blockNumber,
        receipt!.blockNumber,
      );
      assert.equal(events.length, 1);

      const { amount: payout, fee } = events[0].args;
      assert.equal(fee, expectedFee, `amount=${amount}: expected fee ${expectedFee}, got ${fee}`);
      assert.equal(payout, amount - expectedFee, `amount=${amount}: expected payout ${amount - expectedFee}, got ${payout}`);
    }
  });
});
