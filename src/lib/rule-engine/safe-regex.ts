// 正则安全防护：规则中的 regex 来自 AI 生成或用户编辑，可能引发 ReDoS
// 所有动态正则编译必须经过此处，编译失败或命中危险模式时返回 null，调用方跳过该 pattern

const MAX_PATTERN_LENGTH = 200;

// 检测嵌套量词等典型灾难性回溯模式（如 (a+)+、(a*)*、(.*){n}）
const DANGEROUS_NESTED_QUANTIFIER = /\([^()]*[+*][^()]*\)\s*[+*{]/;

/**
 * 安全编译用户提供的正则。
 * @returns 编译成功的 RegExp，模式非法/超长/危险时返回 null
 */
export function safeRegExp(pattern: string | undefined): RegExp | null {
  if (!pattern || pattern.length > MAX_PATTERN_LENGTH) return null;
  if (DANGEROUS_NESTED_QUANTIFIER.test(pattern)) return null;
  try {
    return new RegExp(pattern);
  } catch {
    return null;
  }
}
