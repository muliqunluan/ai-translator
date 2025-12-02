import { resolve } from 'path';
import {
  getLanguageFiles,
  getTargetLanguages,
  groupEnContent,
  updateLanguageFile,
  ensureTempDirectory,
  printLanguageInfo
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
  messageDir?: string;
  tempDir?: string;
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

/**
 * 初始化翻译环境
 */
async function initializeTranslation(options: TranslateOptions): Promise<{
  languageFiles: any[];
  enFilePath: string;
  oldEnFilePath: string;
  targetLanguages: string[];
}> {
  const messageDir = options.messageDir || 'message';
  const tempDir = options.tempDir || 'message/temp';

  // 确保temp目录存在
  ensureTempDirectory(tempDir);

  // 获取语言文件
  const languageFiles = await getLanguageFiles(messageDir);
  printLanguageInfo(languageFiles);

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

/**
 * 检查是否需要翻译
 */
async function checkTranslationNeeds(
  enFilePath: string,
  oldEnFilePath: string,
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
    console.log(`\n🎯 ${isFirstTime ? '首次翻译' : '检测到空文件'}：将翻译所有内容`);
    const allContent = groupEnContent(enFilePath);
    return { shouldTranslate: true, translatableContent: allContent };
  }
  
  // 增量翻译：只翻译变化的内容
  const diffResult = simpleDiff(oldEnFilePath, enFilePath);
  
  if (diffResult.missing.length === 0 && diffResult.added.length === 0 && diffResult.changed.length === 0) {
    console.log('\n✅ 没有检测到变化，无需翻译');
    return { shouldTranslate: false, translatableContent: {} };
  }

  console.log('\n🔍 检测到文件变化，准备增量翻译');
  
  // 获取需要翻译的内容
  const enData = readJsonFile(enFilePath);
  const rawTranslatableContent = getTranslatableContent(enData, diffResult);
  
  // 将 JSONObject 转换为 GroupedContent
  const translatableContent: GroupedContent = {};
  
  for (const [key, value] of Object.entries(rawTranslatableContent)) {
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      // 如果是对象，检查并转换其值为字符串
      const convertedObj: Record<string, string> = {};
      for (const [subKey, subValue] of Object.entries(value)) {
        if (typeof subValue === 'string') {
          convertedObj[subKey] = subValue;
        } else {
          // 将非字符串值转换为字符串
          convertedObj[subKey] = String(subValue);
        }
      }
      translatableContent[key] = convertedObj;
    } else {
      // 如果不是对象，创建默认组
      if (!translatableContent.default) {
        translatableContent.default = {};
      }
      translatableContent.default[key] = typeof value === 'string' ? value : String(value || '');
    }
  }
  
  // 打印差异报告
  console.log('\n=== 文件差异报告 ===');
  console.log(`📊 变化统计:`);
  console.log(`  - 新增: ${diffResult.added.length} 项`);
  console.log(`  - 修改: ${diffResult.changed.length} 项`);
  console.log(`  - 删除: ${diffResult.missing.length} 项`);
  
  if (diffResult.added.length > 0) {
    console.log('\n➕ 新增项:');
    diffResult.added.forEach(key => console.log(`  + ${key}`));
  }
  
  if (diffResult.changed.length > 0) {
    console.log('\n✏️ 修改项:');
    diffResult.changed.forEach(key => console.log(`  ~ ${key}`));
  }
  
  if (diffResult.missing.length > 0) {
    console.log('\n➖ 删除项:');
    diffResult.missing.forEach(key => console.log(`  - ${key}`));
  }
  console.log('==================');

  return { shouldTranslate: true, translatableContent };
}

/**
 * 翻译单个语言
 */
