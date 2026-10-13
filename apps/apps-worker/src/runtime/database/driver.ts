// oxlint-disable-next-line max-classes-per-file -- These related adapter or mock classes implement one runtime boundary.
import type { MutationDatabase } from "@tailorkit/app/server";
import type { Query } from "drizzle-orm";
import { fillPlaceholders, getTableName, isView, isTable } from "drizzle-orm";
import type { AnyRelations } from "drizzle-orm/relations";
import {
  BaseSQLiteDatabase,
  SQLitePreparedQuery,
  SQLiteSession,
  SQLiteSyncDialect,
} from "drizzle-orm/sqlite-core";
import type {
  PreparedQueryConfig,
  SQLiteExecuteMethod,
} from "drizzle-orm/sqlite-core";
import type { SelectedFieldsOrdered } from "drizzle-orm/sqlite-core/query-builders/select.types";
import { makeDefaultQueryMapper } from "drizzle-orm/utils";

import { AppError } from "../errors";
import { ALL_DATABASE_TABLES } from "./dependencies";

type WorkerSQLiteSession = SQLiteSession<"sync", { changes: number }>;
type RowMapper = NonNullable<
  Parameters<WorkerSQLiteSession["prepareQuery"]>[3]
>;
type RelationalRowMapper = Parameters<
  WorkerSQLiteSession["prepareRelationalQuery"]
>[3];
type PlaceholderValues = Parameters<
  SQLitePreparedQuery<PreparedQueryConfig & { type: "sync" }>["all"]
>[0];

export interface SqlResult {
  columns: string[];
  rows: unknown[][];
  changes: number;
}
export interface Persistence {
  execute: (sql: string, params: unknown[]) => SqlResult;
  transaction: <T>(run: () => T) => T;
}
interface Metadata {
  type: "select" | "insert" | "update" | "delete";
  tables: string[];
}

export const databaseScope = (
  driver: Persistence,
  writable: boolean,
  relations: AnyRelations = {}
) => {
  const reads = new Set<string>();
  const writes = new Set<string>();
  let active = true;
  class Prepared extends SQLitePreparedQuery<
    PreparedQueryConfig & { type: "sync" }
  > {
    private readonly relationalMapper: RelationalRowMapper | undefined;
    private fields: SelectedFieldsOrdered | undefined;
    private mapper: RowMapper | undefined;
    private metadata: Metadata | undefined;
    constructor(
      query: Query,
      fields: SelectedFieldsOrdered | undefined,
      method: SQLiteExecuteMethod,
      mapper: RowMapper | undefined,
      metadata: Metadata | undefined,
      relationalMapper?: RelationalRowMapper
    ) {
      super("sync", method, query);
      this.fields = fields;
      this.mapper = mapper;
      this.metadata = metadata;

      this.relationalMapper = relationalMapper;
    }
    private executeSql(values: NonNullable<PlaceholderValues> = {}) {
      if (!active) {
        throw new AppError("BAD_REQUEST", "Database scope has ended");
      }
      if (!this.metadata) {
        throw new AppError(
          "BAD_REQUEST",
          "Use the supported database query builders"
        );
      }
      if (!writable && this.metadata.type !== "select") {
        throw new AppError("FORBIDDEN", "Queries cannot write");
      }
      const result = driver.execute(
        this.query.sql,
        fillPlaceholders(this.query.params, values)
      );
      for (const table of this.metadata.tables) {
        if (this.metadata.type === "select") {
          reads.add(table);
        } else if (result.changes) {
          writes.add(table);
        }
      }
      return result;
    }
    run(values?: PlaceholderValues) {
      return { changes: this.executeSql(values).changes };
    }
    values(values?: PlaceholderValues) {
      return this.executeSql(values).rows;
    }
    all(values?: PlaceholderValues) {
      const result = this.executeSql(values);
      if (this.relationalMapper) {
        return this.relationalMapper(
          result.rows.map((row) =>
            Object.fromEntries(
              result.columns.map((name, index) => [name, row[index]])
            )
          )
        );
      }
      if (this.mapper) {
        return this.mapper(result.rows);
      }
      if (this.fields) {
        // SAFETY: Drizzle SQLitePreparedQuery carries joinsNotNullableMap at runtime for its row mapper; its public subclass type omits the inherited metadata.
        return makeDefaultQueryMapper<unknown[]>(
          this.fields,
          (
            this as typeof this & {
              joinsNotNullableMap?: Record<string, boolean>;
            }
          ).joinsNotNullableMap
        )(result.rows);
      }
      return result.rows.map((row) =>
        Object.fromEntries(
          result.columns.map((name, index) => [name, row[index]])
        )
      );
    }
    get(values?: PlaceholderValues) {
      const result = this.all(values);
      if (this.relationalMapper) {
        return result;
      }
      if (!Array.isArray(result)) {
        throw new AppError(
          "INTERNAL_SERVER_ERROR",
          "Row mapper must return an array"
        );
      }
      return result[0];
    }
  }
  class Session extends SQLiteSession<"sync", { changes: number }> {
    // oxlint-disable-next-line class-methods-use-this -- The adapter overrides an instance method required by the upstream interface.
    prepareQuery(
      query: Query,
      fields: SelectedFieldsOrdered | undefined,
      method: SQLiteExecuteMethod,
      mapper?: RowMapper,
      metadata?: Metadata
    ) {
      return new Prepared(query, fields, method, mapper, metadata);
    }
    // oxlint-disable-next-line class-methods-use-this -- The adapter overrides an instance method required by the upstream interface.
    prepareRelationalQuery(
      query: Query,
      fields: SelectedFieldsOrdered | undefined,
      method: SQLiteExecuteMethod,
      mapper: RelationalRowMapper
    ) {
      // RQB does not expose query metadata. Track all configured tables so nested
      // selections and relation filters invalidate subscriptions when their data changes.
      const tables = Object.values(relations).map(({ table }) => {
        if (isTable(table)) {
          return getTableName(table);
        }
        if (isView(table)) {
          // Existing and raw-SQL views need not expose their base tables. Refresh
          // these subscriptions on any table write rather than risk stale results.
          return ALL_DATABASE_TABLES;
        }
        throw new AppError("BAD_REQUEST", "Invalid relational table");
      });
      return new Prepared(
        query,
        fields,
        method,
        undefined,
        { tables, type: "select" },
        mapper
      );
    }
    // oxlint-disable-next-line class-methods-use-this -- The adapter overrides an instance method required by the upstream interface.
    transaction(): never {
      throw new AppError(
        "BAD_REQUEST",
        "Mutations already run in an atomic transaction"
      );
    }
  }
  const dialect = new SQLiteSyncDialect();
  const underlying = new BaseSQLiteDatabase<
    "sync",
    { changes: number },
    Record<string, never>,
    AnyRelations
  >("sync", dialect, new Session(dialect), relations, undefined, false, true);
  const db: MutationDatabase<AnyRelations> = {
    delete: underlying.delete.bind(underlying),
    insert: underlying.insert.bind(underlying),
    query: underlying.query,
    select: underlying.select.bind(underlying),
    selectDistinct: underlying.selectDistinct.bind(underlying),
    update: underlying.update.bind(underlying),
  };
  return {
    close: () => {
      active = false;
    },
    db,
    reads,
    writes,
  };
};
