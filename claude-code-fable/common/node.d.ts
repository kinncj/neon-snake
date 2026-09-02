// Ambient declarations for the node builtins the toolchain touches.
// @types/node is deliberately not a dependency; this is the whole surface.
declare module "node:fs" {
  export function readFileSync(path: string, encoding: "utf8"): string;
  export function readFileSync(path: string): Uint8Array;
  export function writeFileSync(path: string, data: string): void;
  export function readdirSync(path: string): string[];
  export function statSync(path: string): { size: number; isFile(): boolean; isDirectory(): boolean };
  export function existsSync(path: string): boolean;
  export function mkdirSync(path: string, opts?: { recursive?: boolean }): void;
}
declare module "node:child_process" {
  export function execSync(
    command: string,
    options?: {
      stdio?: string;
      cwd?: string;
      encoding?: "utf8";
      timeout?: number;
      env?: Record<string, string | undefined>;
    }
  ): string | Uint8Array;
}
declare module "node:zlib" {
  export function gzipSync(data: Uint8Array): Uint8Array;
}
declare module "node:url" {
  export function fileURLToPath(url: string | URL): string;
}
declare module "node:path" {
  export function join(...parts: string[]): string;
}
declare const process: {
  platform: string;
  env: Record<string, string | undefined>;
  cwd(): string;
  memoryUsage(): { heapUsed: number };
  hrtime: { bigint(): bigint };
};
declare function gc(): void;
// Build stamp injected by Vite `define`; guarded with typeof at use sites so
// the pure-node test environment (where it is undefined) still works.
declare const __SNAKE_BUILD__: string;
