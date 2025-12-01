import { readFileSync } from 'fs';
import { resolve } from 'path';

// 配置接口
interface AIConfig {
  apikey: string;
  url: string;
  module: string;
  max_tokens: number;
  temperature: number;
}

// 翻译请求接口
interface TranslationRequest {
  text: string;
  targetLanguage: string;
  context?: string;
}

// 翻译响应接口
interface TranslationResponse {
  success: boolean;
  translatedText?: string;
  error?: string;
}

// 语言映射
const LANGUAGE_MAP: Record<string, string> = {
  'zh-CN': '简体中文',
  'fr': '法语',
  'de': '德语',
  'es': '西班牙语',
  'it': '意大利语',
  'nl': '荷兰语',
  'pl': '波兰语',
  'se': '瑞典语',
  'dk': '丹麦语',
  'cz': '捷克语',
  'be': '白俄罗斯语'
};

/**
 * 读取配置文件
 */
function loadConfig(): AIConfig {
  try {
    const envPath = resolve(process.cwd(), '.env');
    const envContent = readFileSync(envPath, 'utf-8');
    
    const config: Partial<AIConfig> = {};
    envContent.split('\n').forEach(line => {
      const [key, ...valueParts] = line.split('=');
      if (key && valueParts.length > 0) {
        const value = valueParts.join('=').trim();
        switch (key.trim()) {
          case 'apikey':
            config.apikey = value;
            break;
          case 'url':
            config.url = value;
            break;
          case 'module':
            config.module = value;
            break;
          case 'max_tokens':
            config.max_tokens = parseInt(value);
            break;
          case 'temperature':
            config.temperature = parseFloat(value);
            break;
        }
      }
    });

    if (!config.apikey || !config.url) {
      throw new Error('Missing required API configuration (apikey or url)');
    }

    return {
      apikey: config.apikey!,
      url: config.url!,
      module: config.module || 'glm-4.5',
      max_tokens: config.max_tokens || 4096,
      temperature: config.temperature || 0.6
    };
  } catch (error) {
    throw new Error(`Failed to load configuration: ${error}`);
  }
}

/**
 * 构建翻译提示词
 */
function buildTranslationPrompt(text: string, targetLanguage: string, context?: string): string {
  const languageName = LANGUAGE_MAP[targetLanguage] || targetLanguage;
  
  const basePrompt = `你是一个专业的翻译助手。请将以下英文文本翻译成${languageName}。

翻译要求：
1. 保持原文的格式和结构
2. 对于占位符（如 {{name}}, {{field}} 等），请保持不变
3. 对于技术术语，使用标准的${languageName}翻译
4. 保持简洁明了，符合用户界面的语言习惯
5. 如果是按钮文本，请保持简洁
6. 如果是错误或成功消息，请保持专业和友好的语气

待翻译文本：
${text}

请只返回翻译后的文本，不要包含任何解释或说明。`;

  if (context) {
    return `${context}

${basePrompt}`;
  }

  return basePrompt;
}

// API响应接口
interface APIResponse {
  choices: Array<{
    message: {
      content: string;
    };
  }>;
}

/**
 * 调用AI API进行翻译
 */
async function callAI(config: AIConfig, prompt: string): Promise<string> {
  try {
    const response = await fetch(config.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apikey}`
      },
      body: JSON.stringify({
        model: config.module,
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ],
        max_tokens: config.max_tokens,
        temperature: config.temperature,
        "thinking": {
          "type": "disabled"
        },
      })
    });

    if (!response.ok) {
      throw new Error(`API request failed: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as APIResponse;
    
    if (data.choices && data.choices.length > 0 && data.choices[0] && data.choices[0].message) {
      return data.choices[0].message.content.trim();
    } else {
      throw new Error('Invalid API response format');
    }
  } catch (error) {
    throw new Error(`AI API call failed: ${error}`);
  }
}

/**
 * 翻译单个文本
 */
