import { Transform } from 'class-transformer';

/**
 * 查询字符串里的数组参数：支持逗号分隔（a,b）、单值（a）、JSON 数组（["a"]）
 * 配合 enableImplicitConversion 使用
 */
export function TransformStringArray() {
  return Transform(({ value }) => {
    if (value == null) return undefined;
    if (Array.isArray(value)) return value;
    if (typeof value === 'string') {
      const s = value.trim();
      if (s.startsWith('[')) {
        try {
          const parsed = JSON.parse(s);
          return Array.isArray(parsed) ? parsed : [s];
        } catch {
          /* fallthrough */
        }
      }
      return s
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean);
    }
    return [value];
  });
}

/** 查询字符串数字兜底 */
export function TransformNumber() {
  return Transform(({ value }) => (value == null || value === '' ? undefined : Number(value)));
}

/**
 * 查询字符串布尔兜底：true/1 → true，其余 → false。
 *
 * 陷阱：全局 ValidationPipe 开着 enableImplicitConversion，class-transformer 会**先**按
 * `design:type` 做一次隐式转换再调用本回调。若字段声明为 `boolean`，字符串 "false"/"0"
 * 会在进入回调前就被 `Boolean("false")` 变成 `true`，回调拿到的已是污染值。
 * 因此这里优先从原始 plain object（`obj[key]`）读取未转换的值，保证声明成 `boolean`
 * 或 `any` 行为一致。
 */
export function TransformBoolean() {
  return Transform(({ value, obj, key }) => {
    const rawSource = obj && typeof obj === 'object' ? (obj as Record<string, unknown>)[key] : value;
    // 重复查询参数（?x=true&x=false）在 Express 中会变成数组，取最后一个为准
    const raw = Array.isArray(rawSource) ? rawSource[rawSource.length - 1] : rawSource;
    if (raw == null || raw === '') return undefined;
    if (typeof raw === 'boolean') return raw;
    return raw === 'true' || raw === '1';
  });
}
