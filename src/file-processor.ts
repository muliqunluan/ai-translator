import { readFileSync, writeFileSync, existsSync, mkdirSync, readdir } from 'fs';
import { resolve } from 'path';
import { deleteFieldByPath } from './diff.js';

// 语言文件信息接口
export interface LanguageFile {
  code: string;
  path: string;
  exists: boolean;
}

// 分组接口 - 支持嵌套对象和数组
export type NestedValue = string | Record<string, any> | any[];
export interface GroupedContent {
  [groupName: string]: NestedValue;
}


// 获取 workspace 文件夹下的所有语言文件
export async function getLanguageFiles(workspaceDir: string = 'workspace'): Promise<LanguageFile[]> {
  try {
    const fullPath = resolve(process.cwd(), workspaceDir);
    
    // 确保目录存在
    if (!existsSync(fullPath)) {
      console.error(`消息目录不存在: ${fullPath}`);
      return [];
    }

    const files = await new Promise<string[]>((resolve, reject) => {
      readdir(fullPath, (err: any, files: string[]) => {
        if (err) reject(err);
        else resolve(files);
      });
    });

    const languageFiles: LanguageFile[] = [];
    
    for (const file of files) {
      if (file.endsWith('.json')) {
        const code = file.replace('.json', '');
        const filePath = resolve(fullPath, file);
        const exists = existsSync(filePath);
        
        languageFiles.push({
          code,
          path: filePath,
          exists
        });
      }
    }

    // 排序：en.json排在最前面，其他按字母顺序
    languageFiles.sort((a, b) => {
      if (a.code === 'en') return -1;
      if (b.code === 'en') return 1;
      return a.code.localeCompare(b.code);
    });

    return languageFiles;
  } catch (error) {
    console.error(`获取语言文件失败: ${error}`);
    return [];
  }
}

// 获取需要翻译的目标语言列表（排除en）
export function getTargetLanguages(languageFiles: LanguageFile[]): string[] {
  return languageFiles
    .filter(file => file.code !== 'en')
    .map(file => file.code);
}

// 读取JSON文件
function readJsonFile(filePath: string): any {
  try {
    if (!existsSync(filePath)) {
      return {};
    }
    const content = readFileSync(filePath, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    console.error(`读取文件失败 ${filePath}: ${error}`);
    return {};
  }
}

// 保存JSON文件
function saveJsonFile(filePath: string, data: any): void {
  try {
    // 确保目录存在
    const dir = resolve(filePath, '..');
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    const content = JSON.stringify(data, null, 2);
    writeFileSync(filePath, content, 'utf-8');
  } catch (error) {
    console.error(`保存文件失败 ${filePath}: ${error}`);
  }
}

// 检测是否为简单JSON文件（只有一层键值对，所有值都是基本类型）
export function isSimpleJson(data: any): boolean {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return false;
  }
  
  for (const value of Object.values(data)) {
    // 如果任何值是对象或数组，就不是简单JSON
    if (typeof value === 'object' && value !== null) {
      return false;
    }
  }
  
  return true;
}

// 按行分组简单JSON文件
export function groupSimpleJsonByLines(data: Record<string, any>, linesPerGroup: number = 20): GroupedContent {
  const groupedContent: GroupedContent = {};
  const entries = Object.entries(data);
  const totalGroups = Math.ceil(entries.length / linesPerGroup);
  
  for (let i = 0; i < totalGroups; i++) {
    const start = i * linesPerGroup;
    const end = Math.min(start + linesPerGroup, entries.length);
    const groupEntries = entries.slice(start, end);
    const groupName = `lines_${i + 1}`;
    
    groupedContent[groupName] = Object.fromEntries(groupEntries);
  }
  
  return groupedContent;
}

// 分组
export function groupEnContent(enFilePath: string, useLineGrouping: boolean = true, linesPerGroup: number = 20): GroupedContent {
  const enData = readJsonFile(enFilePath);
  const groupedContent: GroupedContent = {};

  // 如果是简单JSON且启用行分组，使用新的分组方法
  if (useLineGrouping && isSimpleJson(enData)) {
    return groupSimpleJsonByLines(enData, linesPerGroup);
  }

  // 否则使用原来的分组逻辑
  for (const [key, value] of Object.entries(enData)) {
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      // 如果是对象，直接作为一个组，保持完整的嵌套结构
      groupedContent[key] = value;
    } else if (Array.isArray(value)) {
      // 如果是数组，也作为一个组，保持数组结构
      groupedContent[key] = value;
    } else {
      // 如果是字符串，创建一个默认组
      if (!groupedContent.default) {
        groupedContent.default = {};
      }
      (groupedContent.default as Record<string, string>)[key] = value as string;
    }
  }

  return groupedContent;
}

// 读取现有语言文件然后分组
export function groupExistingContent(languageFilePath: string): GroupedContent {
  const data = readJsonFile(languageFilePath);
  const groupedContent: GroupedContent = {};

  // 检查是否为简单JSON结构（包含lines_组）
  const hasLinesGroups = Object.keys(data).some(key => key.startsWith('lines_'));
  
  if (hasLinesGroups) {
    // 如果是lines_组结构，将所有lines_组的内容合并到default组
    const defaultGroup: Record<string, string> = {};
    
    for (const [key, value] of Object.entries(data)) {
      if (key.startsWith('lines_')) {
        // 合并lines_组的内容
        if (typeof value === 'object' && value !== null) {
          Object.assign(defaultGroup, value);
        }
      } else if (typeof value === 'object' && value !== null) {
        // 其他对象类型保持原样
        groupedContent[key] = value;
      } else {
        // 基本类型值
        defaultGroup[key] = value as string;
      }
    }
    
    // 如果有default组内容，添加到groupedContent
    if (Object.keys(defaultGroup).length > 0) {
      groupedContent.default = defaultGroup;
    }
  } else {
    // 原始逻辑：处理普通结构
    for (const [key, value] of Object.entries(data)) {
      if (typeof value === 'object' && value !== null) {
        groupedContent[key] = value;
      } else {
        if (!groupedContent.default) {
          groupedContent.default = {};
        }
        (groupedContent.default as Record<string, string>)[key] = value as string;
      }
    }
  }

  return groupedContent;
}

