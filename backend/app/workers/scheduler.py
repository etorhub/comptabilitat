"""Planificador de feines del contenidor `worker`.

Reparteix la feina segons el que costa: de matinada el model local, que es
lent en un NAS sense targeta grafica; al mati la sincronitzacio amb el banc i
l'analisi, que son rapides.
"""

from __future__ import annotations

import logging
import signal
import sys
from typing import Any

from apscheduler.schedulers.blocking import BlockingScheduler
from apscheduler.triggers.cron import CronTrigger

from app.config import settings
from app.core.time import LOCAL_TZ
from app.workers.jobs.analyze import run_analysis_job
from app.workers.jobs.classify import run_classification_job
from app.workers.jobs.llm import run_llm_classification
from app.workers.jobs.notify import run_notification_job
from app.workers.jobs.sync import run_sync_job

logging.basicConfig(
    level=logging.DEBUG if settings.debug else logging.INFO,
    format="%(asctime)s %(levelname)-8s %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)


def _run(name: str, function: Any) -> None:
    """Executa una feina deixant traca i sense tombar el planificador."""
    logger.info("Comenca la feina «%s»", name)
    try:
        result = function()
    except Exception:  # noqa: BLE001
        logger.exception("La feina «%s» ha fallat", name)
        return
    logger.info("Feina «%s» acabada: %s", name, result)


def daily_pipeline() -> str:
    """Sincronitza amb el banc i actualitza classificacio, recurrents i previsions."""
    sync = run_sync_job()
    # Sense model local: aixo ha de ser rapid i executar-se de dia.
    classification = run_classification_job(use_llm=False)
    analysis = run_analysis_job()
    return " | ".join([sync, classification, analysis])


def nightly_llm() -> str:
    """Passa el model local pels comercos nous i reaplica la classificacio."""
    llm = run_llm_classification()
    classification = run_classification_job(use_llm=False)
    return f"{llm} | {classification}"


def build_scheduler() -> BlockingScheduler:
    scheduler = BlockingScheduler(timezone=LOCAL_TZ)

    scheduler.add_job(
        lambda: _run("sincronitzacio diaria", daily_pipeline),
        CronTrigger(hour=settings.sync_cron_hour, minute=settings.sync_cron_minute),
        id="daily-pipeline",
        max_instances=1,
        coalesce=True,
    )
    if settings.ollama_enabled:
        scheduler.add_job(
            lambda: _run("classificacio amb model local", nightly_llm),
            CronTrigger(hour=settings.classify_cron_hour, minute=15),
            id="nightly-llm",
            max_instances=1,
            coalesce=True,
        )
    scheduler.add_job(
        lambda: _run("analisi", run_analysis_job),
        CronTrigger(hour=settings.analysis_cron_hour, minute=45),
        id="analysis",
        max_instances=1,
        coalesce=True,
    )
    scheduler.add_job(
        lambda: _run("resum d'avisos", run_notification_job),
        CronTrigger(hour=settings.notify_cron_hour, minute=0),
        id="notify-digest",
        max_instances=1,
        coalesce=True,
    )
    scheduler.add_job(
        lambda: _run("avisos urgents", lambda: run_notification_job(only_critical=True)),
        CronTrigger(minute=5),
        id="notify-critical",
        max_instances=1,
        coalesce=True,
    )
    return scheduler


def main() -> int:
    if not settings.scheduler_enabled:
        logger.warning("El planificador esta desactivat (SCHEDULER_ENABLED=false)")
        return 0

    scheduler = build_scheduler()

    def stop(signum: int, frame: Any) -> None:
        logger.info("Aturant el planificador…")
        scheduler.shutdown(wait=False)

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)

    for job in scheduler.get_jobs():
        logger.info("Feina programada: %s → %s", job.id, job.trigger)
    scheduler.start()
    return 0


if __name__ == "__main__":
    sys.exit(main())
