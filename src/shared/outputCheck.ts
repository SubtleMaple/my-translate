/**
 * 输出侧注入校验（纯函数，主/渲染两端共用，无运行时依赖）
 *
 * 策略：仅当输入以中文为主（EN→ZH 应用的域外输入）且输出不是整段回显时，
 * 判定「输出疑似执行了输入中的指令」（如案例3：翻译后追加自认任务）。
 * 英文为主的输入不做检查——忠实译文会如实复述输入中的中文片段，
 * 纯子串检测会误报（实测英文输入内嵌中文指令的忠实译文 lcs=33）。
 *
 * 中文为主的输入按提示词规则应整段原样返回；输出偏离回显即存在被注入风险。
 */

const CN_RATIO_THRESHOLD = 0.5
const ECHO_MATCH_RATIO = 0.9

function countCjk(text: string): number {
  let n = 0
  for (const ch of text) {
    if (/[\u4e00-\u9fff]/.test(ch)) n += 1
  }
  return n
}

function normalize(s: string): string {
  return s.replace(/\s+/g, '')
}

export interface OutputCheckResult {
  /** 是否标记「输出疑似执行了输入中的指令」 */
  flagged: boolean
  reason: 'cn-dominant-not-echo' | 'ok'
}

export function checkOutputForInjection(input: string, output: string): OutputCheckResult {
  if (!input.trim() || !output.trim()) return { flagged: false, reason: 'ok' }

  const cn = countCjk(input)
  if (cn / input.length < CN_RATIO_THRESHOLD) {
    // 英文为主的输入：翻译路径，不做输出校验
    return { flagged: false, reason: 'ok' }
  }

  const in2 = normalize(input)
  const out2 = normalize(output)
  // 回显路径：输出基本=输入全文（中文原样返回），放行
  if (out2.includes(in2) || in2.includes(out2)) {
    return { flagged: false, reason: 'ok' }
  }
  const covered = out2.length > 0 ? in2.length / (in2.length + out2.length) : 0
  if (covered < ECHO_MATCH_RATIO && out2.length < in2.length) {
    // 输出明显短于输入且非回显 → 部分内容被「翻译/执行」，存在注入痕迹
    return { flagged: true, reason: 'cn-dominant-not-echo' }
  }
  return { flagged: false, reason: 'ok' }
}
