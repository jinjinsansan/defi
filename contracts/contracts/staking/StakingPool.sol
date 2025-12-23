// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract StakingPool is AccessControl, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant MANAGER_ROLE = keccak256("MANAGER_ROLE");

    IERC20 public immutable stakingToken;
    IERC20 public immutable rewardToken;

    uint256 public rewardRate; // reward tokens distributed per second
    uint256 public lastUpdate;
    uint256 public accRewardPerShare; // scaled by 1e18

    struct UserInfo {
        uint256 amount;
        uint256 rewardDebt;
    }

    mapping(address => UserInfo) public userInfo;

    uint256 private constant ACC_PRECISION = 1e18;

    event Deposited(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);
    event RewardClaimed(address indexed user, uint256 amount);
    event RewardRateUpdated(uint256 newRate);

    constructor(
        IERC20 _stakingToken,
        IERC20 _rewardToken,
        uint256 _rewardRate,
        address admin
    ) {
        require(address(_stakingToken) != address(0), "Token zero");
        require(address(_rewardToken) != address(0), "Token zero");
        require(admin != address(0), "Admin zero");

        stakingToken = _stakingToken;
        rewardToken = _rewardToken;
        rewardRate = _rewardRate;
        lastUpdate = block.timestamp;

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(MANAGER_ROLE, admin);
    }

    function updatePool() public {
        if (block.timestamp <= lastUpdate) {
            return;
        }
        uint256 totalStaked = stakingToken.balanceOf(address(this));
        if (totalStaked == 0) {
            lastUpdate = block.timestamp;
            return;
        }
        uint256 secondsElapsed = block.timestamp - lastUpdate;
        uint256 reward = secondsElapsed * rewardRate;
        accRewardPerShare += (reward * ACC_PRECISION) / totalStaked;
        lastUpdate = block.timestamp;
    }

    function pendingReward(address user) external view returns (uint256) {
        UserInfo memory info = userInfo[user];
        uint256 _accRewardPerShare = accRewardPerShare;
        uint256 totalStaked = stakingToken.balanceOf(address(this));
        if (block.timestamp > lastUpdate && totalStaked != 0) {
            uint256 secondsElapsed = block.timestamp - lastUpdate;
            uint256 reward = secondsElapsed * rewardRate;
            _accRewardPerShare += (reward * ACC_PRECISION) / totalStaked;
        }
        return ((info.amount * _accRewardPerShare) / ACC_PRECISION) - info.rewardDebt;
    }

    function setRewardRate(uint256 newRate) external onlyRole(MANAGER_ROLE) {
        updatePool();
        rewardRate = newRate;
        emit RewardRateUpdated(newRate);
    }

    function pause() external onlyRole(MANAGER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(MANAGER_ROLE) {
        _unpause();
    }

    function deposit(uint256 amount) external whenNotPaused nonReentrant {
        require(amount > 0, "Amount zero");
        updatePool();
        UserInfo storage info = userInfo[msg.sender];
        if (info.amount > 0) {
            uint256 pending = ((info.amount * accRewardPerShare) / ACC_PRECISION) - info.rewardDebt;
            if (pending > 0) {
                rewardToken.safeTransfer(msg.sender, pending);
                emit RewardClaimed(msg.sender, pending);
            }
        }
        stakingToken.safeTransferFrom(msg.sender, address(this), amount);
        info.amount += amount;
        info.rewardDebt = (info.amount * accRewardPerShare) / ACC_PRECISION;
        emit Deposited(msg.sender, amount);
    }

    function withdraw(uint256 amount) external nonReentrant {
        UserInfo storage info = userInfo[msg.sender];
        require(amount > 0 && info.amount >= amount, "Invalid withdraw");
        updatePool();
        uint256 pending = ((info.amount * accRewardPerShare) / ACC_PRECISION) - info.rewardDebt;
        if (pending > 0) {
            rewardToken.safeTransfer(msg.sender, pending);
            emit RewardClaimed(msg.sender, pending);
        }
        info.amount -= amount;
        info.rewardDebt = (info.amount * accRewardPerShare) / ACC_PRECISION;
        stakingToken.safeTransfer(msg.sender, amount);
        emit Withdrawn(msg.sender, amount);
    }

    function emergencyWithdraw() external nonReentrant {
        UserInfo storage info = userInfo[msg.sender];
        uint256 amount = info.amount;
        require(amount > 0, "Nothing to withdraw");
        info.amount = 0;
        info.rewardDebt = 0;
        stakingToken.safeTransfer(msg.sender, amount);
        emit Withdrawn(msg.sender, amount);
    }
}
