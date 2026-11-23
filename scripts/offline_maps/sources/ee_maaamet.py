"""Fork: satellite imagery source: Estonia (Maa- ja Ruumiamet)."""

from .source import Source

SOURCE = Source(
    id="ee_maaamet",
    name="Maa-amet",
    title="Estonia (Maa- ja Ruumiamet)",
    credit="© Maa- ja Ruumiamet",
    layer="detailed",
    fetch="tiles",
    first_zoom=12,
    last_zoom=17,
    detail_m=0.25,
    address="https://tiles.maaamet.ee/tm/tms/1.0.0/foto@GMC/{z}/{x}/{ty}.jpg",
    regions=("estonia",),
)
