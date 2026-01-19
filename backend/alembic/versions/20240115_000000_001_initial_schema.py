"""Initial database schema for Horalix View

Revision ID: 001
Revises:
Create Date: 2024-01-15 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Create patients table
    op.create_table(
        "patients",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("patient_id", sa.String(64), nullable=False),
        sa.Column("patient_name", sa.String(256), nullable=True),
        sa.Column("birth_date", sa.Date(), nullable=True),
        sa.Column("sex", sa.String(16), nullable=True),
        sa.Column("ethnic_group", sa.String(64), nullable=True),
        sa.Column("comments", sa.String(10240), nullable=True),
        sa.Column("issuer_of_patient_id", sa.String(64), nullable=True),
        sa.Column("other_patient_ids", sa.String(512), nullable=True),
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
        sa.PrimaryKeyConstraint("id", name=op.f("pk_patients")),
        sa.UniqueConstraint("patient_id", name=op.f("uq_patients_patient_id")),
    )
    op.create_index(op.f("ix_patients_patient_id"), "patients", ["patient_id"], unique=False)
    op.create_index("ix_patients_name_lower", "patients", ["patient_name"], unique=False)
    op.create_index("ix_patients_birth_date", "patients", ["birth_date"], unique=False)

    # Create studies table
    op.create_table(
        "studies",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("study_instance_uid", sa.String(128), nullable=False),
        sa.Column("study_id", sa.String(64), nullable=True),
        sa.Column("study_date", sa.Date(), nullable=True),
        sa.Column("study_time", sa.Time(), nullable=True),
        sa.Column("accession_number", sa.String(64), nullable=True),
        sa.Column("study_description", sa.String(512), nullable=True),
        sa.Column("referring_physician_name", sa.String(256), nullable=True),
        sa.Column("institution_name", sa.String(256), nullable=True),
        sa.Column("station_name", sa.String(64), nullable=True),
        sa.Column("modalities_in_study", sa.String(256), nullable=True),
        sa.Column("num_series", sa.Integer(), nullable=True, default=0),
        sa.Column("num_instances", sa.Integer(), nullable=True, default=0),
        sa.Column(
            "status",
            sa.Enum("PENDING", "PROCESSING", "COMPLETE", "ERROR", name="studystatus"),
            nullable=False,
        ),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("patient_id_fk", sa.Integer(), nullable=True),
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
        sa.ForeignKeyConstraint(
            ["patient_id_fk"],
            ["patients.id"],
            name=op.f("fk_studies_patient_id_fk_patients"),
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_studies")),
        sa.UniqueConstraint(
            "study_instance_uid", name=op.f("uq_studies_study_instance_uid")
        ),
    )
    op.create_index(
        op.f("ix_studies_study_instance_uid"), "studies", ["study_instance_uid"], unique=False
    )
    op.create_index(op.f("ix_studies_study_date"), "studies", ["study_date"], unique=False)
    op.create_index(
        op.f("ix_studies_accession_number"), "studies", ["accession_number"], unique=False
    )
    op.create_index("ix_studies_study_date_desc", "studies", [sa.text("study_date DESC")])
    op.create_index("ix_studies_patient_id_fk", "studies", ["patient_id_fk"], unique=False)
    op.create_index("ix_studies_status", "studies", ["status"], unique=False)

    # Create series table
    op.create_table(
        "series",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("series_instance_uid", sa.String(128), nullable=False),
        sa.Column("series_number", sa.Integer(), nullable=True),
        sa.Column("series_description", sa.String(512), nullable=True),
        sa.Column("modality", sa.String(16), nullable=False),
        sa.Column("series_date", sa.Date(), nullable=True),
        sa.Column("series_time", sa.Time(), nullable=True),
        sa.Column("body_part_examined", sa.String(64), nullable=True),
        sa.Column("patient_position", sa.String(64), nullable=True),
        sa.Column("protocol_name", sa.String(256), nullable=True),
        sa.Column("slice_thickness", sa.Float(), nullable=True),
        sa.Column("spacing_between_slices", sa.Float(), nullable=True),
        sa.Column("pixel_spacing", sa.String(64), nullable=True),
        sa.Column("rows", sa.Integer(), nullable=True),
        sa.Column("columns", sa.Integer(), nullable=True),
        sa.Column("window_center", sa.Float(), nullable=True),
        sa.Column("window_width", sa.Float(), nullable=True),
        sa.Column("num_instances", sa.Integer(), nullable=True, default=0),
        sa.Column("study_instance_uid_fk", sa.String(128), nullable=False),
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
        sa.ForeignKeyConstraint(
            ["study_instance_uid_fk"],
            ["studies.study_instance_uid"],
            name=op.f("fk_series_study_instance_uid_fk_studies"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_series")),
        sa.UniqueConstraint(
            "series_instance_uid", name=op.f("uq_series_series_instance_uid")
        ),
    )
    op.create_index(
        op.f("ix_series_series_instance_uid"), "series", ["series_instance_uid"], unique=False
    )
    op.create_index("ix_series_study_uid", "series", ["study_instance_uid_fk"], unique=False)
    op.create_index("ix_series_modality", "series", ["modality"], unique=False)
    op.create_index("ix_series_number", "series", ["series_number"], unique=False)

    # Create instances table
    op.create_table(
        "instances",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("sop_instance_uid", sa.String(128), nullable=False),
        sa.Column("sop_class_uid", sa.String(128), nullable=False),
        sa.Column("instance_number", sa.Integer(), nullable=True),
        sa.Column("rows", sa.Integer(), nullable=True),
        sa.Column("columns", sa.Integer(), nullable=True),
        sa.Column("bits_allocated", sa.Integer(), nullable=True),
        sa.Column("bits_stored", sa.Integer(), nullable=True),
        sa.Column("high_bit", sa.Integer(), nullable=True),
        sa.Column("pixel_representation", sa.Integer(), nullable=True),
        sa.Column("samples_per_pixel", sa.Integer(), nullable=True),
        sa.Column("photometric_interpretation", sa.String(32), nullable=True),
        sa.Column("transfer_syntax_uid", sa.String(128), nullable=True),
        sa.Column("window_center", sa.Float(), nullable=True),
        sa.Column("window_width", sa.Float(), nullable=True),
        sa.Column("rescale_intercept", sa.Float(), nullable=True),
        sa.Column("rescale_slope", sa.Float(), nullable=True),
        sa.Column("slice_location", sa.Float(), nullable=True),
        sa.Column("slice_thickness", sa.Float(), nullable=True),
        sa.Column("image_position_patient", sa.String(128), nullable=True),
        sa.Column("image_orientation_patient", sa.String(256), nullable=True),
        sa.Column("pixel_spacing", sa.String(64), nullable=True),
        sa.Column("number_of_frames", sa.Integer(), nullable=True, default=1),
        sa.Column("file_path", sa.String(1024), nullable=True),
        sa.Column("file_size", sa.BigInteger(), nullable=True),
        sa.Column("file_checksum", sa.String(64), nullable=True),
        sa.Column("series_instance_uid_fk", sa.String(128), nullable=False),
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
        sa.ForeignKeyConstraint(
            ["series_instance_uid_fk"],
            ["series.series_instance_uid"],
            name=op.f("fk_instances_series_instance_uid_fk_series"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_instances")),
        sa.UniqueConstraint(
            "sop_instance_uid", name=op.f("uq_instances_sop_instance_uid")
        ),
    )
    op.create_index(
        op.f("ix_instances_sop_instance_uid"), "instances", ["sop_instance_uid"], unique=False
    )
    op.create_index(
        "ix_instances_series_uid", "instances", ["series_instance_uid_fk"], unique=False
    )
    op.create_index("ix_instances_number", "instances", ["instance_number"], unique=False)
    op.create_index(
        "ix_instances_slice_location", "instances", ["slice_location"], unique=False
    )

    # Create users table
    op.create_table(
        "users",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.String(64), nullable=False),
        sa.Column("username", sa.String(64), nullable=False),
        sa.Column("email", sa.String(256), nullable=False),
        sa.Column("hashed_password", sa.String(256), nullable=False),
        sa.Column("full_name", sa.String(256), nullable=True),
        sa.Column("title", sa.String(64), nullable=True),
        sa.Column("department", sa.String(128), nullable=True),
        sa.Column("phone", sa.String(32), nullable=True),
        sa.Column("roles", sa.String(256), nullable=False, default="referring_physician"),
        sa.Column("is_active", sa.Boolean(), nullable=False, default=True),
        sa.Column("is_verified", sa.Boolean(), nullable=False, default=False),
        sa.Column("is_locked", sa.Boolean(), nullable=False, default=False),
        sa.Column("last_login", sa.DateTime(timezone=True), nullable=True),
        sa.Column("failed_login_attempts", sa.Integer(), nullable=True, default=0),
        sa.Column("locked_until", sa.DateTime(timezone=True), nullable=True),
        sa.Column("password_changed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("must_change_password", sa.Boolean(), nullable=True, default=False),
        sa.Column("api_key_hash", sa.String(512), nullable=True),
        sa.Column("mfa_enabled", sa.Boolean(), nullable=True, default=False),
        sa.Column("mfa_secret", sa.String(256), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
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
        sa.PrimaryKeyConstraint("id", name=op.f("pk_users")),
        sa.UniqueConstraint("user_id", name=op.f("uq_users_user_id")),
        sa.UniqueConstraint("username", name=op.f("uq_users_username")),
        sa.UniqueConstraint("email", name=op.f("uq_users_email")),
    )
    op.create_index(op.f("ix_users_user_id"), "users", ["user_id"], unique=False)
    op.create_index(op.f("ix_users_username"), "users", ["username"], unique=False)
    op.create_index(op.f("ix_users_email"), "users", ["email"], unique=False)
    op.create_index("ix_users_is_active", "users", ["is_active"], unique=False)
    op.create_index("ix_users_roles", "users", ["roles"], unique=False)

    # Create ai_jobs table
    op.create_table(
        "ai_jobs",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("job_id", sa.String(64), nullable=False),
        sa.Column(
            "model_type",
            sa.Enum(
                "NNUNET", "MEDUNET", "MEDSAM", "SWINUNET", "TRANSUNET",
                "YOLOV8", "FASTER_RCNN",
                "VIT", "MEDVIT", "SWIN_TRANSFORMER", "ECHOCLR",
                "UNIMIE", "GAN_DENOISING", "GAN_SUPER_RES",
                "GIGAPATH", "HIPT", "CTRANSPATH", "CHIEF",
                "CARDIAC_3D", "CARDIAC_EF", "CARDIAC_STRAIN",
                name="modeltype"
            ),
            nullable=False,
        ),
        sa.Column(
            "task_type",
            sa.Enum(
                "SEGMENTATION", "DETECTION", "CLASSIFICATION",
                "ENHANCEMENT", "PATHOLOGY", "CARDIAC",
                name="tasktype"
            ),
            nullable=False,
        ),
        sa.Column(
            "status",
            sa.Enum(
                "PENDING", "QUEUED", "RUNNING", "COMPLETED", "FAILED", "CANCELLED",
                name="jobstatus"
            ),
            nullable=False,
        ),
        sa.Column("progress", sa.Float(), nullable=True, default=0.0),
        sa.Column("priority", sa.Integer(), nullable=True, default=5),
        sa.Column("queued_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("study_instance_uid", sa.String(128), nullable=False),
        sa.Column("series_instance_uid", sa.String(128), nullable=True),
        sa.Column("submitted_by", sa.String(64), nullable=True),
        sa.Column("parameters", sa.JSON(), nullable=True),
        sa.Column("results", sa.JSON(), nullable=True),
        sa.Column("result_files", sa.JSON(), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("error_traceback", sa.Text(), nullable=True),
        sa.Column("inference_time_ms", sa.Integer(), nullable=True),
        sa.Column("gpu_memory_mb", sa.Integer(), nullable=True),
        sa.Column("quality_metrics", sa.JSON(), nullable=True),
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
        sa.ForeignKeyConstraint(
            ["study_instance_uid"],
            ["studies.study_instance_uid"],
            name=op.f("fk_ai_jobs_study_instance_uid_studies"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_ai_jobs")),
        sa.UniqueConstraint("job_id", name=op.f("uq_ai_jobs_job_id")),
    )
    op.create_index(op.f("ix_ai_jobs_job_id"), "ai_jobs", ["job_id"], unique=False)
    op.create_index(
        "ix_ai_jobs_status_priority", "ai_jobs", ["status", "priority"], unique=False
    )
    op.create_index(
        "ix_ai_jobs_study_uid", "ai_jobs", ["study_instance_uid"], unique=False
    )
    op.create_index("ix_ai_jobs_model_type", "ai_jobs", ["model_type"], unique=False)
    op.create_index("ix_ai_jobs_submitted_by", "ai_jobs", ["submitted_by"], unique=False)
    op.create_index("ix_ai_jobs_created_at", "ai_jobs", ["created_at"], unique=False)

    # Create audit_logs table
    op.create_table(
        "audit_logs",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column(
            "action",
            sa.Enum(
                "LOGIN", "LOGOUT", "LOGIN_FAILED", "PASSWORD_CHANGE",
                "MFA_ENABLED", "MFA_DISABLED",
                "STUDY_VIEW", "STUDY_CREATE", "STUDY_UPDATE", "STUDY_DELETE",
                "STUDY_EXPORT", "STUDY_ANONYMIZE",
                "SERIES_VIEW", "INSTANCE_VIEW", "PIXEL_DATA_ACCESS",
                "PATIENT_VIEW", "PATIENT_CREATE", "PATIENT_UPDATE",
                "PATIENT_DELETE", "PATIENT_MERGE",
                "AI_JOB_SUBMIT", "AI_JOB_CANCEL", "AI_RESULT_VIEW",
                "AI_RESULT_APPROVE", "AI_RESULT_REJECT",
                "USER_CREATE", "USER_UPDATE", "USER_DELETE",
                "USER_LOCK", "USER_UNLOCK", "ROLE_CHANGE",
                "PERMISSION_CHANGE", "SETTINGS_CHANGE",
                "SYSTEM_STARTUP", "SYSTEM_SHUTDOWN",
                "BACKUP_CREATE", "BACKUP_RESTORE",
                name="auditaction"
            ),
            nullable=False,
        ),
        sa.Column("action_description", sa.String(512), nullable=True),
        sa.Column("user_id", sa.String(64), nullable=True),
        sa.Column("username", sa.String(64), nullable=True),
        sa.Column("user_roles", sa.String(256), nullable=True),
        sa.Column("resource_type", sa.String(64), nullable=True),
        sa.Column("resource_id", sa.String(256), nullable=True),
        sa.Column("details", sa.JSON(), nullable=True),
        sa.Column("old_value", sa.JSON(), nullable=True),
        sa.Column("new_value", sa.JSON(), nullable=True),
        sa.Column("ip_address", sa.String(45), nullable=True),
        sa.Column("user_agent", sa.String(512), nullable=True),
        sa.Column("request_id", sa.String(64), nullable=True),
        sa.Column("request_method", sa.String(16), nullable=True),
        sa.Column("request_path", sa.String(512), nullable=True),
        sa.Column("success", sa.Boolean(), nullable=False, default=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column(
            "timestamp",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_audit_logs")),
    )
    op.create_index(op.f("ix_audit_logs_action"), "audit_logs", ["action"], unique=False)
    op.create_index(op.f("ix_audit_logs_user_id"), "audit_logs", ["user_id"], unique=False)
    op.create_index(
        op.f("ix_audit_logs_resource_type"), "audit_logs", ["resource_type"], unique=False
    )
    op.create_index(
        op.f("ix_audit_logs_resource_id"), "audit_logs", ["resource_id"], unique=False
    )
    op.create_index(
        op.f("ix_audit_logs_timestamp"), "audit_logs", ["timestamp"], unique=False
    )
    op.create_index(
        "ix_audit_logs_user_timestamp", "audit_logs", ["user_id", "timestamp"], unique=False
    )
    op.create_index(
        "ix_audit_logs_resource_timestamp",
        "audit_logs",
        ["resource_type", "resource_id", "timestamp"],
        unique=False,
    )
    op.create_index(
        "ix_audit_logs_action_timestamp", "audit_logs", ["action", "timestamp"], unique=False
    )
    op.create_index(
        "ix_audit_logs_timestamp_desc", "audit_logs", [sa.text("timestamp DESC")]
    )


def downgrade() -> None:
    # Drop tables in reverse order
    op.drop_table("audit_logs")
    op.drop_table("ai_jobs")
    op.drop_table("users")
    op.drop_table("instances")
    op.drop_table("series")
    op.drop_table("studies")
    op.drop_table("patients")

    # Drop enums
    op.execute("DROP TYPE IF EXISTS auditaction")
    op.execute("DROP TYPE IF EXISTS jobstatus")
    op.execute("DROP TYPE IF EXISTS tasktype")
    op.execute("DROP TYPE IF EXISTS modeltype")
    op.execute("DROP TYPE IF EXISTS studystatus")