// 合并分组
export function mergeGroupedContent(groupedContent: GroupedContent): Record<string, any> {
  const mergedContent: Record<string, any> = {};

  for (const [groupName, groupData] of Object.entries(groupedContent)) {
    if (groupName === 'default') {
      // 将default组的内容合并到顶级
      if (typeof groupData === 'object' && groupData !== null) {
        Object.assign(mergedContent, groupData);
      }
    } else if (groupName.startsWith('lines_')) {
      // 如果是lines_组，将其内容合并到顶级（用于简单JSON文件）
      if (typeof groupData === 'object' && groupData !== null) {
        Object.assign(mergedContent, groupData);
      }
    } else {
      // 其他组作为嵌套对象
      mergedContent[groupName] = groupData;
    }
  }

  return mergedContent;
}

// 更新语言文件
export function updateLanguageFile(
  languageFilePath: string,
  newGroupedContent: GroupedContent
): void {
  // 读取现有内容
  const existingGroupedContent = groupExistingContent(languageFilePath);
  
  // 合并新内容到现有内容
  for (const [groupName, newGroupData] of Object.entries(newGroupedContent)) {
    if (!existingGroupedContent[groupName]) {
      // 如果组不存在，直接创建
      existingGroupedContent[groupName] = newGroupData;
    } else {
      // 检查组内容是否发生了结构性变化
      const existingData = existingGroupedContent[groupName];
      const newData = newGroupData;
      
      // 如果两者都是对象，进行合并
      if (typeof existingData === 'object' && existingData !== null &&
          typeof newData === 'object' && newData !== null) {
        // 始终合并（Object.assign），保留现有键，添加/更新新键
        // 避免增量更新时因 key 数量不匹配而误替换整个组
        Object.assign(existingGroupedContent[groupName] as Record<string, any>, newData);
      } else {
        // 如果类型不匹配，直接替换
        existingGroupedContent[groupName] = newData;
      }
    }
  }
  
  // 保存更新后的内容
  const mergedContent = mergeGroupedContent(existingGroupedContent);
  saveJsonFile(languageFilePath, mergedContent);
}

// 确保 temp 文件存在
export function ensureTempDirectory(tempDir: string = 'workspace/temp'): void {
  const fullPath = resolve(process.cwd(), tempDir);
  if (!existsSync(fullPath)) {
    mkdirSync(fullPath, { recursive: true });
  }
}

// 验证语言文件结构
export function validateLanguageStructure(
  enFilePath: string,
  languageFilePath: string
): { isValid: boolean; issues: string[] } {
  const enData = readJsonFile(enFilePath);
  const langData = readJsonFile(languageFilePath);
  const issues: string[] = [];

  // 检查顶级键是否匹配
  const enKeys = Object.keys(enData);
  const langKeys = Object.keys(langData);

  for (const key of enKeys) {
    if (!langKeys.includes(key)) {
      issues.push(`缺少顶级键: ${key}`);
    } else if (typeof enData[key] === 'object' && typeof langData[key] === 'object') {
      // 检查嵌套对象的键
      const enSubKeys = Object.keys(enData[key]);
      const langSubKeys = Object.keys(langData[key]);
      
      for (const subKey of enSubKeys) {
        if (!langSubKeys.includes(subKey)) {
          issues.push(`缺少嵌套键: ${key}.${subKey}`);
        }
      }
    }
  }

  return {
    isValid: issues.length === 0,
    issues
  };
}

// 从语言文件中删除指定路径的字段
export function deleteFieldFromLanguageFile(
  languageFilePath: string,
  path: string[]
): boolean {
  try {
    const data = readJsonFile(languageFilePath);
    const deleted = deleteFieldByPath(data, path);
    
    if (deleted) {
      saveJsonFile(languageFilePath, data);
      return true;
    }
    
    return false;
  } catch (error) {
    console.error(`从语言文件删除字段失败 ${languageFilePath}: ${error}`);
    return false;
  }
}


// 从所有语言文件中同步删除指定路径的字段
export function syncDeleteFieldsFromAllLanguages(
  languageFiles: LanguageFile[],
  deletedFields: Array<{ path: string[]; key: string }>
): { success: boolean; results: Array<{ language: string; success: boolean; field: string }> } {
  const results: Array<{ language: string; success: boolean; field: string }> = [];
  let overallSuccess = true;
  
  // 排除 en.json，因为它是源文件
  const targetLanguageFiles = languageFiles.filter(file => file.code !== 'en');
  
  for (const langFile of targetLanguageFiles) {
    for (const deletedField of deletedFields) {
      const success = deleteFieldFromLanguageFile(langFile.path, deletedField.path);
      results.push({
        language: langFile.code,
        success,
        field: deletedField.key
      });
      
      if (!success) {
        overallSuccess = false;
      }
    }
  }
  
  return {
    success: overallSuccess,
    results
  };
}