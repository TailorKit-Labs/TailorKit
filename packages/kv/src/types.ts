import type { Redis as UpstashRedis } from "@upstash/redis";
import type IORedis from "ioredis";

export interface SetOptions {
  // seconds
  ttl?: number;
}

export interface GetOptions {
  /** Maximum wait in milliseconds. Defaults to 5 seconds. */
  timeout?: number;
}

export type KVType = "upstash" | "redis";

type KVEngine<T extends KVType> = T extends "upstash" ? UpstashRedis : IORedis;

export interface KV<T extends KVType = KVType> {
  readonly type: T;
  engine: KVEngine<T>;
  get: (key: string, options?: GetOptions) => Promise<string | null>;
  getAndDelete: (key: string) => Promise<string | null>;
  increment: (key: string, ttl: number) => Promise<number>;
  set: (key: string, value: string, options?: SetOptions) => Promise<void>;
  delete: (key: string) => Promise<void>;
}
