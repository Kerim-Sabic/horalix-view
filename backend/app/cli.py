"""Horalix View CLI - Command Line Interface for administrative tasks.

Usage:
    python -m app.cli <command> [options]

Commands:
    create-admin    Create an admin user
    init-db         Initialize the database with default users
    check-db        Check database connectivity
    version         Show version information

Examples:
    python -m app.cli create-admin --username admin --email admin@example.com --password secret123
    python -m app.cli init-db
    python -m app.cli check-db

"""

import argparse
import asyncio
import getpass
import sys
from typing import NoReturn

# Ensure we can import from the app package
try:
    from app.core.config import settings
    from app.core.security import SecurityManager
except ImportError:
    # When running from different directories, add the backend dir to path
    import os

    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    from app.core.config import settings
    from app.core.security import SecurityManager


def print_banner() -> None:
    """Print Horalix View CLI banner."""
    print("\n" + "=" * 50)
    print(" Horalix View CLI")
    print(" Hospital-Grade DICOM Viewer & AI Platform")
    print("=" * 50 + "\n")


def print_error(message: str) -> None:
    """Print error message to stderr."""
    print(f"ERROR: {message}", file=sys.stderr)


def print_success(message: str) -> None:
    """Print success message."""
    print(f"SUCCESS: {message}")


def print_info(message: str) -> None:
    """Print info message."""
    print(f"INFO: {message}")


async def check_database() -> bool:
    """Check database connectivity."""
    from sqlalchemy import text

    from app.models.base import async_session_maker

    try:
        print_info("Checking database connectivity...")
        async with async_session_maker() as session:
            await session.execute(text("SELECT 1"))
            print_success("Database connection successful")
            return True
    except Exception as e:
        print_error(f"Database connection failed: {e}")
        return False


async def create_admin_user(
    username: str,
    email: str,
    password: str,
    full_name: str | None = None,
) -> bool:
    """Create an admin user in the database."""
    import uuid

    from sqlalchemy import select

    from app.models.base import async_session_maker
    from app.models.user import User

    security = SecurityManager(
        secret_key=settings.secret_key,
        algorithm=settings.algorithm,
        access_token_expire_minutes=settings.access_token_expire_minutes,
    )

    try:
        async with async_session_maker() as session:
            # Check if username already exists
            query = select(User).where(User.username == username)
            result = await session.execute(query)
            if result.scalar_one_or_none():
                print_error(f"Username '{username}' already exists")
                return False

            # Check if email already exists
            query = select(User).where(User.email == email)
            result = await session.execute(query)
            if result.scalar_one_or_none():
                print_error(f"Email '{email}' already exists")
                return False

            # Create the admin user
            user = User(
                user_id=f"user_{uuid.uuid4().hex[:12]}",
                username=username,
                email=email,
                hashed_password=security.hash_password(password),
                full_name=full_name or username.title(),
                roles="admin",
                is_active=True,
                is_verified=True,
            )
            session.add(user)
            await session.commit()

            print_success(f"Admin user '{username}' created successfully")
            print_info(f"  User ID: {user.user_id}")
            print_info(f"  Email: {email}")
            print_info("  Role: admin")
            return True

    except Exception as e:
        print_error(f"Failed to create admin user: {e}")
        return False


async def init_database() -> bool:
    """Initialize database with default users."""
    from sqlalchemy import select

    from app.api.v1.endpoints.auth import init_default_users
    from app.models.base import async_session_maker
    from app.models.user import User

    try:
        # First check DB connectivity
        if not await check_database():
            return False

        async with async_session_maker() as session:
            # Check if any users exist
            query = select(User).limit(1)
            result = await session.execute(query)
            existing_user = result.scalar_one_or_none()

            if existing_user:
                print_info("Users already exist in database")
                print_info("Skipping default user creation")
                return True

            # Create default users
            print_info("Creating default users...")
            await init_default_users(session)
            print_success("Default users created:")
            print_info("  - admin / admin123 (admin role)")
            print_info("  - radiologist / rad123 (radiologist role)")
            print_info("  - technologist / tech123 (technologist role)")
            print_info("")
            print_info("IMPORTANT: Change these passwords in production!")
            return True

    except Exception as e:
        print_error(f"Failed to initialize database: {e}")
        return False


def cmd_version(_args: argparse.Namespace) -> int:
    """Show version information."""
    print_banner()
    print(f"Version:     {settings.app_version}")
    print(f"Environment: {settings.environment}")
    print(f"Debug:       {settings.debug}")
    print(f"Python:      {sys.version.split()[0]}")
    return 0


def cmd_check_db(_args: argparse.Namespace) -> int:
    """Check database connectivity command."""
    print_banner()
    result = asyncio.run(check_database())
    return 0 if result else 1


def cmd_create_admin(args: argparse.Namespace) -> int:
    """Create admin user command."""
    print_banner()

    username = args.username
    email = args.email
    password = args.password

    # Prompt for password if not provided
    if not password:
        print("Enter password for the admin user:")
        password = getpass.getpass("Password: ")
        confirm = getpass.getpass("Confirm password: ")
        if password != confirm:
            print_error("Passwords do not match")
            return 1

    # Validate password length
    if len(password) < 8:
        print_error("Password must be at least 8 characters")
        return 1

    # Validate email format (basic check)
    if "@" not in email or "." not in email:
        print_error("Invalid email format")
        return 1

    result = asyncio.run(
        create_admin_user(
            username=username,
            email=email,
            password=password,
            full_name=args.full_name,
        )
    )
    return 0 if result else 1


def cmd_init_db(_args: argparse.Namespace) -> int:
    """Initialize database command."""
    print_banner()
    result = asyncio.run(init_database())
    return 0 if result else 1


def main() -> NoReturn:
    """Main CLI entry point."""
    parser = argparse.ArgumentParser(
        prog="horalix-cli",
        description="Horalix View CLI - Administrative command line interface",
        epilog="For more information, see https://horalix.io/docs",
    )
    parser.add_argument(
        "--version",
        "-V",
        action="version",
        version=f"Horalix View {settings.app_version}",
    )

    subparsers = parser.add_subparsers(
        title="commands",
        description="Available commands",
        dest="command",
    )

    # version command
    version_parser = subparsers.add_parser(
        "version",
        help="Show version information",
    )
    version_parser.set_defaults(func=cmd_version)

    # check-db command
    check_db_parser = subparsers.add_parser(
        "check-db",
        help="Check database connectivity",
    )
    check_db_parser.set_defaults(func=cmd_check_db)

    # init-db command
    init_db_parser = subparsers.add_parser(
        "init-db",
        help="Initialize database with default users",
    )
    init_db_parser.set_defaults(func=cmd_init_db)

    # create-admin command
    create_admin_parser = subparsers.add_parser(
        "create-admin",
        help="Create an admin user",
    )
    create_admin_parser.add_argument(
        "--username",
        "-u",
        required=True,
        help="Username for the admin account",
    )
    create_admin_parser.add_argument(
        "--email",
        "-e",
        required=True,
        help="Email address for the admin account",
    )
    create_admin_parser.add_argument(
        "--password",
        "-p",
        required=False,
        help="Password (will prompt if not provided)",
    )
    create_admin_parser.add_argument(
        "--full-name",
        "-n",
        required=False,
        help="Full name for the admin account",
    )
    create_admin_parser.set_defaults(func=cmd_create_admin)

    # Parse arguments
    args = parser.parse_args()

    if not args.command:
        parser.print_help()
        sys.exit(0)

    # Execute command
    exit_code = args.func(args)
    sys.exit(exit_code)


if __name__ == "__main__":
    main()
