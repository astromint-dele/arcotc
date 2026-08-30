// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20 {
    function transferFrom(address sender, address recipient, uint256 amount) external returns (bool);
    function transfer(address recipient, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

contract ArcOTC {

    // --- State ---
    address public owner;
    address public feeWallet;
    uint256 public feeBps; // basis points, 50 = 0.5%
    IERC20 public usdc;
    uint256 public tradeCount;

    struct Trade {
        uint256 id;
        address buyer;
        address seller;
        address arbiter;
        uint256 amount;
        uint256 deadline;
        bool isDeposited;
        bool isReleased;
        bool isRefunded;
        bool isDisputed;
        string description;
    }

    mapping(uint256 => Trade) public trades;

    // --- Events ---
    event TradeCreated(uint256 indexed id, address buyer, address seller, uint256 amount, uint256 deadline, string description);
    event Deposited(uint256 indexed id, address buyer, uint256 amount);
    event Released(uint256 indexed id, address seller, uint256 amount, uint256 fee);
    event Refunded(uint256 indexed id, address buyer, uint256 amount);
    event Disputed(uint256 indexed id, address raisedBy);
    event ExpiredRefund(uint256 indexed id, address buyer, uint256 amount);
    event FeeUpdated(uint256 newFeeBps);

    // --- Modifiers ---
    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner");
        _;
    }

    modifier tradeExists(uint256 _id) {
        require(_id < tradeCount, "Trade not found");
        _;
    }

    // --- Constructor ---
    constructor(address _usdcAddress, address _feeWallet, uint256 _feeBps) {
        owner     = msg.sender;
        usdc      = IERC20(_usdcAddress);
        feeWallet = _feeWallet;
        feeBps    = _feeBps;
    }

    // --- Create a new trade ---
    function createTrade(
        address _seller,
        uint256 _amount,
        uint256 _lockDuration,
        string calldata _description
    ) external returns (uint256) {
        require(_amount > 0, "Amount must be > 0");
        require(_seller != msg.sender, "Buyer cannot be seller");
        require(_lockDuration > 0, "Duration must be > 0");

        uint256 id = tradeCount;

        trades[id] = Trade({
            id:          id,
            buyer:       msg.sender,
            seller:      _seller,
            arbiter:     owner,
            amount:      _amount,
            deadline:    block.timestamp + _lockDuration,
            isDeposited: false,
            isReleased:  false,
            isRefunded:  false,
            isDisputed:  false,
            description: _description
        });

        tradeCount += 1;

        emit TradeCreated(id, msg.sender, _seller, _amount, block.timestamp + _lockDuration, _description);
        return id;
    }

    // --- Buyer deposits USDC ---
    function deposit(uint256 _id) external tradeExists(_id) {
        Trade storage t = trades[_id];
        require(msg.sender == t.buyer, "Only buyer");
        require(!t.isDeposited, "Already deposited");
        require(block.timestamp <= t.deadline, "Trade expired");

        bool success = usdc.transferFrom(msg.sender, address(this), t.amount);
        require(success, "Transfer failed");

        t.isDeposited = true;
        emit Deposited(_id, msg.sender, t.amount);
    }

    // --- Release funds to seller (buyer or arbiter) ---
    function release(uint256 _id) external tradeExists(_id) {
        Trade storage t = trades[_id];
        require(msg.sender == t.buyer || msg.sender == t.arbiter, "Not authorized");
        require(t.isDeposited, "Nothing deposited");
        require(!t.isReleased && !t.isRefunded, "Already settled");
        require(block.timestamp <= t.deadline, "Trade expired");

        t.isReleased = true;

        // Calculate fee
        uint256 fee    = (t.amount * feeBps) / 10000;
        uint256 payout = t.amount - fee;

        if (fee > 0) {
            bool feeSuccess = usdc.transfer(feeWallet, fee);
            require(feeSuccess, "Fee transfer failed");
        }

        bool success = usdc.transfer(t.seller, payout);
        require(success, "Transfer failed");

        emit Released(_id, t.seller, payout, fee);
    }

    // --- Refund buyer (arbiter only) ---
    function refund(uint256 _id) external tradeExists(_id) {
        Trade storage t = trades[_id];
        require(msg.sender == t.arbiter, "Only arbiter");
        require(t.isDeposited, "Nothing deposited");
        require(!t.isReleased && !t.isRefunded, "Already settled");

        t.isRefunded = true;
        bool success = usdc.transfer(t.buyer, t.amount);
        require(success, "Transfer failed");

        emit Refunded(_id, t.buyer, t.amount);
    }

    // --- Raise a dispute ---
    function dispute(uint256 _id) external tradeExists(_id) {
        Trade storage t = trades[_id];
        require(msg.sender == t.buyer || msg.sender == t.seller, "Not a party");
        require(t.isDeposited, "Nothing deposited");
        require(!t.isReleased && !t.isRefunded, "Already settled");

        t.isDisputed = true;
        emit Disputed(_id, msg.sender);
    }

    // --- Expired refund (anyone can trigger after deadline) ---
    function expiredRefund(uint256 _id) external tradeExists(_id) {
        Trade storage t = trades[_id];
        require(t.isDeposited, "Nothing deposited");
        require(!t.isReleased && !t.isRefunded, "Already settled");
        require(block.timestamp > t.deadline, "Not expired yet");

        t.isRefunded = true;
        bool success = usdc.transfer(t.buyer, t.amount);
        require(success, "Transfer failed");

        emit ExpiredRefund(_id, t.buyer, t.amount);
    }

    // --- View trade details ---
    function getTrade(uint256 _id) external view tradeExists(_id) returns (Trade memory) {
        return trades[_id];
    }

    // --- Owner functions ---
    function setFeeWallet(address _feeWallet) external onlyOwner {
        feeWallet = _feeWallet;
    }

    function setFeeBps(uint256 _feeBps) external onlyOwner {
        require(_feeBps <= 500, "Max 5%");
        feeBps = _feeBps;
        emit FeeUpdated(_feeBps);
    }

    function contractBalance() external view returns (uint256) {
        return usdc.balanceOf(address(this));
    }
}