"""Models de l'aplicacio. Importar-los tots aqui perque Alembic els detecti."""

from app.models.alert import Alert
from app.models.banking import Account, Balance, BankConnection, SyncRun
from app.models.base import Base
from app.models.ledger import Ledger
from app.models.recurring import RecurringOccurrence, RecurringSeries
from app.models.transaction import Category, LlmSuggestion, Merchant, Rule, Transaction
from app.models.user import LedgerPermission, User, UserSession

__all__ = [
    "Account",
    "Alert",
    "Balance",
    "BankConnection",
    "Base",
    "Category",
    "Ledger",
    "LedgerPermission",
    "LlmSuggestion",
    "Merchant",
    "RecurringOccurrence",
    "RecurringSeries",
    "Rule",
    "SyncRun",
    "Transaction",
    "User",
    "UserSession",
]