export async function translateText(request: TranslationRequest): Promise<TranslationResponse> {
  try {
    const config = loadConfig();
    const prompt = buildTranslationPrompt(request.text, request.targetLanguage, request.context);
    
    console.log(`🔄 翻译请求: -> ${request.targetLanguage}`);
    
    const translatedText = await callAI(config, prompt);
    
    // 验证翻译结果
    if (!translatedText || translatedText.trim().length === 0) {
      throw new Error('翻译结果为空');
    }
    
    // 检查翻译结果是否与原文相同（可能表示翻译失败）
    if (translatedText.trim() === request.text.trim()) {
      console.warn(`⚠️  警告：翻译结果与原文相同，可能翻译失败: "${translatedText}"`);
    }
    
    // 检查是否保留了占位符
    const placeholders = request.text.match(/\{\{[^}]+\}\}/g) || [];
    const translatedPlaceholders = translatedText.match(/\{\{[^}]+\}\}/g) || [];
    
    if (placeholders.length !== translatedPlaceholders.length) {
      console.warn(`⚠️  警告：占位符数量不匹配，原文: ${placeholders.length}, 翻译: ${translatedPlaceholders.length}`);
    }
    
    console.log(`✅ 翻译完成`);
    
    return {
      success: true,
      translatedText
    };
  } catch (error) {
    console.error(`❌ 翻译失败: ${error}`);
    return {
      success: false,
      error: `Translation failed: ${error}`
    };
  }
}

/**
 * 批量翻译文本对象
 */