async function translateLanguage(
  languageCode: string,
  translatableContent: GroupedContent,
  dryRun: boolean = false
): Promise<{ success: boolean; error?: string }> {
  try {
    const languageName = getLanguageName(languageCode);
    console.log(`\n🌍 开始翻译 ${languageName} (${languageCode})`);

    // 验证输入
    if (!translatableContent || Object.keys(translatableContent).length === 0) {
      throw new Error('没有内容需要翻译');
    }

    if (dryRun) {
      console.log('🔍 预览模式 - 将要翻译的内容:');
      for (const [groupName, groupData] of Object.entries(translatableContent)) {
        console.log(`  📁 组: ${groupName}`);
        for (const [key, value] of Object.entries(groupData)) {
          console.log(`    - ${key}: "${value}"`);
        }
      }
      return { success: true };
    }

    const translatedGroups: GroupedContent = {};
    let groupErrors = 0;
    const totalGroups = Object.keys(translatableContent).length;

    // 按组翻译
    for (const [groupName, groupData] of Object.entries(translatableContent)) {
      try {
        console.log(`  📁 翻译组: ${groupName} (${Object.keys(groupData).length} 项)`);
        
        // 验证组数据
        if (!groupData || Object.keys(groupData).length === 0) {
          console.warn(`  ⚠️  组 ${groupName} 为空，跳过`);
          continue;
        }
        
        const context = `这是用户界面翻译项目的一部分。当前正在翻译 "${groupName}" 组的内容。请保持翻译的一致性和专业性。`;
        
        const translatedGroup = await translateTextObject(
          groupData,
          languageCode,
          context
        );
        
        // 验证翻译结果
        if (!translatedGroup || Object.keys(translatedGroup).length === 0) {
          throw new Error(`组 ${groupName} 翻译结果为空`);
        }
        
        // 检查翻译是否真的发生了（至少有一项与原文不同）
        let hasRealTranslation = false;
        for (const [key, translatedValue] of Object.entries(translatedGroup)) {
          if (translatedValue !== groupData[key]) {
            hasRealTranslation = true;
            break;
          }
        }
        
        if (!hasRealTranslation) {
          console.warn(`  ⚠️  警告：组 ${groupName} 的所有翻译项都与原文相同，可能翻译失败`);
        }
        
        translatedGroups[groupName] = translatedGroup;
        console.log(`  ✅ 完成 ${groupName} 组的翻译`);
        
      } catch (groupError) {
        groupErrors++;
        const errorMsg = `翻译组 ${groupName} 失败: ${groupError}`;
        console.error(`  ❌ ${errorMsg}`);
        
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
    const languageFilePath = resolve(process.cwd(), 'message', `${languageCode}.json`);
    
    // 验证文件路径
    if (!languageFilePath) {
      throw new Error('无法确定语言文件路径');
    }
    
    updateLanguageFile(languageFilePath, translatedGroups);
    
    // 验证文件是否成功写入
    const { existsSync, readFileSync } = await import('fs');
    if (!existsSync(languageFilePath)) {
      throw new Error('翻译文件保存失败');
    }
    
    try {
      const savedData = JSON.parse(readFileSync(languageFilePath, 'utf-8'));
      const savedKeys = Object.keys(savedData);
      const expectedKeys = Object.keys(translatedGroups);
      
      if (savedKeys.length < expectedKeys.length) {
        console.warn(`  ⚠️  警告：保存的文件键数 (${savedKeys.length}) 少于预期 (${expectedKeys.length})`);
      }
    } catch (verifyError) {
      console.warn(`  ⚠️  无法验证保存的文件: ${verifyError}`);
    }
    
    const successRate = ((totalGroups - groupErrors) / totalGroups * 100).toFixed(1);
    console.log(`  💾 已保存 ${languageName} 翻译文件 (成功率: ${successRate}%)`);
    
    if (groupErrors > 0) {
      console.warn(`  ⚠️  有 ${groupErrors} 个组翻译失败`);
    }
    
    return { success: true };

  } catch (error) {
    const errorMessage = `翻译 ${languageCode} 失败: ${error}`;
    console.error(`❌ ${errorMessage}`);
    
    // 分析错误原因
    if (errorMessage.includes('API') || errorMessage.includes('fetch')) {
      console.error(`💡 可能原因：网络问题、API密钥错误或API服务不可用`);
    } else if (errorMessage.includes('空') || errorMessage.includes('undefined')) {
      console.error(`💡 可能原因：API返回格式不正确或翻译内容为空`);
    } else if (errorMessage.includes('错误率过高')) {
      console.error(`💡 可能原因：连续翻译失败，可能是API配置问题或内容格式问题`);
    } else {
      console.error(`💡 请检查API配置和网络连接`);
    }
    
    return { success: false, error: errorMessage };
  }
}

/**
 * 主翻译函数
 */
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

    if (targetLanguages.length === 0) {
      console.log('\n⚠️  没有找到目标语言文件');
      result.success = true;
      return result;
    }

    // 检查翻译需求
    const { shouldTranslate, translatableContent } = await checkTranslationNeeds(
      enFilePath,
      oldEnFilePath
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

    console.log(`\n📊 准备翻译 ${totalItems} 项内容到 ${targetLanguages.length} 种语言`);

    // 翻译每个语言
    for (const languageCode of targetLanguages) {
      console.log(`\n🔄 开始处理语言: ${languageCode} (${getLanguageName(languageCode)})`);
      
      const translateResult = await translateLanguage(
        languageCode,
        translatableContent
      );

      if (translateResult.success) {
        result.translatedLanguages.push(languageCode);
        result.summary.translatedCount++;
        console.log(`✅ 语言 ${languageCode} 翻译完成`);
      } else {
        result.errors.push(translateResult.error || '未知错误');
        result.summary.errorCount++;
        console.error(`❌ 语言 ${languageCode} 翻译失败`);
        
        // 如果是严重错误（如API问题），停止翻译过程
        const error = translateResult.error || '';
        if (error.includes('API') || error.includes('网络') || error.includes('错误率过高')) {
          console.error(`💥 检测到严重错误，停止翻译过程以避免更多问题`);
          console.error(`💡 建议检查：1. API配置 2. 网络连接 3. 翻译内容格式`);
          break;
        }
      }
    }

    // 备份当前文件作为下次比较的基准
    if (result.summary.translatedCount > 0) {
      const backupSuccess = backupFile(enFilePath, oldEnFilePath);
      if (backupSuccess) {
        console.log('\n💾 已备份当前 en.json 作为下次比较基准');
      } else {
        console.warn('\n⚠️  备份文件失败，但不影响翻译结果');
      }
    }

    // 判断整体成功状态
    result.success = result.summary.errorCount === 0 && result.summary.translatedCount > 0;

    // 提供详细的分析和建议
    if (!result.success && result.summary.errorCount > 0) {
      console.error('\n📊 翻译失败分析:');
      console.error(`  - 成功翻译: ${result.summary.translatedCount}/${result.summary.totalLanguages} 种语言`);
      console.error(`  - 失败语言: ${result.summary.errorCount} 种`);
      
      if (result.errors.length > 0) {
        console.error('\n🔍 错误详情:');
        result.errors.forEach((error, index) => {
          console.error(`  ${index + 1}. ${error}`);
        });
      }
      
      console.error('\n💡 建议解决方案:');
      if (result.errors.some(e => e.includes('API'))) {
        console.error('  - 检查 .env 文件中的 API 配置');
        console.error('  - 验证 API 密钥是否有效');
        console.error('  - 确认 API 服务是否可用');
      }
      if (result.errors.some(e => e.includes('网络'))) {
        console.error('  - 检查网络连接');
        console.error('  - 尝试使用代理或更换网络环境');
      }
      if (result.errors.some(e => e.includes('错误率过高'))) {
        console.error('  - 检查翻译内容格式是否正确');
        console.error('  - 尝试减少单次翻译的内容量');
        console.error('  - 考虑使用强制翻译模式重新开始');
      }
    }

    return result;

  } catch (error) {
    const errorMessage = `翻译过程发生严重错误: ${error}`;
    console.error(`💥 ${errorMessage}`);
    result.errors.push(errorMessage);
    result.success = false;
    
    // 提供错误分析
    console.error('\n🔍 严重错误分析:');
    if (errorMessage.includes('ENOENT') || errorMessage.includes('文件')) {
      console.error('  - 可能是文件路径问题或权限问题');
    } else if (errorMessage.includes('JSON') || errorMessage.includes('解析')) {
      console.error('  - 可能是 JSON 文件格式错误');
    } else if (errorMessage.includes('内存') || errorMessage.includes('Memory')) {
      console.error('  - 可能是内存不足，尝试减少翻译内容');
    } else {
      console.error('  - 请检查系统环境和配置');
    }
    
    return result;
  }
}

/**
 * 打印翻译结果摘要
 */
export function printTranslateSummary(result: TranslateResult): void {
  console.log('\n' + '='.repeat(50));
  console.log('📊 翻译结果摘要');
  console.log('='.repeat(50));

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

  console.log('='.repeat(50));
}