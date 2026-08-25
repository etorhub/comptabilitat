"""Enumeracions del domini."""

from __future__ import annotations

import enum


class LedgerRole(str, enum.Enum):
    """Perms d'un usuari sobre un llibre, de menys a mes."""

    VIEWER = "viewer"
    EDITOR = "editor"
    ADMIN = "admin"

    @property
    def level(self) -> int:
        return {"viewer": 1, "editor": 2, "admin": 3}[self.value]


class ConnectionStatus(str, enum.Enum):
    PENDING = "pending"  # autoritzacio iniciada, encara sense sessio
    ACTIVE = "active"
    EXPIRED = "expired"
    REVOKED = "revoked"
    ERROR = "error"


class TransactionStatus(str, enum.Enum):
    BOOKED = "booked"
    PENDING = "pending"


class CategoryKind(str, enum.Enum):
    INCOME = "income"
    EXPENSE = "expense"
    TRANSFER = "transfer"


class CategorySource(str, enum.Enum):
    NONE = "none"
    MERCHANT = "merchant"
    RULE = "rule"
    LLM = "llm"
    USER = "user"


class TransactionSource(str, enum.Enum):
    ENABLEBANKING = "enablebanking"
    MANUAL = "manual"


class RuleSource(str, enum.Enum):
    USER = "user"
    LEARNED = "learned"


class RuleField(str, enum.Enum):
    DESCRIPTION = "description"
    NORMALIZED = "normalized_description"
    COUNTERPARTY = "counterparty"
    AMOUNT = "amount"
    BANK_CODE = "bank_transaction_code"
    ACCOUNT = "account_id"


class RuleOperator(str, enum.Enum):
    CONTAINS = "contains"
    EQUALS = "equals"
    STARTS_WITH = "starts_with"
    REGEX = "regex"
    GREATER_THAN = "gt"
    LESS_THAN = "lt"


class Cadence(str, enum.Enum):
    WEEKLY = "weekly"
    BIWEEKLY = "biweekly"
    MONTHLY = "monthly"
    BIMONTHLY = "bimonthly"
    QUARTERLY = "quarterly"
    SEMIANNUAL = "semiannual"
    ANNUAL = "annual"

    @property
    def days(self) -> int:
        return {
            "weekly": 7,
            "biweekly": 14,
            "monthly": 30,
            "bimonthly": 61,
            "quarterly": 91,
            "semiannual": 182,
            "annual": 365,
        }[self.value]


class SeriesStatus(str, enum.Enum):
    ACTIVE = "active"
    ENDED = "ended"


class AlertType(str, enum.Enum):
    PROJECTED_OVERDRAFT = "projected_overdraft"
    CONSENT_EXPIRING = "consent_expiring"
    CONSENT_EXPIRED = "consent_expired"
    RECURRING_AMOUNT_CHANGE = "recurring_amount_change"
    RECURRING_MISSING = "recurring_missing"
    SYNC_FAILED = "sync_failed"


class AlertSeverity(str, enum.Enum):
    INFO = "info"
    WARNING = "warning"
    CRITICAL = "critical"


class AlertStatus(str, enum.Enum):
    NEW = "new"
    READ = "read"
    DISMISSED = "dismissed"


class SyncStatus(str, enum.Enum):
    RUNNING = "running"
    SUCCESS = "success"
    PARTIAL = "partial"
    FAILED = "failed"


class SyncTrigger(str, enum.Enum):
    SCHEDULED = "scheduled"
    MANUAL = "manual"
    INITIAL = "initial"
