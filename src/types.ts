// ============================================================
// AI 相关类型
// ============================================================

/** 支持的 AI 平台 */
export enum SupportAI {
  GLM = 'glm',
  DS = 'ds'
}

/** AI 配置 */
export interface AIConfig {
  ai: SupportAI;
  apikey: string;
  url: string;
  module: string;
  max_tokens: number;
  temperature: number;
}

/** AI 处理器接口 */
export interface AIHandler {
  call(config: AIConfig, prompt: string): Promise<string>;
}

/** API 响应格式（GLM / OpenAI 兼容） */
export interface APIResponse {
  choices: Array<{
    message: {
      content: string;
    };
  }>;
}

// ============================================================
// 翻译相关类型
// ============================================================

/** 翻译请求 */
export interface TranslationRequest {
  targetLanguage: string;
  context?: string;
}

/** 翻译响应 */
export interface TranslationResponse {
  success: boolean;
  translatedText?: string;
  error?: string;
}

/** 翻译选项 */
export interface TranslateOptions {
  workspaceDir?: string;
  tempDir?: string;
  onLanguageComplete?: (languageCode: string, groupName?: string) => void;
  useLineGrouping?: boolean;
  linesPerGroup?: number;
}

/** 翻译结果 */
export interface TranslateResult {
  success: boolean;
  translatedLanguages: string[];
  skippedLanguages: string[];
  errors: string[];
  summary: {
    totalLanguages: number;
    translatedCount: number;
    skippedCount: number;
    errorCount: number;
  };
}

// ============================================================
// JSON / 差异比较相关类型
// ============================================================

/** JSON 值类型（字符串或嵌套对象） */
export type JSONValue = string | JSONObject;

/** JSON 对象 */
export interface JSONObject {
  [key: string]: JSONValue;
}

/** 对象差异结果 */
export interface DiffResult {
  missing: string[];
  added: string[];
  changed: string[];
}

// ============================================================
// 文件处理相关类型
// ============================================================

/** 语言文件信息 */
export interface LanguageFile {
  code: string;
  path: string;
  exists: boolean;
}

/** 分组值类型（支持字符串、嵌套对象、数组） */
export type NestedValue = string | Record<string, any> | any[];

/** 分组内容 */
export interface GroupedContent {
  [groupName: string]: NestedValue;
}
