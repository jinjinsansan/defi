// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

contract SimpleSwap is ERC20, AccessControl, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant MANAGER_ROLE = keccak256("MANAGER_ROLE");

    uint256 private constant FEE_DENOMINATOR = 10_000;
    uint256 private constant TOTAL_FEE_BPS = 30; // 0.30%
    uint256 private constant TREASURY_FEE_BPS = 5; // 0.05% of input goes to treasury

    IERC20 public immutable token0;
    IERC20 public immutable token1;

    address public treasury;

    uint256 public reserve0;
    uint256 public reserve1;

    event LiquidityAdded(address indexed provider, uint256 amount0, uint256 amount1, uint256 shares);
    event LiquidityRemoved(address indexed provider, uint256 amount0, uint256 amount1, uint256 sharesBurned);
    event Swap(
        address indexed trader,
        address indexed tokenIn,
        address indexed tokenOut,
        uint256 amountIn,
        uint256 amountOut,
        uint256 treasuryFee
    );
    event TreasuryUpdated(address indexed newTreasury);

    constructor(
        IERC20 _token0,
        IERC20 _token1,
        address _treasury,
        address admin
    ) ERC20("Guardian Liquidity", "GLP") {
        require(address(_token0) != address(0) && address(_token1) != address(0), "Token zero");
        require(address(_token0) != address(_token1), "Identical tokens");
        require(admin != address(0), "Admin zero");

        token0 = _token0;
        token1 = _token1;
        treasury = _treasury;

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(MANAGER_ROLE, admin);
    }

    function getReserves() external view returns (uint256, uint256) {
        return (reserve0, reserve1);
    }

    function setTreasury(address newTreasury) external onlyRole(MANAGER_ROLE) {
        treasury = newTreasury;
        emit TreasuryUpdated(newTreasury);
    }

    function pause() external onlyRole(MANAGER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(MANAGER_ROLE) {
        _unpause();
    }

    function quoteAddLiquidity(uint256 amount0Desired, uint256 amount1Desired)
        external
        view
        returns (uint256 amount0, uint256 amount1, uint256 shares)
    {
        require(amount0Desired > 0 && amount1Desired > 0, "Invalid amounts");
        if (reserve0 == 0 && reserve1 == 0) {
            amount0 = amount0Desired;
            amount1 = amount1Desired;
            shares = Math.sqrt(amount0 * amount1);
        } else {
            uint256 amount1Optimal = (amount0Desired * reserve1) / reserve0;
            if (amount1Optimal <= amount1Desired) {
                amount0 = amount0Desired;
                amount1 = amount1Optimal;
            } else {
                uint256 amount0Optimal = (amount1Desired * reserve0) / reserve1;
                amount0 = amount0Optimal;
                amount1 = amount1Desired;
            }
            shares = Math.min((amount0 * totalSupply()) / reserve0, (amount1 * totalSupply()) / reserve1);
        }
    }

    function getAmountOut(uint256 amountIn, address tokenIn) external view returns (uint256) {
        bool isToken0In = tokenIn == address(token0);
        bool isToken1In = tokenIn == address(token1);
        require(isToken0In || isToken1In, "Unsupported token");
        uint256 feeTotal = (amountIn * TOTAL_FEE_BPS) / FEE_DENOMINATOR;
        uint256 amountInAfterFee = amountIn - feeTotal;
        (uint256 reserveIn, uint256 reserveOut) = isToken0In ? (reserve0, reserve1) : (reserve1, reserve0);
        return _getAmountOut(amountInAfterFee, reserveIn, reserveOut);
    }

    function addLiquidity(
        uint256 amount0Desired,
        uint256 amount1Desired,
        uint256 minShares,
        address to
    ) external whenNotPaused nonReentrant returns (uint256 shares, uint256 amount0, uint256 amount1) {
        require(amount0Desired > 0 && amount1Desired > 0, "Invalid amounts");
        require(to != address(0), "Invalid receiver");

        (uint256 _reserve0, uint256 _reserve1) = (reserve0, reserve1);

        if (_reserve0 == 0 && _reserve1 == 0) {
            amount0 = amount0Desired;
            amount1 = amount1Desired;
            shares = Math.sqrt(amount0 * amount1);
        } else {
            uint256 amount1Optimal = (amount0Desired * _reserve1) / _reserve0;
            if (amount1Optimal <= amount1Desired) {
                amount0 = amount0Desired;
                amount1 = amount1Optimal;
            } else {
                uint256 amount0Optimal = (amount1Desired * _reserve0) / _reserve1;
                amount0 = amount0Optimal;
                amount1 = amount1Desired;
            }
            shares = Math.min((amount0 * totalSupply()) / _reserve0, (amount1 * totalSupply()) / _reserve1);
        }

        require(shares >= minShares && shares > 0, "Insufficient shares");

        token0.safeTransferFrom(msg.sender, address(this), amount0);
        token1.safeTransferFrom(msg.sender, address(this), amount1);

        _mint(to, shares);
        _updateReserves();

        emit LiquidityAdded(to, amount0, amount1, shares);
    }

    function removeLiquidity(
        uint256 shares,
        uint256 minAmount0,
        uint256 minAmount1,
        address to
    ) external whenNotPaused nonReentrant returns (uint256 amount0, uint256 amount1) {
        require(shares > 0, "Zero shares");
        require(to != address(0), "Invalid receiver");

        uint256 supply = totalSupply();
        require(supply > 0, "No liquidity");

        amount0 = (reserve0 * shares) / supply;
        amount1 = (reserve1 * shares) / supply;

        require(amount0 >= minAmount0 && amount1 >= minAmount1, "Slippage");

        _burn(msg.sender, shares);

        token0.safeTransfer(to, amount0);
        token1.safeTransfer(to, amount1);

        _updateReserves();

        emit LiquidityRemoved(msg.sender, amount0, amount1, shares);
    }

    function swap(
        address tokenIn,
        uint256 amountIn,
        uint256 minAmountOut,
        address to
    ) external whenNotPaused nonReentrant returns (uint256 amountOut) {
        require(amountIn > 0, "Zero amount");
        require(to != address(0), "Invalid receiver");

        IERC20 inToken;
        IERC20 outToken;
        uint256 reserveIn;
        uint256 reserveOut;

        if (tokenIn == address(token0)) {
            inToken = token0;
            outToken = token1;
            reserveIn = reserve0;
            reserveOut = reserve1;
        } else if (tokenIn == address(token1)) {
            inToken = token1;
            outToken = token0;
            reserveIn = reserve1;
            reserveOut = reserve0;
        } else {
            revert("Unsupported token");
        }

        require(reserveIn > 0 && reserveOut > 0, "Insufficient reserves");

        inToken.safeTransferFrom(msg.sender, address(this), amountIn);

        uint256 feeTotal = (amountIn * TOTAL_FEE_BPS) / FEE_DENOMINATOR;
        uint256 treasuryFee = (amountIn * TREASURY_FEE_BPS) / FEE_DENOMINATOR;
        uint256 amountInAfterFee = amountIn - feeTotal;

        amountOut = _getAmountOut(amountInAfterFee, reserveIn, reserveOut);
        require(amountOut >= minAmountOut, "Insufficient output");

        if (treasuryFee > 0 && treasury != address(0)) {
            inToken.safeTransfer(treasury, treasuryFee);
        }

        outToken.safeTransfer(to, amountOut);

        _updateReserves();

        emit Swap(msg.sender, address(inToken), address(outToken), amountIn, amountOut, treasuryFee);
    }

    function _updateReserves() private {
        reserve0 = token0.balanceOf(address(this));
        reserve1 = token1.balanceOf(address(this));
    }

    function _getAmountOut(uint256 amountIn, uint256 reserveIn, uint256 reserveOut) private pure returns (uint256) {
        require(amountIn > 0, "Amount zero");
        require(reserveIn > 0 && reserveOut > 0, "Reserves zero");
        return (amountIn * reserveOut) / (reserveIn + amountIn);
    }
}
