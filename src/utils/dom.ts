/** 断言非空，缺省时抛出带上下文的错误 */
export function must<T>(value: T | null | undefined, message = '缺少必要的元素'): T {
  if (value === null || value === undefined) throw new Error(message);
  return value;
}
