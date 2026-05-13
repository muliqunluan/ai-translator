import { resolve } from 'path';
import {
  getLanguageFiles,
  getTargetLanguages,
  groupEnContent,
  updateLanguageFile,
  ensureTempDirectory,
  readJsonFile
} from './file-processor.js';
import {
  simpleDiff,
  getTranslatableContent
} from './diff.js';
import { loadConfig, callAI } from './ai.js';
import { LANGUAGE_MAP } from './config.js';
import type { GroupedContent, TranslateOptions, TranslateResult } from './types.js';

// ============================================================
// 语言名称工具（从 config.ts 的 LANGUAGE_MAP 读取）
// ============================================================

/**
 * 获取支持的语言列表
 */
export function getSupportedLanguages(): string[] {
  return Object.keys(LANGUAGE_MAP);
}

/**
 * 获取语言名称
 */
export function getLanguageName(languageCode: string): string {
  return LANGUAGE_MAP[languageCode] || languageCode;
}

// ============================================================
// AI 翻译核心函数
// ============================================================

/** 调用 AI 翻译文本 */
export async function translateText(
  targetLanguage: string,
  prompt: string
): Promise<string> {
  const config = loadConfig();
  const ai = config.ai;
  const translatedText = await callAI(ai, config, prompt);

  if (!translatedText || translatedText.trim().length === 0) {
    throw new Error('翻译结果为空');
  }

  return translatedText;
}

/** 批量翻译 JSON 对象 */
export async function translateTextObject(
  textObject: Record<string, any>,
  targetLanguage: string,
  context?: string
): Promise<Record<string, any>> {
  const jsonString = JSON.stringify(textObject, null, 2);

  const groupContext = `${context || ''}

请将以下JSON对象中的所有值从英文翻译成${getLanguageName(targetLanguage)}。

翻译要求：
1. 只翻译值（values），保持键（keys）不变
2. 保持完整的JSON结构和嵌套关系不变
3. 对于嵌套对象，递归翻译所有层级的值，保持对象结构
4. 对于数组，翻译数组中的字符串元素，保持数组结构
5. 对于占位符（如 {{name}}, {{field}} 等），请保持不变
6. 对于技术术语，使用标准的${getLanguageName(targetLanguage)}翻译
7. 保持简洁明了，符合用户界面的语言习惯
8. 确保翻译的一致性和专业性
9. 重要：不要将对象或数组转换为字符串，必须保持原始的JSON结构

待翻译的JSON：
\`\`\`json
${jsonString}
\`\`\`

请返回完整的翻译后的JSON对象，格式与输入完全相同，只是值被翻译成${getLanguageName(targetLanguage)}。`;

  const translatedText = await translateText(targetLanguage, groupContext);

  // 清理可能的markdown代码块标记
  let cleanText = translatedText.trim();
  if (cleanText.startsWith('```json')) {
    cleanText = cleanText.substring(7);
  }
  if (cleanText.startsWith('```')) {
    cleanText = cleanText.substring(3);
  }
  if (cleanText.endsWith('```')) {
    cleanText = cleanText.substring(0, cleanText.length - 3);
  }
  cleanText = cleanText.trim();

  try {
    const translatedObject = JSON.parse(cleanText);
    return translatedObject;
  } catch (parseError) {
    console.error('JSON解析失败:', parseError);
    return textObject; // 解析失败时返回原始对象
  }
}

// ============================================================
// 翻译环境初始化
// ============================================================

async function initializeTranslation(options: TranslateOptions): Promise<{
  languageFiles: any[];
  enFilePath: string;
  oldEnFilePath: string;
  targetLanguages: string[];
}> {
  const workspaceDir = options.workspaceDir || 'workspace';
  const tempDir = options.tempDir || 'workspace/temp';

  ensureTempDirectory(tempDir);

  const languageFiles = await getLanguageFiles(workspaceDir);

  const enFile = languageFiles.find(f => f.code === 'en');
  if (!enFile) {
    throw new Error('未找到 en.json 文件');
  }

  const enFilePath = enFile.path;
  const oldEnFilePath = resolve(process.cwd(), tempDir, 'en_old.json');
  const targetLanguages = getTargetLanguages(languageFiles);

  return {
    languageFiles,
    enFilePath,
    oldEnFilePath,
    targetLanguages
  };
}

// ============================================================
// 翻译需求检查（增量 / 全量）
// ============================================================

