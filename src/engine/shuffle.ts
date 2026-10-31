/**
 * 打乱算法（F-003）。
 *
 * Fisher-Yates 随机置换，重试直至「完全错位」（无任何块位于原位）。
 * 对任意块数都采用完全错位：既是文档对 ≤9 块的硬性要求，
 * 对更大块数也是合法的超集（交换式玩法下任意置换均可还原）。
 */
export function shuffledAssignment(n: number, rng: () => number = Math.random): number[] {
  for (let attempt = 0; attempt < 500; attempt++) {
    const arr = Array.from({ length: n }, (_, i) => i);
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    if (arr.every((v, i) => v !== i)) return arr;
  }
  // 兜底（理论上几乎不可达）：整体轮转一位，恒为完全错位
  return Array.from({ length: n }, (_, i) => (i + 1) % n);
}
