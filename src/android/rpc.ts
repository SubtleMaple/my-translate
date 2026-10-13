/** JSON arrays turn undefined into null; keep omitted optional IPC arguments distinct. */
export function encodeArguments(args: unknown[]): { args: unknown[]; undefinedArgs: number[] } {
  return { args, undefinedArgs: args.flatMap((value, index) => value === undefined ? [index] : []) }
}
export function decodeArguments(request: { args: unknown[]; undefinedArgs?: number[] }): unknown[] {
  return request.args.map((value, index) => request.undefinedArgs?.includes(index) ? undefined : value)
}
