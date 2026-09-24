declare module 'mammoth/mammoth.browser' {
  export function convertToHtml(input: { arrayBuffer: ArrayBuffer }, options?: unknown): Promise<{ value: string; messages: unknown[] }>;
}
