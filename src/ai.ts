import { LANGUAGE_MAP } from './config'
import OpenAI from 'openai';

enum SupportAI {
  GLM = 'glm',
  DS = 'ds'
}

// 配置接口
interface AIConfig {
  ai: SupportAI;
  apikey: string;
  url: string;
  module: string;
  max_tokens: number;
  temperature: number;
}

// AI处理器接口
interface AIHandler {
  call(config: AIConfig, prompt: string): Promise<string>;
}

// 翻译请求接口
interface TranslationRequest {
  targetLanguage: string;
  context?: string;
}

// 翻译响应接口
interface TranslationResponse {
  success: boolean;
  translatedText?: string;
  error?: string;
}

// 读取环境配置
function loadConfig(): AIConfig {
  return {
    ai: (process.env.ai! as SupportAI) || SupportAI.GLM,
    apikey: process.env.apikey!,
    url: process.env.url!,
    module: process.env.module!,
    max_tokens: Number(process.env.max_tokens),
    temperature: Number(process.env.temperature)
  }
}

// GLM处理器
class GLMHandler implements AIHandler {
  async call(config: AIConfig, prompt: string): Promise<string> {
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
      throw new Error(`GLM API call failed: ${error}`);
    }
  }
}

// DeepSeek处理器
class DSHandler implements AIHandler {
  async call(config: AIConfig, prompt: string): Promise<string> {
    try {
      const openai = new OpenAI({
        baseURL: config.url,
        apiKey: config.apikey,
      });

      const completion = await openai.chat.completions.create({
        messages: [{
          role: "user",
          content: prompt
        }],
        model: config.module
      });
      
      return completion.choices[0]?.message?.content || '';
    } catch (error) {
      throw new Error(`DeepSeek API call failed: ${error}`);
    }
  }
}

// AI处理器工厂
class AIHandlerFactory {
  private static handlers: Record<SupportAI, AIHandler> = {
    [SupportAI.GLM]: new GLMHandler(),
    [SupportAI.DS]: new DSHandler()
  };

  static getHandler(aiType: SupportAI): AIHandler {
    const handler = this.handlers[aiType];
    if (!handler) {
      throw new Error(`不支持的AI类型: ${aiType}`);
    }
    return handler;
  }
}

// API响应接口
interface APIResponse {
  choices: Array<{
    message: {
      content: string;
    };
  }>;
}

// 调用AI翻译
async function callAI(ai: SupportAI, config: AIConfig, prompt: string): Promise<string> {
  try {
    const handler = AIHandlerFactory.getHandler(ai);
    return await handler.call(config, prompt);
  } catch (error) {
    throw new Error(`AI API call failed: ${error}`);
  }
}

// 翻译文本
export async function translateText(request: TranslationRequest): Promise<TranslationResponse> {
  try {
    const config = loadConfig();
    const ai = config.ai;
    const prompt = request.context!;

    const translatedText = await callAI(ai, config, prompt);

    // 验证翻译结果
    if (!translatedText || translatedText.trim().length === 0) {
      throw new Error('翻译结果为空');
    }

    return {
      success: true,
      translatedText
    };
  } catch (error) {
    return {
      success: false,
      error: `Translation failed: ${error}`
    };
  }
}

// 导出枚举供其他模块使用
export { SupportAI };

// 批量翻译文本对象
export async function translateTextObject(
  textObject: Record<string, any>,
  targetLanguage: string,
  context?: string
): Promise<Record<string, any>> {
  // 构建整组翻译的JSON字符串
  const jsonString = JSON.stringify(textObject, null, 2);

  // 构建整组翻译的提示词
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


  const response = await translateText({
    // text: jsonString,
    targetLanguage,
    context: groupContext
  });

  if (!response.success || !response.translatedText) {
    throw new Error(`整组翻译失败: ${response.error}`);
  }

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

    const translatedObject = JSON.parse(cleanText);

    return translatedObject;

  } catch (parseError) {
    console.error('JSON解析失败:', parseError);
    return textObject; // 解析失败时返回原始对象
  }
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
