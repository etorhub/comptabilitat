"""Enumeracions del domini."""

from __future__ import annotations

import enum


class LedgerRole(enum.StrEnum):
    """Perms d'un usuari sobre un llibre, de menys a mes."""

    VIEWER = "viewer"
    EDITOR = "editor"
    ADMIN = "admin"

    @property
    def level(self) -> int:
        return {"viewer": 1, "editor": 2, "admin": 3}[self.value]


class ConnectionStatus(enum.StrEnum):
    PENDING = "pending"  # autoritzacio iniciada, encara sense sessio
    ACTIVE = "active"
    EXPIRED = "expired"
    REVOKED = "revoked"
    ERROR = "error"


class TransactionStatus(enum.StrEnum):
    BOOKED = "booked"
    PENDING = "pending"


class CategoryKind(enum.StrEnum):
    INCOME = "income"
    EXPENSE = "expense"
    TRANSFER = "transfer"


class CategorySource(enum.StrEnum):
    NONE = "none"
    MERCHANT = "merchant"
    RULE = "rule"
    LLM = "llm"
    USER = "user"


class TransactionSource(enum.StrEnum):
    ENABLEBANKING = "enablebanking"
    MANUAL = "manual"


class RuleSource(enum.StrEnum):
    USER = "user"
    LEARNED = "learned"


class RuleField(enum.StrEnum):
    DESCRIPTION = "description"
    NORMALIZED = "normalized_description"
    COUNTERPARTY = "counterparty"
    AMOUNT = "amount"
    BANK_CODE = "bank_transaction_code"
    ACCOUNT = "account_id"


class RuleOperator(enum.StrEnum):
    CONTAINS = "contains"
    EQUALS = "equals"
    STARTS_WITH = "starts_with"
    REGEX = "regex"
    GREATER_THAN = "gt"
    LESS_THAN = "lt"


class Cadence(enum.StrEnum):
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


class SeriesStatus(enum.StrEnum):
    ACTIVE = "active"
    ENDED = "ended"


class AlertType(enum.StrEnum):
    PROJECTED_OVERDRAFT = "projected_overdraft"
    CONSENT_EXPIRING = "consent_expiring"
    CONSENT_EXPIRED = "consent_expired"
    RECURRING_AMOUNT_CHANGE = "recurring_amount_change"
    RECURRING_MISSING = "recurring_missing"
    SYNC_FAILED = "sync_failed"


class AlertSeverity(enum.StrEnum):
    INFO = "info"
    WARNING = "warning"
    CRITICAL = "critical"


class AlertStatus(enum.StrEnum):
    NEW = "new"
    READ = "read"
    DISMISSED = "dismissed"


class SyncStatus(enum.StrEnum):
    RUNNING = "running"
    SUCCESS = "success"
    PARTIAL = "partial"
    FAILED = "failed"


class SyncTrigger(enum.StrEnum):
    SCHEDULED = "scheduled"
    MANUAL = "manual"
    INITIAL = "initial"
