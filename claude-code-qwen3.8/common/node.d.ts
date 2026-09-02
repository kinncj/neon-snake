// Ambient declarations for the Node globals and built-in modules the tooling
// (tests, Node-side scripts) touches. We deliberately do NOT depend on
// @types/node; we declare only the surface actually used, so the domain — which
// imports none of this — stays dependency-free and DOM-free.

declare const process: {
  readonly env: Record<string, string | undefined>
  readonly argv: readonly string[]
  exit(code?: number): never
}

declare module 'node:fs' {
  export function readFileSync(path: string, enc: 'utf8'): string
  export function writeFileSync(path: string, data: string): void
  export function mkdirSync(path: string, opts?: { recursive?: boolean }): void
  export function existsSync(path: string): boolean
  export function readdirSync(path: string): string[]
  export function statSync(path: string): { isDirectory(): boolean }
}
declare module 'node:path' {
  export function resolve(...parts: string[]): string
  export function dirname(p: string): string
  export const sep: string
}
declare module 'node:url' {
  export function fileURLToPath(url: string | URL): string
}
