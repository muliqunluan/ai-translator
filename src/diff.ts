import { readFileSync, writeFileSync, existsSync } from 'fs';

// 简化的JSON类型定义
type JSONValue = string | number | boolean | null | JSONObject | JSONArray;
interface JSONObject { [key: string]: JSONValue; }
interface JSONArray extends Array<JSONValue> { }

// 简化的差异结果接口
interface DiffResult {
    missing: string[];
    added: string[];
    changed: string[];
}

/**
 * 简单比较两个对象的差异（只比较顶层键）
 */
const diff = (oldObj: JSONObject, newObj: JSONObject): DiffResult => {
    const result: DiffResult = {
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
};

/**
 * 读取JSON文件
 */
function readJsonFile(filePath: string): JSONObject {
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
function saveJsonFile(filePath: string, data: JSONObject): void {
    try {
        const content = JSON.stringify(data, null, 2);
        writeFileSync(filePath, content, 'utf-8');
    } catch (error) {
        console.error(`保存文件失败 ${filePath}: ${error}`);
    }
}

/**
 * 备份文件
 */
function backupFile(filePath: string, backupPath: string): boolean {
    try {
        const data = readJsonFile(filePath);
        saveJsonFile(backupPath, data);
        return true;
    } catch (error) {
        console.error(`备份文件失败: ${error}`);
        return false;
    }
}

/**
 * 从对象中删除指定的键
 */
function removeKeys(obj: JSONObject, keysToRemove: string[]): JSONObject {
    const result = { ...obj };
    keysToRemove.forEach(key => {
        if (key in result) {
            delete result[key];
        }
    });
    return result;
}

/**
 * 获取需要翻译的内容
 */
function getTranslatableContent(
    newObj: JSONObject,
    diffResult: DiffResult
): JSONObject {
    const result: JSONObject = {};
    
    // 添加新增的字段
    diffResult.added.forEach(key => {
        if (key in newObj && newObj[key] !== undefined) {
            result[key] = newObj[key] as JSONValue;
        }
    });
    
    // 添加修改的字段
    diffResult.changed.forEach(key => {
        if (key in newObj && newObj[key] !== undefined) {
            result[key] = newObj[key] as JSONValue;
        }
    });
    
    return result;
}

/**
 * 处理语言文件差异
 */
export function processLanguageFiles(
    enOldPath: string,
    enNewPath: string,
    languageFiles: string[],
    backupDir: string = './backups'
): { translatableContent: JSONObject; success: boolean } {
    try {
        // 读取英文文件
        const enOld = readJsonFile(enOldPath);
        const enNew = readJsonFile(enNewPath);
        
        // 计算差异
        const diffResult = diff(enOld, enNew);
        
        // 备份旧的英文文件
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupPath = `${backupDir}/en_old_${timestamp}.json`;
        backupFile(enOldPath, backupPath);
        
        // 获取需要翻译的内容
        const translatableContent = getTranslatableContent(enNew, diffResult);
        
        // 处理其他语言文件
        languageFiles.forEach(langFile => {
            if (langFile === enNewPath) return; // 跳过英文文件
            
            const langData = readJsonFile(langFile);
            
            // 移除缺失的字段
            const updatedLangData = removeKeys(langData, diffResult.missing);
            
            // 保存更新后的语言文件
            saveJsonFile(langFile, updatedLangData);
            
            console.log(`已更新语言文件: ${langFile}`);
        });
        
        console.log('差异处理完成');
        console.log(`缺失字段: ${diffResult.missing.join(', ')}`);
        console.log(`新增字段: ${diffResult.added.join(', ')}`);
        console.log(`修改字段: ${diffResult.changed.join(', ')}`);
        
        return { translatableContent, success: true };
    } catch (error) {
        console.error(`处理语言文件失败: ${error}`);
        return { translatableContent: {}, success: false };
    }
}

/**
 * 简单的文件差异比较函数
 */
export function simpleDiff(
    oldFilePath: string,
    newFilePath: string
): DiffResult {
    const oldObj = readJsonFile(oldFilePath);
    const newObj = readJsonFile(newFilePath);
    return diff(oldObj, newObj);
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

// 导出类型和函数供外部使用
export type { JSONValue, JSONObject, JSONArray, DiffResult };
export { diff, readJsonFile, saveJsonFile, backupFile, removeKeys, getTranslatableContent };