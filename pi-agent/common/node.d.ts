// Minimal ambient declarations for the node builtins the toolchain uses.
// @types/node is intentionally not a dependency; these cover the surface
// the tests and config touch and nothing more.
declare module "node:fs" {
  export function readFileSync(path: string, encoding: "utf8"): string;
  export function readFileSync(path: string): Uint8Array;
  export function writeFileSync(path: string, data: string): void;
  export function readdirSync(path: string): string[];
  export function statSync(path: string): { size: number; isFile(): boolean; isDirectory(): boolean };
  export function existsSync(path: string): boolean;
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
// process env/platform for the playwright config's host probes.
declare const process: {
  platform: string;
  env: Record<string, string | undefined>;
  cwd(): string;
};
// Build stamp injected by Vite's `define` (see vite.config.ts) from the
// SNAKE_BUILD env var. Guarded at use sites with `typeof` so it also
// resolves in the pure-node test environment where it may be undefined.
declare const __SNAKE_BUILD__: string;
