import { readFileSync, writeFileSync, existsSync } from 'fs';

// JSON值类型定义
type JSONValue = string | number | boolean | null | JSONObject | JSONArray;
interface JSONObject { [key: string]: JSONValue; }
interface JSONArray extends Array<JSONValue> {}

// 差异类型
export type DiffType = 'added' | 'modified' | 'deleted' | 'unchanged';

// 差异项接口
export interface DiffItem {
  key: string;
  type: DiffType;
  oldValue?: string;
  newValue?: string;
  path: string[]; // 嵌套路径，如 ['common', 'loading']
}

// 差异结果接口
export interface DiffResult {
  hasChanges: boolean;
  changes: DiffItem[];
  addedCount: number;
  modifiedCount: number;
  deletedCount: number;
}

// 简单的差异结果接口（用于顶层比较）
interface SimpleDiffResult {
  missing: string[];
  added: string[];
  changed: string[];
}

/**
 * 简单比较两个JSON对象
 * 使用JSON.stringify进行整体比较，更高效但不够精确
 */
function simpleDiff(oldObj: JSONObject, newObj: JSONObject): SimpleDiffResult {
  const result: SimpleDiffResult = {
    missing: [],
    added: [],
    changed: []
  };

  // 遍历 oldObj：检查缺失和修改
  for (const key in oldObj) {
    if (!(key in newObj)) {
      result.missing.push(key);
      continue;
    }

    const oldVal = oldObj[key];
    const newVal = newObj[key];

    // 只要内容不完全一样，就视为 changed（整体更新）
    if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
      result.changed.push(key);
    }
  }

  // 遍历 newObj：检查新增
  for (const key in newObj) {
    if (!(key in oldObj)) {
      result.added.push(key);
    }
  }

  return result;
}

/**
 * 深度比较两个对象（保留原有逻辑，用于需要精确比较的场景）
 */
function deepCompare(
  obj1: any,
  obj2: any,
  path: string[] = []
): DiffItem[] {
  const changes: DiffItem[] = [];
  const allKeys = new Set([...Object.keys(obj1 || {}), ...Object.keys(obj2 || {})]);

  for (const key of allKeys) {
    const currentPath = [...path, key];
    const pathString = currentPath.join('.');
    const value1 = obj1?.[key];
    const value2 = obj2?.[key];

    // 检查键是否存在
    if (!(key in obj1)) {
      changes.push({
        key: pathString,
        type: 'added',
        newValue: value2,
        path: currentPath
      });
    } else if (!(key in obj2)) {
      changes.push({
        key: pathString,
        type: 'deleted',
        oldValue: value1,
        path: currentPath
      });
    } else if (typeof value1 !== typeof value2) {
      changes.push({
        key: pathString,
        type: 'modified',
        oldValue: value1,
        newValue: value2,
        path: currentPath
      });
    } else if (typeof value1 === 'object' && value1 !== null && value2 !== null) {
      // 对于对象，使用简单比较方法
      if (JSON.stringify(value1) !== JSON.stringify(value2)) {
        // 如果对象内容不同，将整个对象标记为修改
        changes.push({
          key: pathString,
          type: 'modified',
          oldValue: value1,
          newValue: value2,
          path: currentPath
        });
      }
    } else if (value1 !== value2) {
      changes.push({
        key: pathString,
        type: 'modified',
        oldValue: value1,
        newValue: value2,
        path: currentPath
      });
    }
    // 如果值相等，则不需要记录（unchanged）
  }

  return changes;
}

/**
 * 读取JSON文件
 */
