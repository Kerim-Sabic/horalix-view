"""Add spatial calibration provenance to instances

Records how each instance's pixel spacing was resolved, so the viewer can
refuse to report millimetres on an image that is not spatially calibrated.
Ultrasound studies typically carry no PixelSpacing at all; their calibration
lives in SequenceOfUltrasoundRegions and applies only inside a region of the
image, which is stored here too.

Existing rows are backfilled conservatively: a row that already has a pixel
spacing value is marked as having come from PixelSpacing, and everything else
is marked uncalibrated. Re-ingesting a study re-resolves it properly.

Revision ID: 003
Revises: 002
Create Date: 2026-08-25 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "003"
down_revision: Union[str, None] = "002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "instances",
        sa.Column(
            "pixel_spacing_source",
            sa.String(32),
            nullable=False,
            server_default="none",
        ),
    )
    op.add_column(
        "instances",
        sa.Column("ultrasound_region", sa.String(64), nullable=True),
    )

    # Backfill: rows that already carry a spacing came from PixelSpacing under
    # the previous ingest logic.
    op.execute(
        """
        UPDATE instances
        SET pixel_spacing_source = 'pixel_spacing'
        WHERE pixel_spacing IS NOT NULL AND pixel_spacing <> ''
        """
    )


def downgrade() -> None:
    op.drop_column("instances", "ultrasound_region")
    op.drop_column("instances", "pixel_spacing_source")
