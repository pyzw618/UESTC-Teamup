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

export function TransformBoolean() {
  return Transform(({ value }) => {
    if (value == null || value === '') return undefined;
    if (typeof value === 'boolean') return value;
    return value === 'true' || value === '1';
  });
}
