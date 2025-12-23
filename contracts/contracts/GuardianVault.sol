// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract GuardianVault is AccessControl, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 public constant GUARDIAN_ROLE = keccak256("GUARDIAN_ROLE");

    struct WithdrawalRequest {
        address asset;
        address to;
        uint256 amount;
        uint40 deadline;
        bool executed;
        bool cancelled;
        uint8 approvals;
    }

    event Deposit(address indexed sender, uint256 amount);
    event WithdrawalCreated(
        uint256 indexed id,
        address indexed creator,
        address indexed asset,
        address to,
        uint256 amount,
        uint40 deadline
    );
    event WithdrawalApproved(uint256 indexed id, address indexed guardian);
    event WithdrawalRevoked(uint256 indexed id, address indexed guardian);
    event WithdrawalExecuted(
        uint256 indexed id,
        address indexed executor,
        address indexed asset,
        address to,
        uint256 amount
    );
    event WithdrawalCancelled(uint256 indexed id, address indexed canceller);
    event ApprovalsRequirementUpdated(uint8 newRequirement);

    uint8 public approvalsRequired;
    uint256 public guardianCount;
    uint256 private _nextRequestId = 1;

    mapping(uint256 => WithdrawalRequest) private _withdrawals;
    mapping(uint256 => mapping(address => bool)) private _approvals;

    constructor(address[] memory guardians, uint8 threshold, address pauser) {
        require(guardians.length > 0, "No guardians");
        require(threshold > 0 && threshold <= guardians.length, "Invalid threshold");

        approvalsRequired = threshold;

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        if (pauser != address(0)) {
            _grantRole(PAUSER_ROLE, pauser);
        } else {
            _grantRole(PAUSER_ROLE, msg.sender);
        }

        for (uint256 i = 0; i < guardians.length; i++) {
            address guardian = guardians[i];
            require(guardian != address(0), "Guardian zero");
            for (uint256 j = 0; j < i; j++) {
                require(guardians[j] != guardian, "Guardian duplicate");
            }
            _grantRole(GUARDIAN_ROLE, guardian);
        }

        if (!hasRole(GUARDIAN_ROLE, msg.sender)) {
            _grantRole(GUARDIAN_ROLE, msg.sender);
        }
    }

    receive() external payable {
        emit Deposit(msg.sender, msg.value);
    }

    function deposit() external payable whenNotPaused {
        require(msg.value > 0, "Zero deposit");
        emit Deposit(msg.sender, msg.value);
    }

    function createWithdrawal(
        address asset,
        address to,
        uint256 amount,
        uint40 deadline
    ) external whenNotPaused onlyRole(GUARDIAN_ROLE) returns (uint256 id) {
        require(to != address(0), "Invalid recipient");
        require(amount > 0, "Invalid amount");
        if (deadline != 0) {
            require(deadline > block.timestamp, "Invalid deadline");
        }

        id = _nextRequestId++;
        _withdrawals[id] = WithdrawalRequest({
            asset: asset,
            to: to,
            amount: amount,
            deadline: deadline,
            executed: false,
            cancelled: false,
            approvals: 0
        });

        emit WithdrawalCreated(id, msg.sender, asset, to, amount, deadline);
    }

    function approveWithdrawal(uint256 id) external whenNotPaused onlyRole(GUARDIAN_ROLE) {
        WithdrawalRequest storage request = _activeRequest(id);
        address guardian = msg.sender;
        require(!_approvals[id][guardian], "Already approved");

        _approvals[id][guardian] = true;
        request.approvals += 1;

        emit WithdrawalApproved(id, guardian);
    }

    function revokeApproval(uint256 id) external whenNotPaused onlyRole(GUARDIAN_ROLE) {
        WithdrawalRequest storage request = _activeRequest(id);
        address guardian = msg.sender;
        require(_approvals[id][guardian], "Not approved");

        _approvals[id][guardian] = false;
        request.approvals -= 1;

        emit WithdrawalRevoked(id, guardian);
    }

    function executeWithdrawal(uint256 id)
        external
        nonReentrant
        whenNotPaused
        onlyRole(GUARDIAN_ROLE)
    {
        WithdrawalRequest storage request = _activeRequest(id);
        require(request.approvals >= approvalsRequired, "Insufficient approvals");

        request.executed = true;

        if (request.asset == address(0)) {
            _transferEth(request.to, request.amount);
        } else {
            IERC20(request.asset).safeTransfer(request.to, request.amount);
        }

        emit WithdrawalExecuted(id, msg.sender, request.asset, request.to, request.amount);
    }

    function cancelWithdrawal(uint256 id) external onlyRole(DEFAULT_ADMIN_ROLE) {
        WithdrawalRequest storage request = _withdrawals[id];
        require(request.amount > 0, "Unknown request");
        require(!_isInactive(request), "Inactive");
        request.cancelled = true;

        emit WithdrawalCancelled(id, msg.sender);
    }

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    function setApprovalsRequired(uint8 newRequirement) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(newRequirement > 0, "Zero requirement");
        require(newRequirement <= guardianCount, "Exceeds guardians");
        approvalsRequired = newRequirement;
        emit ApprovalsRequirementUpdated(newRequirement);
    }

    function nextRequestId() external view returns (uint256) {
        return _nextRequestId;
    }

    function getWithdrawal(uint256 id) external view returns (WithdrawalRequest memory) {
        return _withdrawals[id];
    }

    function hasApproved(uint256 id, address guardian) external view returns (bool) {
        return _approvals[id][guardian];
    }

    function _activeRequest(uint256 id) private view returns (WithdrawalRequest storage request) {
        request = _withdrawals[id];
        require(request.amount > 0, "Unknown request");
        require(!_isInactive(request), "Inactive");
        if (request.deadline != 0) {
            require(block.timestamp <= request.deadline, "Expired");
        }
    }

    function _isInactive(WithdrawalRequest storage request) private view returns (bool) {
        return request.executed || request.cancelled;
    }

    function _transferEth(address to, uint256 amount) private {
        require(address(this).balance >= amount, "Insufficient ETH");
        (bool success, ) = to.call{value: amount}("");
        require(success, "ETH transfer failed");
    }

    function _grantRole(bytes32 role, address account) internal override returns (bool) {
        bool updated = super._grantRole(role, account);
        if (role == GUARDIAN_ROLE && updated) {
            guardianCount += 1;
        }
        return updated;
    }

    function _revokeRole(bytes32 role, address account) internal override returns (bool) {
        bool updated = super._revokeRole(role, account);
        if (role == GUARDIAN_ROLE && updated) {
            guardianCount -= 1;
            if (guardianCount < approvalsRequired) {
                approvalsRequired = uint8(guardianCount);
                emit ApprovalsRequirementUpdated(uint8(guardianCount));
            }
        }
        return updated;
    }
}