async function checkTranslationNeeds(
  enFilePath: string,
  oldEnFilePath: string,
  options: TranslateOptions = {}
): Promise<{ shouldTranslate: boolean; translatableContent: GroupedContent }> {

  const { existsSync, readFileSync } = await import('fs');
  const isFirstTime = !existsSync(oldEnFilePath);
  let isOldFileEmpty = false;

  if (!isFirstTime && existsSync(oldEnFilePath)) {
    try {
      const oldContent = readFileSync(oldEnFilePath, 'utf-8');
      const oldData = JSON.parse(oldContent);
      isOldFileEmpty = Object.keys(oldData).length === 0;
    } catch (error) {
      console.log(`⚠️  无法读取 en_old.json，将视为首次翻译: ${error}`);
      isOldFileEmpty = true;
    }
  }

  // 首次运行 或 en_old.json 为空 → 全量翻译
  if (isFirstTime || isOldFileEmpty) {
    const allContent = groupEnContent(
      enFilePath,
      options.useLineGrouping !== false,
      options.linesPerGroup || 20
    );
    return { shouldTranslate: true, translatableContent: allContent };
  }

  // 增量翻译：只翻译变化的内容
  const diffResult = simpleDiff(oldEnFilePath, enFilePath);

  if (diffResult.missing.length === 0 && diffResult.added.length === 0 && diffResult.changed.length === 0) {
    return { shouldTranslate: false, translatableContent: {} };
  }

  const enData = readJsonFile(enFilePath);
  const rawTranslatableContent = getTranslatableContent(enData, diffResult);

  // 转换为 GroupedContent
  const translatableContent: GroupedContent = {};

  for (const [key, value] of Object.entries(rawTranslatableContent)) {
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      translatableContent[key] = value;
    } else {
      if (!translatableContent.default) {
        translatableContent.default = {};
      }
      (translatableContent.default as Record<string, string>)[key] = typeof value === 'string' ? value : String(value || '');
    }
  }

  return { shouldTranslate: true, translatableContent };
}

// ============================================================
// 翻译单个语言
// ============================================================

async function translateLanguage(
  languageCode: string,
  translatableContent: GroupedContent,
  workspace: string,
  onGroupComplete?: (groupName: string) => void
): Promise<{ success: boolean; error?: string }> {
  try {
    if (!translatableContent || Object.keys(translatableContent).length === 0) {
      throw new Error('没有内容需要翻译');
    }

    const translatedGroups: GroupedContent = {};
    let groupErrors = 0;
    const totalGroups = Object.keys(translatableContent).length;

    const isLineGrouping = Object.keys(translatableContent).some(name => name.startsWith('lines_'));

    if (isLineGrouping) {
      console.log(`📊 检测到简单JSON文件，使用行分组翻译（共 ${totalGroups} 组）`);
    } else {
      console.log(`📊 开始翻译 ${languageCode}，共 ${totalGroups} 个组`);
    }

    for (const [groupName, groupData] of Object.entries(translatableContent)) {
      try {
        if (!groupData) continue;

        if (typeof groupData === 'object' && Object.keys(groupData).length === 0) continue;

        const context = `这是用户界面翻译项目的一部分。当前正在翻译 "${groupName}" 组的内容。请保持翻译的一致性和专业性。`;
        const inputData = typeof groupData === 'object' ? groupData as Record<string, any> : {};

        const translatedGroup = await translateTextObject(
          inputData,
          languageCode,
          context
        );

        if (!translatedGroup || (typeof translatedGroup === 'object' && Object.keys(translatedGroup).length === 0)) {
          throw new Error(`组 ${groupName} 翻译结果为空`);
        }

        translatedGroups[groupName] = translatedGroup;

        if (onGroupComplete) {
          onGroupComplete(groupName);
        }

        const completedGroups = Object.keys(translatedGroups).length;
        const progress = Math.round((completedGroups / totalGroups) * 100);
        if (isLineGrouping) {
          console.log(`  ✅ 完成组 ${groupName} (${completedGroups}/${totalGroups}, ${progress}%)`);
        }

      } catch (groupError) {
        groupErrors++;
        const errorRate = groupErrors / (Object.keys(translatedGroups).length + groupErrors);
        if (errorRate > 0.5 && groupErrors >= 2) {
          throw new Error(`组翻译错误率过高 (${(errorRate * 100).toFixed(1)}%)，停止翻译。最新错误: ${groupError}`);
        }
      }
    }

    if (Object.keys(translatedGroups).length === 0) {
      throw new Error('没有成功翻译任何组');
    }

    const languageFilePath = resolve(process.cwd(), workspace, `${languageCode}.json`);

    if (!languageFilePath) {
      throw new Error('无法确定语言文件路径');
    }

    updateLanguageFile(languageFilePath, translatedGroups);

    const { existsSync } = await import('fs');
    if (!existsSync(languageFilePath)) {
      throw new Error('翻译文件保存失败');
    }

    return { success: true };

  } catch (error) {
    const errorMessage = `翻译 ${languageCode} 失败: ${error}`;
    console.error(`❌ ${errorMessage}`);
    return { success: false, error: errorMessage };
  }
}

