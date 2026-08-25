"""Neteja dels conceptes tal com arriben del Santander."""

from __future__ import annotations

import pytest

from app.services.normalization import display_name, normalize_description

# (concepte del banc, clau normalitzada esperada)
CASOS = [
    ("COMPRA TARJ. 5402XXXXXXXX1234 EN MERCADONA, BARCELONA", "MERCADONA"),
    ("COMPRA TARJ. 1234******5678 EN AMAZON EU SARL, MADRID", "AMAZON EU SARL"),
    ("PAGO MOVIL EN CARREFOUR EXPRESS 25/08", "CARREFOUR EXPRESS"),
    ("RECIBO NETFLIX INTERNATIONAL B.V.", "NETFLIX INTERNATIONAL B.V"),
    ("PAGO RECIBO IBERDROLA CLIENTES SAU", "IBERDROLA CLIENTES SAU"),
    (
        "ADEUDO POR DOMICILIACION DE ENDESA ENERGIA XXI SLU REF 001234567890",
        "ENDESA ENERGIA XXI SLU",
    ),
    ("BIZUM DE MARIA 12/08", "MARIA"),
    ("TRANSFERENCIA DE JOAN PUIG CONCEPTO: LLOGUER AGOST", "JOAN PUIG"),
    ("NOMINA MES AGOSTO EMPRESA XYZ SL", "EMPRESA XYZ SL"),
]


@pytest.mark.parametrize(("concepte", "esperat"), CASOS)
def test_els_conceptes_del_banc_es_redueixen_al_comerc(concepte: str, esperat: str):
    normalitzat, _ = normalize_description(concepte, "")
    assert normalitzat == esperat


def test_la_contrapart_del_banc_mana_sobre_el_concepte():
    """Quan el banc dona el nom de la contrapart, es mes fiable que el text lliure."""
    normalitzat, _ = normalize_description("qualsevol cosa rara", "Spotify AB")
    assert normalitzat == "SPOTIFY AB"


@pytest.mark.parametrize(
    "concepte",
    [
        "REINTEGRO CAJERO 4B 12/08 OFICINA",
        "DISPOSICION DE EFECTIVO OFICINA 1234",
    ],
)
def test_les_operacions_sense_comerc_tenen_un_nom_fix(concepte: str):
    normalitzat, _ = normalize_description(concepte, "")
    assert normalitzat == "REINTEGRO EFECTIU"


def test_les_comissions_i_els_traspassos_tambe():
    assert normalize_description("COMISION MANTENIMIENTO CUENTA", "")[0] == "COMISSIO BANCARIA"
    assert (
        normalize_description("TRASPASO A CUENTA 12345678901234567890", "")[0]
        == "TRASPAS ENTRE COMPTES"
    )


def test_dos_moviments_del_mateix_comerc_donen_la_mateixa_clau():
    """És el que permet que un comerç només es classifiqui una vegada."""
    primer, _ = normalize_description("COMPRA TARJ. 5402XXXXXXXX1234 EN MERCADONA, BARCELONA", "")
    segon, _ = normalize_description("COMPRA TARJ. 5402XXXXXXXX9999 EN MERCADONA, GIRONA", "")
    assert primer == segon


@pytest.mark.parametrize(
    ("clau", "esperat"),
    [
        ("MERCADONA", "Mercadona"),
        ("COMUNITAT DE PROPIETARIS", "Comunitat de Propietaris"),
        ("BAR EL RACO", "Bar el Raco"),
        ("AMAZON EU SARL", "Amazon EU SARL"),
        ("EMPRESA XYZ SL", "Empresa XYZ SL"),
    ],
)
def test_el_nom_per_mostrar_es_llegible(clau: str, esperat: str):
    assert display_name(clau) == esperat


def test_un_concepte_buit_no_peta():
    assert normalize_description("", "") == ("", "")
