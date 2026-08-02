/**
 * LLM Prompt 模板（统一维护：翻译 prompt / 生词详情 JSON prompt）
 * 详情要求模型返回严格 JSON，主进程负责容错解析与字段兜底（见 wordDetail.ts）
 */

export const TRANSLATE_SYSTEM_PROMPT =
  '你是一位专业的中英翻译引擎。将用户提供的英文内容翻译为准确、自然、通顺的中文。' +
  '只输出译文本身，不要添加任何解释、注音、引号或多余内容。'

export function buildDetailSystemPrompt(): string {
  return [
    '你是一位专业的英语学习助手。用户会提供一个英语单词或短语，以及该词出现时的原句。',
    '请输出一份结构化的中文学习材料。',
    '输出要求：只输出一个 JSON 对象，严禁输出 JSON 之外的任何文字（包括代码块标记 ```json、解释、前后缀内容）。',
    'JSON 字段及要求：',
    '- phonetic：字符串，英式音标，用 /…/ 包裹，例如 /ˈæpl/',
    '- pos：字符串，词性缩写（n. / v. / adj. / adv. / prep. 等，短语可写 phrase）',
    '- brief：字符串，简洁中文释义，30 字以内，用于列表卡片展示',
    '- usage：字符串，详细用法：常见搭配、使用场景、语气与正式程度说明',
    '- examples：数组，恰好 3 个例句对象，每个为 {"en": "英文例句", "zh": "中文翻译"}',
    '- synonyms：字符串数组，近义词 1-3 个，元素格式为 "英文（中文释义）"',
    '- antonyms：字符串数组，反义词 0-2 个，元素格式同上，没有则给空数组',
    '- memory：字符串，记忆提示或易混淆点（词根词缀、谐音联想、形近词辨析等）',
    '原句仅用于消除多义词的歧义，不要照抄进结果。某字段若无法确定，用空字符串或空数组，不要编造。'
  ].join('\n')
}

export function buildDetailUserPrompt(word: string, contextSentence: string): string {
  const sentence = contextSentence.trim()
  return [
    `单词/短语：${word}`,
    sentence ? `原句（仅用于消解歧义，不必出现在结果中）：${sentence}` : '原句：无'
  ].join('\n')
}
