import { readFileSync, writeFileSync, existsSync, mkdirSync, readdir } from 'fs';
import { resolve } from 'path';
import { deleteFieldByPath } from './diff.js';

// 语言文件信息接口
export interface LanguageFile {
  code: string;
  path: string;
  exists: boolean;
}

// 分组接口
export interface GroupedContent {
  [groupName: string]: Record<string, string>;
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

// 分组
export function groupEnContent(enFilePath: string): GroupedContent {
  const enData = readJsonFile(enFilePath);
  const groupedContent: GroupedContent = {};

  for (const [key, value] of Object.entries(enData)) {
    if (typeof value === 'object' && value !== null) {
      // 如果是对象，直接作为一个组
      groupedContent[key] = value as Record<string, string>;
    } else {
      // 如果是字符串，创建一个默认组
      if (!groupedContent.default) {
        groupedContent.default = {};
      }
      groupedContent.default[key] = value as string;
    }
  }

  return groupedContent;
}

// 读取现有语言文件然后分组
export function groupExistingContent(languageFilePath: string): GroupedContent {
  const data = readJsonFile(languageFilePath);
  const groupedContent: GroupedContent = {};

  for (const [key, value] of Object.entries(data)) {
    if (typeof value === 'object' && value !== null) {
      groupedContent[key] = value as Record<string, string>;
    } else {
      if (!groupedContent.default) {
        groupedContent.default = {};
      }
      groupedContent.default[key] = value as string;
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
      Object.assign(mergedContent, groupData);
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
      existingGroupedContent[groupName] = { ...newGroupData };
    } else {
      // 检查组内容是否发生了结构性变化
      const existingKeys = Object.keys(existingGroupedContent[groupName]);
      const newKeys = Object.keys(newGroupData);
      
      // 如果新键的数量与现有键不同，或者有键不匹配，说明有结构性变化
      // 这种情况下，完全替换整个组
      if (existingKeys.length !== newKeys.length ||
          !existingKeys.every(key => newKeys.includes(key))) {
        existingGroupedContent[groupName] = { ...newGroupData };
      } else {
        // 否则，只合并新增或修改的键
        Object.assign(existingGroupedContent[groupName], newGroupData);
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