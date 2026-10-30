export function isNonNullish<Arg = unknown>(data: Arg): data is NonNullable<Arg> {
  return data !== null && typeof data !== 'undefined'
}
