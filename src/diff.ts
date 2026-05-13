import { readJsonFile, saveJsonFile, backupFile } from './file-processor.js';
import type { JSONObject, JSONValue, DiffResult } from './types.js';

// 简单比较两个对象的差异（只比较顶层键）
const diff = (oldObj: JSONObject, newObj: JSONObject): DiffResult => {
    const result: DiffResult = {
        missing: [],
        added: [],
        changed: []
    };

    for (const key in oldObj) {
        if (!(key in newObj)) {
            result.missing.push(key);
            continue;
        }

        const oldVal = oldObj[key];
        const newVal = newObj[key];

        if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
            result.changed.push(key);
        }
    }

    for (const key in newObj) {
        if (!(key in oldObj)) {
            result.added.push(key);
        }
    }

    return result;
};

// 从对象中删除指定的键
function removeKeys(obj: JSONObject, keysToRemove: string[]): JSONObject {
    const result = { ...obj };
    keysToRemove.forEach(key => {
        if (key in result) {
            delete result[key];
        }
    });
    return result;
}

// 获取需要翻译的内容
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

// 处理文件差异
export function processLanguageFiles(
    enOldPath: string,
    enNewPath: string,
    languageFiles: string[],
    backupDir: string = './backups'
): { translatableContent: JSONObject; success: boolean } {
    try {
        const enOld = readJsonFile(enOldPath);
        const enNew = readJsonFile(enNewPath);
        
        const diffResult = diff(enOld, enNew);
        
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupPath = `${backupDir}/en_old_${timestamp}.json`;
        backupFile(enOldPath, backupPath);
        
        const translatableContent = getTranslatableContent(enNew, diffResult);
        
        languageFiles.forEach(langFile => {
            if (langFile === enNewPath) return;
            
            const langData = readJsonFile(langFile);
            const updatedLangData = removeKeys(langData, diffResult.missing);
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

// 文件差异比较函数
export function simpleDiff(
    oldFilePath: string,
    newFilePath: string
): DiffResult {
    const oldObj = readJsonFile(oldFilePath);
    const newObj = readJsonFile(newFilePath);
    return diff(oldObj, newObj);
}

// 从对象中删除指定路径的字段
export function deleteFieldByPath(
    obj: any,
    path: string[]
): boolean {
    if (path.length === 0) return false;
    
    let current: any = obj;
    
    for (let i = 0; i < path.length - 1; i++) {
        const key = path[i];
        if (key === undefined || !current[key] || typeof current[key] !== 'object') {
            return false;
        }
        current = current[key];
    }
    
    const lastKey = path[path.length - 1];
    if (lastKey !== undefined && typeof lastKey === 'string' && lastKey in current) {
        delete current[lastKey];
        return true;
    }
    
    return false;
}

export type { JSONObject, JSONValue, DiffResult };
export { diff, removeKeys, getTranslatableContent };