export function readJsonFile(filePath: string): any {
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

/**
 * 保存JSON文件
 */
export function saveJsonFile(filePath: string, data: any): void {
  try {
    const content = JSON.stringify(data, null, 2);
    writeFileSync(filePath, content, 'utf-8');
  } catch (error) {
    console.error(`保存文件失败 ${filePath}: ${error}`);
  }
}

/**
 * 比较两个JSON文件的差异
 */
export function compareJsonFiles(
  currentFilePath: string,
  oldFilePath: string
): DiffResult {
  const currentData = readJsonFile(currentFilePath);
  const oldData = readJsonFile(oldFilePath);

  // 检查是否为空文件情况
  const isOldEmpty = Object.keys(oldData).length === 0;
  const isCurrentEmpty = Object.keys(currentData).length === 0;
  
  // 检查旧文件是否只包含部分内容（如只有common和form组）
  const oldKeys = Object.keys(oldData);
  const currentKeys = Object.keys(currentData);
  const isOldPartial = oldKeys.length > 0 && oldKeys.length < currentKeys.length &&
    oldKeys.every(key => currentKeys.includes(key));

  let changes: DiffItem[];
  
  if (isOldEmpty && !isCurrentEmpty) {
    // 特殊情况：旧文件为空，新文件有内容
    // 将所有当前内容标记为新增
    // 特殊情况：新文件为空，旧文件有内容
    // 将所有旧内容标记为删除
    changes = [];
    const flattenObject = (obj: any, prefix: string = ''): DiffItem[] => {
      const result: DiffItem[] = [];
      for (const [key, value] of Object.entries(obj)) {
        const fullKey = prefix ? `${prefix}.${key}` : key;
        if (typeof value === 'object' && value !== null) {
          result.push(...flattenObject(value, fullKey));
        } else {
          result.push({
            key: fullKey,
            type: 'deleted',
            oldValue: value as string,
            path: fullKey.split('.')
          });
        }
      }
      return result;
    };
    changes = flattenObject(oldData);
  } else {
    // 正常比较
    changes = deepCompare(currentData, oldData);
  }

  const addedCount = changes.filter(c => c.type === 'added').length;
  const modifiedCount = changes.filter(c => c.type === 'modified').length;
  const deletedCount = changes.filter(c => c.type === 'deleted').length;

  return {
    hasChanges: changes.length > 0,
    changes,
    addedCount,
    modifiedCount,
    deletedCount
  };
}

/**
 * 备份当前文件到历史版本
 */
export function backupCurrentFile(
  currentFilePath: string,
  backupFilePath: string
): boolean {
  try {
    const currentData = readJsonFile(currentFilePath);
    saveJsonFile(backupFilePath, currentData);
    return true;
  } catch (error) {
    console.error(`备份文件失败: ${error}`);
    return false;
  }
}

/**
 * 获取需要翻译的内容（新增和修改的项）
 */
export function getTranslatableContent(
  currentFilePath: string,
  oldFilePath: string
): Record<string, Record<string, string>> {
  const diff = compareJsonFiles(currentFilePath, oldFilePath);
  const currentData = readJsonFile(currentFilePath);
  
  // 按组分组需要翻译的内容
  const translatableContent: Record<string, Record<string, string>> = {};
  
  // 只处理新增和修改的项
  const translatableChanges = diff.changes.filter(
    change => change.type === 'added' || change.type === 'modified'
  );

  for (const change of translatableChanges) {
    if (change.path.length >= 2) {
      const groupName = change.path[0];
      const keyName = change.path[1];
      
      if (groupName && keyName) {
        if (!translatableContent[groupName]) {
          translatableContent[groupName] = {};
        }
        
        // 获取当前值
        const groupData = currentData[groupName];
        if (groupData && typeof groupData === 'object' && keyName in groupData) {
          translatableContent[groupName][keyName] = groupData[keyName];
        }
      }
    } else if (change.path.length === 1) {
      // 处理顶级键
      const groupName = change.path[0];
      if (groupName) {
        if (!translatableContent[groupName]) {
          translatableContent[groupName] = {};
        }
        
        if (currentData[groupName] && typeof currentData[groupName] === 'string') {
          translatableContent[groupName][groupName] = currentData[groupName];
        }
      }
    }
  }

  return translatableContent;
}

/**
 * 打印差异报告
 */
export function printDiffReport(diff: DiffResult): void {
  console.log('\n=== 文件差异报告 ===');
  
  if (!diff.hasChanges) {
    console.log('✅ 没有发现变化');
    return;
  }

  console.log(`📊 变化统计:`);
  console.log(`  - 新增: ${diff.addedCount} 项`);
  console.log(`  - 修改: ${diff.modifiedCount} 项`);
  console.log(`  - 删除: ${diff.deletedCount} 项`);
  console.log(`  - 总计: ${diff.changes.length} 项变化`);

  if (diff.addedCount > 0) {
    console.log('\n➕ 新增项:');
    diff.changes
      .filter(c => c.type === 'added')
      .forEach(c => {
        const value = typeof c.newValue === 'object' ? JSON.stringify(c.newValue) : c.newValue;
        console.log(`  + ${c.key}: "${value}"`);
      });
  }

  if (diff.modifiedCount > 0) {
    console.log('\n✏️ 修改项:');
    diff.changes
      .filter(c => c.type === 'modified')
      .forEach(c => {
        const oldValue = typeof c.oldValue === 'object' ? JSON.stringify(c.oldValue) : c.oldValue;
        const newValue = typeof c.newValue === 'object' ? JSON.stringify(c.newValue) : c.newValue;
        console.log(`  ~ ${c.key}: "${oldValue}" → "${newValue}"`);
      });
  }

  if (diff.deletedCount > 0) {
    console.log('\n➖ 删除项:');
    diff.changes
      .filter(c => c.type === 'deleted')
      .forEach(c => {
        const value = typeof c.oldValue === 'object' ? JSON.stringify(c.oldValue) : c.oldValue;
        console.log(`  - ${c.key}: "${value}"`);
      });
  }

  console.log('\n==================');
}

/**
 * 检查是否需要翻译
 */
export function needsTranslation(
  currentFilePath: string,
  oldFilePath: string
): boolean {
  const diff = compareJsonFiles(currentFilePath, oldFilePath);
  return diff.hasChanges && (diff.addedCount > 0 || diff.modifiedCount > 0);
}

/**
 * 获取被删除的字段路径
 */
export function getDeletedFields(
  currentFilePath: string,
  oldFilePath: string
): DiffItem[] {
  const diff = compareJsonFiles(currentFilePath, oldFilePath);
  return diff.changes.filter(change => change.type === 'deleted');
}

/**
 * 从对象中删除指定路径的字段
 */
export function deleteFieldByPath(
  obj: any,
  path: string[]
): boolean {
  if (path.length === 0) return false;
  
  let current: any = obj;
  
  // 导航到父对象
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i];
    if (key === undefined || !current[key] || typeof current[key] !== 'object') {
      return false; // 路径不存在
    }
    current = current[key];
  }
  
  // 删除最后一个键
  const lastKey = path[path.length - 1];
  if (lastKey !== undefined && typeof lastKey === 'string' && lastKey in current) {
    delete current[lastKey];
    return true;
  }
  
  return false;
}