export async function translateTextObject(
  textObject: Record<string, string>,
  targetLanguage: string,
  context?: string
): Promise<Record<string, string>> {
  const totalItems = Object.keys(textObject).length;
  console.log(`🌍 开始整组翻译到 ${getLanguageName(targetLanguage)} (${targetLanguage})，共 ${totalItems} 项`);
  
  // 构建整组翻译的JSON字符串
  const jsonString = JSON.stringify(textObject, null, 2);
  
  console.log(`\n📝 翻译组内容:`);
  console.log(`   项数: ${totalItems}`);
  console.log(`   内容预览: ${jsonString.substring(0, 200)}${jsonString.length > 200 ? '...' : ''}`);
  
  // 构建整组翻译的提示词
  const groupContext = `${context || ''}

请将以下JSON对象中的所有值从英文翻译成${getLanguageName(targetLanguage)}。

翻译要求：
1. 只翻译值（values），保持键（keys）不变
2. 保持JSON格式不变
3. 对于占位符（如 {{name}}, {{field}} 等），请保持不变
4. 对于技术术语，使用标准的${getLanguageName(targetLanguage)}翻译
5. 保持简洁明了，符合用户界面的语言习惯
6. 确保翻译的一致性和专业性

待翻译的JSON：
\`\`\`json
${jsonString}
\`\`\`

请返回完整的翻译后的JSON对象，格式与输入完全相同，只是值被翻译成${getLanguageName(targetLanguage)}。`;
  
  const response = await translateText({
    text: jsonString,
    targetLanguage,
    context: groupContext
  });
  
  if (!response.success || !response.translatedText) {
    console.error(`❌ 整组翻译失败: ${response.error}`);
    throw new Error(`整组翻译失败: ${response.error}`);
  }
  
  console.log(`\n✅ 整组翻译完成`);
  
  // 解析翻译后的JSON
  try {
    // 清理可能的markdown代码块标记
    let cleanText = response.translatedText.trim();
    
    // 移除可能的markdown代码块标记
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
    
    // 尝试多种方式解析JSON
    let translatedObject;
    try {
      translatedObject = JSON.parse(cleanText);
    } catch (firstError: any) {
      console.warn(`⚠️  第一次JSON解析失败，尝试修复常见问题: ${firstError.message}`);
      
      // 尝试修复常见的JSON问题
      let fixedText = cleanText;
      
      // 修复尾随逗号
      fixedText = fixedText.replace(/,\s*}/g, '}').replace(/,\s*]/g, ']');
      
      // 修复单引号
      fixedText = fixedText.replace(/'/g, '"');
      
      // 修复未引用的键
      fixedText = fixedText.replace(/(\w+):/g, '"$1":');
      
      try {
        translatedObject = JSON.parse(fixedText);
        console.log('✅ JSON修复成功');
      } catch (secondError: any) {
        console.warn(`⚠️  JSON修复失败，尝试手动提取: ${secondError.message}`);
        
        // 最后尝试：手动提取键值对
        translatedObject = {} as Record<string, string>;
        const lines = cleanText.split('\n');
        for (const line of lines) {
          const match = line.match(/^\s*"([^"]+)"\s*:\s*"([^"]*)"/);
          if (match && match[1] && match[2]) {
            translatedObject[match[1]] = match[2];
          }
        }
        
        if (Object.keys(translatedObject).length === 0) {
          throw new Error('无法解析任何有效的JSON数据');
        }
        
        console.log(`✅ 手动提取成功，获得 ${Object.keys(translatedObject).length} 个键值对`);
      }
    }
    
    // 验证翻译结果
    const translatedKeys = Object.keys(translatedObject);
    const originalKeys = Object.keys(textObject);
    
    if (translatedKeys.length !== originalKeys.length) {
      console.warn(`⚠️  警告：翻译后的键数量不匹配，原文: ${originalKeys.length}, 翻译: ${translatedKeys.length}`);
    }
    
    // 检查是否有键缺失
    for (const key of originalKeys) {
      if (!(key in translatedObject)) {
        console.warn(`⚠️  警告：翻译结果中缺少键 "${key}"，将使用原文`);
        translatedObject[key] = textObject[key];
      }
    }
    
    // 检查翻译是否真的发生了
    let hasRealTranslation = false;
    for (const [key, translatedValue] of Object.entries(translatedObject)) {
      if (translatedValue !== textObject[key]) {
        hasRealTranslation = true;
        break;
      }
    }
    
    if (!hasRealTranslation) {
      console.warn(`⚠️  警告：所有翻译项都与原文相同，可能翻译失败`);
    }
    
    console.log(`📊 翻译统计: 成功 ${translatedKeys.length}/${totalItems} 项`);
    
    return translatedObject;
    
  } catch (parseError) {
    console.error(`❌ 解析翻译结果失败: ${parseError}`);
    console.error(`   原始翻译结果: ${response.translatedText}`);
    
    // 如果JSON解析失败，尝试逐个翻译作为备选方案
    console.log(`🔄 JSON解析失败，尝试逐个翻译作为备选方案...`);
    return await fallbackToIndividualTranslation(textObject, targetLanguage, context);
  }
}

/**
 * 备选方案：逐个翻译
 */
async function fallbackToIndividualTranslation(
  textObject: Record<string, string>,
  targetLanguage: string,
  context?: string
): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  let translationErrors = 0;
  const totalItems = Object.keys(textObject).length;
  
  console.log(`🔄 使用备选方案：逐个翻译 ${totalItems} 项`);
  
  for (const [key, value] of Object.entries(textObject)) {
    const response = await translateText({
      text: value,
      targetLanguage,
      context: context ? `${context}\n\n当前翻译项: ${key}` : undefined
    });
    
    if (response.success && response.translatedText) {
      result[key] = response.translatedText;
    } else {
      translationErrors++;
      console.error(`❌ 翻译失败 ${key}: ${response.error}`);
      result[key] = value; // 翻译失败时保持原文
    }
    
    // 添加延迟以避免API限制
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  const successRate = (totalItems - translationErrors) / totalItems;
  console.log(`📊 备选方案统计: 成功 ${totalItems - translationErrors}/${totalItems} (${(successRate * 100).toFixed(1)}%)`);
  
  if (translationErrors > 0) {
    console.warn(`⚠️  有 ${translationErrors} 项翻译失败，已使用原文替代`);
  }
  
  return result;
}

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
