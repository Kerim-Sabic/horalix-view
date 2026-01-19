"""Add annotations table

Revision ID: 002
Revises: 001
Create Date: 2026-01-19 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "002"
down_revision: Union[str, None] = "001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Create annotations table for storing image annotations."""

    # Create annotations table
    op.create_table(
        "annotations",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("annotation_uid", sa.String(36), nullable=False),
        sa.Column("study_uid", sa.String(128), nullable=False),
        sa.Column("series_uid", sa.String(128), nullable=False),
        sa.Column("instance_uid", sa.String(128), nullable=False),
        sa.Column("frame_number", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "annotation_type",
            sa.Enum(
                "LENGTH", "ANGLE", "AREA", "VOLUME", "ELLIPSE", "RECTANGLE",
                "POLYGON", "FREEHAND", "ARROW", "TEXT", "PROBE", "COBB_ANGLE",
                "BIDIRECTIONAL",
                name="annotationtype"
            ),
            nullable=False,
        ),
        sa.Column("geometry", sa.JSON(), nullable=False),
        sa.Column("measurements", sa.JSON(), nullable=True),
        sa.Column("label", sa.String(256), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("color", sa.String(16), nullable=False, server_default="#FFFF00"),
        sa.Column("visible", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("locked", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("created_by", sa.String(256), nullable=False),
        sa.Column("user_id_fk", sa.Integer(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_annotations")),
        sa.UniqueConstraint("annotation_uid", name=op.f("uq_annotations_annotation_uid")),
        sa.ForeignKeyConstraint(
            ["user_id_fk"],
            ["users.id"],
            name=op.f("fk_annotations_user_id_fk_users"),
            ondelete="SET NULL",
        ),
    )

    # Create indexes for efficient querying
    op.create_index(
        op.f("ix_annotations_annotation_uid"),
        "annotations",
        ["annotation_uid"],
        unique=True
    )
    op.create_index(
        op.f("ix_annotations_study_uid"),
        "annotations",
        ["study_uid"],
        unique=False
    )
    op.create_index(
        op.f("ix_annotations_series_uid"),
        "annotations",
        ["series_uid"],
        unique=False
    )
    op.create_index(
        op.f("ix_annotations_instance_uid"),
        "annotations",
        ["instance_uid"],
        unique=False
    )
    op.create_index(
        op.f("ix_annotations_annotation_type"),
        "annotations",
        ["annotation_type"],
        unique=False
    )
    op.create_index(
        op.f("ix_annotations_created_by"),
        "annotations",
        ["created_by"],
        unique=False
    )
    op.create_index(
        "ix_annotations_study_series",
        "annotations",
        ["study_uid", "series_uid"],
        unique=False
    )
    op.create_index(
        "ix_annotations_created_at_desc",
        "annotations",
        [sa.text("created_at DESC")],
        unique=False
    )


def downgrade() -> None:
    """Drop annotations table and related indexes."""

    # Drop indexes
    op.drop_index("ix_annotations_created_at_desc", table_name="annotations")
    op.drop_index("ix_annotations_study_series", table_name="annotations")
    op.drop_index(op.f("ix_annotations_created_by"), table_name="annotations")
    op.drop_index(op.f("ix_annotations_annotation_type"), table_name="annotations")
    op.drop_index(op.f("ix_annotations_instance_uid"), table_name="annotations")
    op.drop_index(op.f("ix_annotations_series_uid"), table_name="annotations")
    op.drop_index(op.f("ix_annotations_study_uid"), table_name="annotations")
    op.drop_index(op.f("ix_annotations_annotation_uid"), table_name="annotations")

    # Drop table
    op.drop_table("annotations")

    # Drop enum type
    sa.Enum(name="annotationtype").drop(op.get_bind(), checkfirst=True)
