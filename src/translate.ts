import { resolve } from 'path';
import {
  getLanguageFiles,
  getTargetLanguages,
  groupEnContent,
  updateLanguageFile,
  ensureTempDirectory
} from './file-processor.js';
import type { GroupedContent } from './file-processor.js';
import {
  simpleDiff,
  backupFile,
  getTranslatableContent,
  readJsonFile
} from './diff.js';
import { translateTextObject, getLanguageName } from './ai.js';

// 翻译选项接口
export interface TranslateOptions {
  workspaceDir?: string;
  tempDir?: string;
  onLanguageComplete?: (languageCode: string, groupName?: string) => void;
  useLineGrouping?: boolean; // 是否对简单JSON文件使用行分组
  linesPerGroup?: number;    // 每组的行数，默认20
}

// 翻译结果接口
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

// 初始化翻译环境
async function initializeTranslation(options: TranslateOptions): Promise<{
  languageFiles: any[];
  enFilePath: string;
  oldEnFilePath: string;
  targetLanguages: string[];
}> {
  const workspaceDir = options.workspaceDir || 'workspace';
  const tempDir = options.tempDir || 'workspace/temp';

  // 确保temp目录存在
  ensureTempDirectory(tempDir);

  // 获取语言文件
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

// 检查是否需要翻译
async function checkTranslationNeeds(
  enFilePath: string,
  oldEnFilePath: string,
  options: TranslateOptions = {}
): Promise<{ shouldTranslate: boolean; translatableContent: GroupedContent }> {

  // 检查是否为首次运行或 en_old.json 为空
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
  
  // 如果是首次运行或 en_old.json 为空，翻译所有内容
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
  
  // 获取需要翻译的内容
  const enData = readJsonFile(enFilePath);
  const rawTranslatableContent = getTranslatableContent(enData, diffResult);
  
  // 将 JSONObject 转换为 GroupedContent，保持嵌套结构
  const translatableContent: GroupedContent = {};
  
  for (const [key, value] of Object.entries(rawTranslatableContent)) {
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      // 如果是对象，保持其完整的嵌套结构，不进行任何转换
      translatableContent[key] = value;
    } else {
      // 如果不是对象，创建默认组
      if (!translatableContent.default) {
        translatableContent.default = {};
      }
      (translatableContent.default as Record<string, string>)[key] = typeof value === 'string' ? value : String(value || '');
    }
  }

  return { shouldTranslate: true, translatableContent };
}

// 翻译单个语言
async function translateLanguage(
  languageCode: string,
  translatableContent: GroupedContent,
  workspace: string,
  onGroupComplete?: (groupName: string) => void
): Promise<{ success: boolean; error?: string }> {
  try {
    // 验证输入
    if (!translatableContent || Object.keys(translatableContent).length === 0) {
      throw new Error('没有内容需要翻译');
    }

    const translatedGroups: GroupedContent = {};
    let groupErrors = 0;
    const totalGroups = Object.keys(translatableContent).length;
    
    // 检查是否使用了行分组（组名以 "lines_" 开头）
    const isLineGrouping = Object.keys(translatableContent).some(name => name.startsWith('lines_'));
    
    if (isLineGrouping) {
      console.log(`📊 检测到简单JSON文件，使用行分组翻译（共 ${totalGroups} 组）`);
    } else {
      console.log(`📊 开始翻译 ${languageCode}，共 ${totalGroups} 个组`);
    }

    // 按组翻译
    for (const [groupName, groupData] of Object.entries(translatableContent)) {
      try {
        // 验证组数据
        if (!groupData) {
          continue;
        }
        
        // 检查是否为对象类型
        if (typeof groupData === 'object' && Object.keys(groupData).length === 0) {
          continue;
        }
        
        const context = `这是用户界面翻译项目的一部分。当前正在翻译 "${groupName}" 组的内容。请保持翻译的一致性和专业性。`;
        
        // 确保传递给 translateTextObject 的是正确的类型
        const inputData = typeof groupData === 'object' ? groupData as Record<string, any> : {};
        
        const translatedGroup = await translateTextObject(
          inputData,
          languageCode,
          context
        );
        
        // 验证翻译结果
        if (!translatedGroup || (typeof translatedGroup === 'object' && Object.keys(translatedGroup).length === 0)) {
          throw new Error(`组 ${groupName} 翻译结果为空`);
        }
        
        translatedGroups[groupName] = translatedGroup;
        
        // 通知组完成
        if (onGroupComplete) {
          onGroupComplete(groupName);
        }
        
        // 显示进度
        const completedGroups = Object.keys(translatedGroups).length;
        const progress = Math.round((completedGroups / totalGroups) * 100);
        if (isLineGrouping) {
          console.log(`  ✅ 完成组 ${groupName} (${completedGroups}/${totalGroups}, ${progress}%)`);
        }
        
      } catch (groupError) {
        groupErrors++;
        
        // 如果组错误率过高，停止翻译
        const errorRate = groupErrors / (Object.keys(translatedGroups).length + groupErrors);
        if (errorRate > 0.5 && groupErrors >= 2) {
          throw new Error(`组翻译错误率过高 (${(errorRate * 100).toFixed(1)}%)，停止翻译。最新错误: ${groupError}`);
        }
      }
    }

    // 检查是否有成功的翻译
    if (Object.keys(translatedGroups).length === 0) {
      throw new Error('没有成功翻译任何组');
    }

    // 获取语言文件路径并更新
    const languageFilePath = resolve(process.cwd(), workspace, `${languageCode}.json`);
    
    // 验证文件路径
    if (!languageFilePath) {
      throw new Error('无法确定语言文件路径');
    }
    
    updateLanguageFile(languageFilePath, translatedGroups);
    
    // 验证文件是否成功写入
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

// 主翻译函数
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
    // 初始化
    const { languageFiles, enFilePath, oldEnFilePath, targetLanguages } = 
      await initializeTranslation(options);

    result.summary.totalLanguages = targetLanguages.length;

    const workspace = options.workspaceDir

    if (targetLanguages.length === 0) {
      console.log('\n⚠️  没有找到目标语言文件');
      result.success = true;
      return result;
    }

    // 检查翻译需求
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

    // 检查是否有内容需要翻译
    const totalItems = Object.values(translatableContent)
      .reduce((sum, group) => sum + Object.keys(group).length, 0);

    if (totalItems === 0) {
      console.log('\n⚠️  没有内容需要翻译');
      result.success = true;
      result.skippedLanguages = targetLanguages;
      result.summary.skippedCount = targetLanguages.length;
      return result;
    }

    // 翻译每个语言
    for (const languageCode of targetLanguages) {
      const translateResult = await translateLanguage(
        languageCode,
        translatableContent,
        workspace!,
        (groupName: string) => {
          // 通知进度条当前组完成
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
        
        // 如果是严重错误（如API问题），停止翻译过程
        const error = translateResult.error || '';
        if (error.includes('API') || error.includes('网络') || error.includes('错误率过高')) {
          break;
        }
      }
    }

    // 判断整体成功状态
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

// 打印翻译结果摘要
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