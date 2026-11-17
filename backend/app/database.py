"""SQLite for local development and Supabase Postgres when DATABASE_URL is set."""

from __future__ import annotations

import os
import re
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterable, Iterator, Mapping

try:
    import psycopg
    from psycopg.conninfo import conninfo_to_dict
    from psycopg.rows import dict_row
except ImportError:  # Local SQLite development can run without the Postgres driver.
    psycopg = None
    conninfo_to_dict = None
    dict_row = None


if psycopg is None:
    DB_INTEGRITY_ERRORS = (sqlite3.IntegrityError,)
else:
    DB_INTEGRITY_ERRORS = (sqlite3.IntegrityError, psycopg.IntegrityError)


def _replace_qmark_placeholders(query: str) -> str:
    result: list[str] = []
    in_single_quote = False
    index = 0
    while index < len(query):
        character = query[index]
        if character == "'":
            result.append(character)
            if in_single_quote and index + 1 < len(query) and query[index + 1] == "'":
                result.append("'")
                index += 2
                continue
            in_single_quote = not in_single_quote
        elif character == "?" and not in_single_quote:
            result.append("%s")
        else:
            result.append(character)
        index += 1
    return "".join(result)


def _postgres_query(query: str, parameters: Any) -> str:
    if isinstance(parameters, Mapping):
        return re.sub(r"(?<!:):([A-Za-z_][A-Za-z0-9_]*)", r"%(\1)s", query)
    return _replace_qmark_placeholders(query)


class DatabaseConnection:
    def __init__(self, raw_connection: Any, *, is_postgres: bool):
        self._raw = raw_connection
        self.is_postgres = is_postgres

    def _postgres_execute(self, query: str, parameters: Any = ()):
        stripped = query.strip()
        if re.fullmatch(r"PRAGMA\s+foreign_keys\s*=\s*ON", stripped, re.IGNORECASE):
            return self._raw.execute("SELECT 1")

        table_info = re.fullmatch(r"PRAGMA\s+table_info\(([A-Za-z_][A-Za-z0-9_]*)\)", stripped, re.IGNORECASE)
        if table_info:
            return self._raw.execute(
                """
                SELECT column_name AS name
                FROM information_schema.columns
                WHERE table_schema = current_schema() AND table_name = %s
                ORDER BY ordinal_position
                """,
                (table_info.group(1),),
            )

        if re.fullmatch(r"BEGIN\s+IMMEDIATE", stripped, re.IGNORECASE):
            # Preserve SQLite's serialized write boundary for invite and lead promotion flows.
            return self._raw.execute("SELECT pg_advisory_xact_lock(527091001)")

        query = _postgres_query(query, parameters)
        insert_ignore = re.match(r"^(\s*)INSERT\s+OR\s+IGNORE\s+INTO\b", query, re.IGNORECASE)
        if insert_ignore:
            query = re.sub(r"^\s*INSERT\s+OR\s+IGNORE\s+INTO\b", "INSERT INTO", query, count=1, flags=re.IGNORECASE)
            has_semicolon = query.rstrip().endswith(";")
            query = query.rstrip().removesuffix(";").rstrip() + " ON CONFLICT DO NOTHING"
            if has_semicolon:
                query += ";"
        return self._raw.execute(query, parameters)

    def execute(self, query: str, parameters: Any = ()):
        if self.is_postgres:
            return self._postgres_execute(query, parameters)
        return self._raw.execute(query, parameters)

    def executemany(self, query: str, parameters: Iterable[Any]):
        if self.is_postgres:
            cursor = self._raw.cursor()
            cursor.executemany(_postgres_query(query, ()), parameters)
            return cursor
        return self._raw.executemany(query, parameters)

    def executescript(self, script: str):
        if not self.is_postgres:
            return self._raw.executescript(script)
        cursor = None
        for statement in script.split(";"):
            if statement.strip():
                cursor = self.execute(statement)
        return cursor

    def commit(self) -> None:
        self._raw.commit()

    def rollback(self) -> None:
        self._raw.rollback()

    def close(self) -> None:
        self._raw.close()


@contextmanager
def open_database(sqlite_path: Path) -> Iterator[DatabaseConnection]:
    database_url = os.getenv("DATABASE_URL", "").strip()
    if database_url:
        if psycopg is None or conninfo_to_dict is None or dict_row is None:
            raise RuntimeError("DATABASE_URL is set, but the psycopg driver is not installed.")
        connection_info = conninfo_to_dict(database_url)
        if not connection_info.get("sslmode"):
            connection_info["sslmode"] = "require"
        raw_connection = psycopg.connect(
            **connection_info,
            connect_timeout=10,
            prepare_threshold=None,
            row_factory=dict_row,
        )
        connection = DatabaseConnection(raw_connection, is_postgres=True)
    else:
        sqlite_path.parent.mkdir(parents=True, exist_ok=True)
        raw_connection = sqlite3.connect(sqlite_path, timeout=10)
        raw_connection.row_factory = sqlite3.Row
        connection = DatabaseConnection(raw_connection, is_postgres=False)

    try:
        if not connection.is_postgres:
            connection.execute("PRAGMA foreign_keys = ON")
        yield connection
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()
