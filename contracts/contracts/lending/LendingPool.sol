// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {AggregatorV3Interface} from "../interfaces/AggregatorV3Interface.sol";

contract LendingPool is AccessControl, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20Metadata;

    bytes32 public constant MANAGER_ROLE = keccak256("MANAGER_ROLE");
    uint256 private constant WAD = 1e18;
    uint256 private constant PRICE_PRECISION = 1e18;
    uint256 private constant MAX_ORACLE_DELAY = 1 hours;

    IERC20Metadata public immutable collateralToken;
    IERC20Metadata public immutable debtToken;
    uint8 public immutable collateralTokenDecimals;
    uint8 public immutable debtTokenDecimals;
    AggregatorV3Interface public collateralOracle;
    AggregatorV3Interface public debtOracle;

    uint256 public collateralFactor; // scaled by 1e18
    uint256 public liquidationThreshold; // scaled by 1e18
    uint256 public liquidationBonus; // scaled by 1e18 (>= 1e18)
    uint256 public interestRatePerSecond; // scaled by 1e18

    uint256 public totalCollateral;
    uint256 public totalBorrows;
    uint256 public borrowIndex;
    uint256 public lastAccrual;

    struct Account {
        uint256 collateral;
        uint256 borrowBase;
    }

    mapping(address => Account) public accounts;

    event CollateralDeposited(address indexed user, uint256 amount);
    event CollateralWithdrawn(address indexed user, uint256 amount);
    event Borrowed(address indexed user, uint256 amount);
    event Repaid(address indexed user, uint256 amount);
    event Liquidated(address indexed liquidator, address indexed borrower, uint256 repayAmount, uint256 collateralSeized);
    event InterestAccrued(uint256 interestAmount, uint256 newBorrowIndex);
    event LiquidityProvided(address indexed provider, uint256 amount);
    event LiquidityWithdrawn(address indexed provider, uint256 amount);
    event ParametersUpdated(uint256 collateralFactor, uint256 liquidationThreshold, uint256 liquidationBonus);
    event InterestRateUpdated(uint256 newRate);
    event OraclesUpdated(address collateralOracle, address debtOracle);

    constructor(
        IERC20Metadata _collateralToken,
        IERC20Metadata _debtToken,
        uint256 _collateralFactor,
        uint256 _liquidationThreshold,
        uint256 _liquidationBonus,
        uint256 _interestRatePerSecond,
        address admin,
        AggregatorV3Interface _collateralOracle,
        AggregatorV3Interface _debtOracle
    ) {
        require(address(_collateralToken) != address(0), "Collateral token zero");
        require(address(_debtToken) != address(0), "Debt token zero");
        require(admin != address(0), "Admin zero");
        require(address(_collateralOracle) != address(0), "Oracle zero");
        require(address(_debtOracle) != address(0), "Oracle zero");
        _validateRiskParams(_collateralFactor, _liquidationThreshold, _liquidationBonus);

        collateralToken = _collateralToken;
        debtToken = _debtToken;
        collateralTokenDecimals = _collateralToken.decimals();
        debtTokenDecimals = _debtToken.decimals();
        collateralOracle = _collateralOracle;
        debtOracle = _debtOracle;
        collateralFactor = _collateralFactor;
        liquidationThreshold = _liquidationThreshold;
        liquidationBonus = _liquidationBonus;
        interestRatePerSecond = _interestRatePerSecond;
        borrowIndex = WAD;
        lastAccrual = block.timestamp;

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(MANAGER_ROLE, admin);
    }

    function depositCollateral(uint256 amount) external nonReentrant whenNotPaused {
        require(amount > 0, "Amount zero");
        _accrueInterest();
        Account storage account = accounts[msg.sender];
        account.collateral += amount;
        totalCollateral += amount;
        collateralToken.safeTransferFrom(msg.sender, address(this), amount);
        emit CollateralDeposited(msg.sender, amount);
    }

    function withdrawCollateral(uint256 amount) external nonReentrant {
        require(amount > 0, "Amount zero");
        _accrueInterest();
        Account storage account = accounts[msg.sender];
        require(account.collateral >= amount, "Insufficient collateral");
        account.collateral -= amount;
        totalCollateral -= amount;
        require(_isSolvent(account), "Insufficient collateral");
        collateralToken.safeTransfer(msg.sender, amount);
        emit CollateralWithdrawn(msg.sender, amount);
    }

    function borrow(uint256 amount) external nonReentrant whenNotPaused {
        require(amount > 0, "Amount zero");
        _accrueInterest();
        require(amount <= debtToken.balanceOf(address(this)), "Insufficient liquidity");
        Account storage account = accounts[msg.sender];
        _increaseBorrow(account, amount);
        require(_isSolvent(account), "Insufficient collateral");
        debtToken.safeTransfer(msg.sender, amount);
        emit Borrowed(msg.sender, amount);
    }

    function repay(uint256 amount) external nonReentrant returns (uint256 actualRepay) {
        require(amount > 0, "Amount zero");
        _accrueInterest();
        Account storage account = accounts[msg.sender];
        actualRepay = _decreaseBorrow(account, amount);
        require(actualRepay > 0, "Nothing to repay");
        debtToken.safeTransferFrom(msg.sender, address(this), actualRepay);
        emit Repaid(msg.sender, actualRepay);
    }

    function liquidate(address borrower, uint256 repayAmount) external nonReentrant whenNotPaused {
        require(borrower != msg.sender, "Self liquidation");
        require(repayAmount > 0, "Amount zero");
        _accrueInterest();
        Account storage account = accounts[borrower];
        require(!_isHealthy(account), "Account healthy");
        uint256 debt = _borrowBalance(account);
        require(debt > 0, "No debt");
        uint256 actualRepay = repayAmount > debt ? debt : repayAmount;
        debtToken.safeTransferFrom(msg.sender, address(this), actualRepay);
        _decreaseBorrow(account, actualRepay);

        uint256 seize = (actualRepay * liquidationBonus) / WAD;
        if (seize > account.collateral) {
            seize = account.collateral;
        }
        account.collateral -= seize;
        totalCollateral -= seize;
        collateralToken.safeTransfer(msg.sender, seize);
        emit Liquidated(msg.sender, borrower, actualRepay, seize);
    }

    function provideLiquidity(uint256 amount) external nonReentrant onlyRole(MANAGER_ROLE) {
        require(amount > 0, "Amount zero");
        debtToken.safeTransferFrom(msg.sender, address(this), amount);
        emit LiquidityProvided(msg.sender, amount);
    }

    function withdrawLiquidity(uint256 amount) external nonReentrant onlyRole(MANAGER_ROLE) {
        require(amount > 0, "Amount zero");
        require(amount <= debtToken.balanceOf(address(this)), "Insufficient liquidity");
        debtToken.safeTransfer(msg.sender, amount);
        emit LiquidityWithdrawn(msg.sender, amount);
    }

    function setRiskParameters(
        uint256 _collateralFactor,
        uint256 _liquidationThreshold,
        uint256 _liquidationBonus
    ) external onlyRole(MANAGER_ROLE) {
        _validateRiskParams(_collateralFactor, _liquidationThreshold, _liquidationBonus);
        collateralFactor = _collateralFactor;
        liquidationThreshold = _liquidationThreshold;
        liquidationBonus = _liquidationBonus;
        emit ParametersUpdated(_collateralFactor, _liquidationThreshold, _liquidationBonus);
    }

    function setInterestRate(uint256 newRate) external onlyRole(MANAGER_ROLE) {
        _accrueInterest();
        interestRatePerSecond = newRate;
        emit InterestRateUpdated(newRate);
    }

    function setOracles(address newCollateralOracle, address newDebtOracle) external onlyRole(MANAGER_ROLE) {
        require(newCollateralOracle != address(0) && newDebtOracle != address(0), "Oracle zero");
        collateralOracle = AggregatorV3Interface(newCollateralOracle);
        debtOracle = AggregatorV3Interface(newDebtOracle);
        emit OraclesUpdated(newCollateralOracle, newDebtOracle);
    }

    function pause() external onlyRole(MANAGER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(MANAGER_ROLE) {
        _unpause();
    }

    function accrueInterest() external {
        _accrueInterest();
    }

    function getAccountData(address user)
        external
        view
        returns (uint256 collateral, uint256 debt, uint256 healthFactor, uint256 borrowLimit)
    {
        Account storage account = accounts[user];
        (uint256 projectedIndex, ) = _previewAccrual();
        collateral = account.collateral;
        debt = _borrowBalanceWithIndex(account, projectedIndex);
        healthFactor = _healthFactor(account.collateral, account.borrowBase, projectedIndex, liquidationThreshold);
        borrowLimit = _maxBorrowInDebtTokens(account.collateral);
    }

    function getPoolData()
        external
        view
        returns (
            uint256 _totalCollateral,
            uint256 _totalBorrows,
            uint256 available,
            uint256 util,
            uint256 index
        )
    {
        (index, _totalBorrows) = _previewAccrual();
        _totalCollateral = totalCollateral;
        available = debtToken.balanceOf(address(this));
        util = _totalBorrows == 0 ? 0 : (_totalBorrows * WAD) / (_totalBorrows + available);
    }

    function availableLiquidity() external view returns (uint256) {
        return debtToken.balanceOf(address(this));
    }

    function utilization() external view returns (uint256) {
        (, uint256 borrows) = _previewAccrual();
        uint256 available = debtToken.balanceOf(address(this));
        return borrows == 0 ? 0 : (borrows * WAD) / (borrows + available);
    }

    function getBorrowBalance(address user) external view returns (uint256) {
        Account storage account = accounts[user];
        (uint256 projectedIndex, ) = _previewAccrual();
        return _borrowBalanceWithIndex(account, projectedIndex);
    }

    function getPriceData() external view returns (uint256 collateralPrice, uint256 debtPrice) {
        collateralPrice = _getScaledPrice(collateralOracle);
        debtPrice = _getScaledPrice(debtOracle);
    }

    function _increaseBorrow(Account storage account, uint256 amount) internal {
        uint256 newBalance = _borrowBalance(account) + amount;
        account.borrowBase = (newBalance * WAD) / borrowIndex;
        totalBorrows += amount;
    }

    function _decreaseBorrow(Account storage account, uint256 amount) internal returns (uint256) {
        uint256 current = _borrowBalance(account);
        if (amount > current) {
            amount = current;
        }
        if (amount == 0) {
            return 0;
        }
        uint256 newBalance = current - amount;
        account.borrowBase = newBalance == 0 ? 0 : (newBalance * WAD) / borrowIndex;
        totalBorrows -= amount;
        return amount;
    }

    function _borrowBalance(Account storage account) internal view returns (uint256) {
        return _borrowBalanceWithIndex(account, borrowIndex);
    }

    function _borrowBalanceWithIndex(Account storage account, uint256 index) internal view returns (uint256) {
        if (account.borrowBase == 0) {
            return 0;
        }
        return (account.borrowBase * index) / WAD;
    }

    function _isSolvent(Account storage account) internal view returns (bool) {
        uint256 debt = _borrowBalance(account);
        if (debt == 0) {
            return true;
        }
        uint256 collateralValue = _collateralValueUsd(account.collateral);
        uint256 debtValue = _debtValueUsd(debt);
        return (collateralValue * collateralFactor) / WAD >= debtValue;
    }

    function _isHealthy(Account storage account) internal view returns (bool) {
        uint256 health = _healthFactor(account.collateral, account.borrowBase, borrowIndex, liquidationThreshold);
        return health >= WAD;
    }

    function _healthFactor(
        uint256 collateralAmount,
        uint256 borrowBase,
        uint256 index,
        uint256 threshold
    ) internal view returns (uint256) {
        if (borrowBase == 0) {
            return type(uint256).max;
        }
        uint256 debt = (borrowBase * index) / WAD;
        if (debt == 0) {
            return type(uint256).max;
        }
        uint256 collateralValue = _collateralValueUsd(collateralAmount);
        uint256 debtValue = _debtValueUsd(debt);
        if (debtValue == 0) {
            return type(uint256).max;
        }
        return (collateralValue * threshold) / debtValue;
    }

    function _previewAccrual() internal view returns (uint256 projectedIndex, uint256 projectedBorrows) {
        projectedIndex = borrowIndex;
        projectedBorrows = totalBorrows;
        if (block.timestamp == lastAccrual || totalBorrows == 0 || interestRatePerSecond == 0) {
            return (projectedIndex, projectedBorrows);
        }
        uint256 delta = block.timestamp - lastAccrual;
        uint256 simpleInterestFactor = interestRatePerSecond * delta;
        uint256 interest = (projectedBorrows * simpleInterestFactor) / WAD;
        projectedBorrows += interest;
        projectedIndex += (projectedIndex * simpleInterestFactor) / WAD;
    }

    function _accrueInterest() internal {
        if (block.timestamp == lastAccrual || totalBorrows == 0 || interestRatePerSecond == 0) {
            lastAccrual = block.timestamp;
            return;
        }
        uint256 delta = block.timestamp - lastAccrual;
        uint256 simpleInterestFactor = interestRatePerSecond * delta;
        uint256 interest = (totalBorrows * simpleInterestFactor) / WAD;
        totalBorrows += interest;
        borrowIndex += (borrowIndex * simpleInterestFactor) / WAD;
        lastAccrual = block.timestamp;
        emit InterestAccrued(interest, borrowIndex);
    }

    function _validateRiskParams(
        uint256 _collateralFactor,
        uint256 _liquidationThreshold,
        uint256 _liquidationBonus
    ) internal pure {
        require(_collateralFactor > 0 && _collateralFactor <= WAD, "Invalid collateral factor");
        require(_liquidationThreshold >= _collateralFactor && _liquidationThreshold <= WAD, "Invalid threshold");
        require(_liquidationBonus >= WAD, "Invalid bonus");
    }

    function _collateralValueUsd(uint256 amount) internal view returns (uint256) {
        return _tokenValueUsd(amount, collateralTokenDecimals, collateralOracle);
    }

    function _debtValueUsd(uint256 amount) internal view returns (uint256) {
        return _tokenValueUsd(amount, debtTokenDecimals, debtOracle);
    }

    function _tokenValueUsd(
        uint256 amount,
        uint8 decimals,
        AggregatorV3Interface oracle
    ) internal view returns (uint256) {
        if (amount == 0) {
            return 0;
        }
        uint256 price = _getScaledPrice(oracle);
        uint256 scale = 10 ** uint256(decimals);
        return (amount * price) / scale;
    }

    function _maxBorrowInDebtTokens(uint256 collateralAmount) internal view returns (uint256) {
        uint256 usdLimit = (_collateralValueUsd(collateralAmount) * collateralFactor) / WAD;
        if (usdLimit == 0) {
            return 0;
        }
        uint256 debtPrice = _getScaledPrice(debtOracle);
        uint256 scale = 10 ** uint256(debtTokenDecimals);
        return (usdLimit * scale) / debtPrice;
    }

    function _getScaledPrice(AggregatorV3Interface oracle) internal view returns (uint256) {
        require(address(oracle) != address(0), "Oracle missing");
        (, int256 answer, , uint256 updatedAt, ) = oracle.latestRoundData();
        require(answer > 0, "Invalid price");
        require(updatedAt != 0 && block.timestamp - updatedAt <= MAX_ORACLE_DELAY, "Stale price");
        uint8 decimals = oracle.decimals();
        uint256 scale = 10 ** uint256(decimals);
        return (uint256(answer) * PRICE_PRECISION) / scale;
    }
}