// ============================================================
// 主翻译函数
// ============================================================

export async function translate(options: TranslateOptions = {}): Promise<TranslateResult> {
  const result: TranslateResult = {
    success: false,
    translatedLanguages: [],
    skippedLanguages: [],
    errors: [],
    summary: {
      totalLanguages: 0,
      translatedCount: 0,
      skippedCount: 0,
      errorCount: 0
    }
  };

  try {
    const { languageFiles, enFilePath, oldEnFilePath, targetLanguages } =
      await initializeTranslation(options);

    result.summary.totalLanguages = targetLanguages.length;

    const workspace = options.workspaceDir;

    if (targetLanguages.length === 0) {
      console.log('\n⚠️  没有找到目标语言文件');
      result.success = true;
      return result;
    }

    const { shouldTranslate, translatableContent } = await checkTranslationNeeds(
      enFilePath,
      oldEnFilePath,
      options
    );

    if (!shouldTranslate) {
      result.success = true;
      result.skippedLanguages = targetLanguages;
      result.summary.skippedCount = targetLanguages.length;
      return result;
    }

    const totalItems = Object.values(translatableContent)
      .reduce((sum, group) => sum + Object.keys(group).length, 0);

    if (totalItems === 0) {
      console.log('\n⚠️  没有内容需要翻译');
      result.success = true;
      result.skippedLanguages = targetLanguages;
      result.summary.skippedCount = targetLanguages.length;
      return result;
    }

    for (const languageCode of targetLanguages) {
      const translateResult = await translateLanguage(
        languageCode,
        translatableContent,
        workspace!,
        (groupName: string) => {
          if (options.onLanguageComplete) {
            options.onLanguageComplete(languageCode, groupName);
          }
        }
      );

      if (translateResult.success) {
        result.translatedLanguages.push(languageCode);
        result.summary.translatedCount++;
      } else {
        result.errors.push(translateResult.error || '未知错误');
        result.summary.errorCount++;

        const error = translateResult.error || '';
        if (error.includes('API') || error.includes('网络') || error.includes('错误率过高')) {
          break;
        }
      }
    }

    result.success = result.summary.errorCount === 0 && result.summary.translatedCount > 0;

    return result;

  } catch (error) {
    const errorMessage = `翻译过程发生严重错误: ${error}`;
    console.error(`💥 ${errorMessage}`);
    result.errors.push(errorMessage);
    result.success = false;
    return result;
  }
}

// ============================================================
// 打印翻译结果摘要
// ============================================================

export function printTranslateSummary(result: TranslateResult): void {
  console.log('\n');

  if (result.success) {
    console.log('✅ 翻译完成！');
  } else {
    console.log('❌ 翻译过程中出现问题');
  }

  console.log(`📈 统计信息:`);
  console.log(`  - 总语言数: ${result.summary.totalLanguages}`);
  console.log(`  - 已翻译: ${result.summary.translatedCount}`);
  console.log(`  - 已跳过: ${result.summary.skippedCount}`);
  console.log(`  - 错误数: ${result.summary.errorCount}`);

  if (result.translatedLanguages.length > 0) {
    console.log('\n🌍 已翻译的语言:');
    result.translatedLanguages.forEach(code => {
      console.log(`  ✅ ${code} (${getLanguageName(code)})`);
    });
  }

  if (result.skippedLanguages.length > 0) {
    console.log('\n⏭️  跳过的语言:');
    result.skippedLanguages.forEach(code => {
      console.log(`  ⏭️  ${code} (${getLanguageName(code)})`);
    });
  }

  if (result.errors.length > 0) {
    console.log('\n❌ 错误信息:');
    result.errors.forEach(error => {
      console.log(`  ❌ ${error}`);
    });
  }
}
