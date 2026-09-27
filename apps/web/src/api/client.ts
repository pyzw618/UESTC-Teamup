/** 极简 fetch 封装：统一 { code, data, message, dev? } 信封与 Cookie 会话 */

export class ApiError extends Error {
  code: number;
  dev?: Record<string, unknown>;
  constructor(code: number, message: string, dev?: Record<string, unknown>) {
    super(message);
    this.code = code;
    this.dev = dev;
  }
}

/** 401 全局处理回调（由 stores/auth.ts 注册；client 不反向依赖 store/router，避免循环导入） */
type UnauthorizedHandler = (path: string) => void;
let unauthorizedHandler: UnauthorizedHandler | null = null;
export function setUnauthorizedHandler(fn: UnauthorizedHandler | null): void {
  unauthorizedHandler = fn;
}

/** 最近一次成功响应信封顶层的 dev 字段（如 dev 环境的验证码回显 dev.devCode）；生产环境为 undefined */
let lastDev: Record<string, unknown> | undefined;
export function lastDevPayload(): Record<string, unknown> | undefined {
  return lastDev;
}

/** 请求附加选项：silent401 = 401 时不触发全局跳登录（由调用方自行渲染登录引导，如公开名片的子区块） */
export interface RequestOptions {
  silent401?: boolean;
}

async function request<T>(path: string, options: RequestInit = {}, extra?: RequestOptions): Promise<T> {
  const res = await fetch(`/api${path}`, {
    credentials: 'include',
    headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
    ...options,
  });

  let body: { code: number; data: T; message?: string; dev?: Record<string, unknown> } | null = null;
  try {
    body = await res.json();
  } catch {
    /* 非 JSON 响应（如 ics）由专用函数处理 */
  }

  if (!res.ok || !body || body.code !== 0) {
    // 会话失效全局处理；排除 /auth/* 本身（游客 bootstrap /auth/me 与登录流程的 401 属正常业务，不应触发跳转）
    if (res.status === 401 && unauthorizedHandler && !path.startsWith('/auth/') && !extra?.silent401) {
      try {
        unauthorizedHandler(path);
      } catch {
        /* handler 异常不影响错误抛出 */
      }
    }
    throw new ApiError(body?.code ?? res.status, body?.message ?? `请求失败（${res.status}）`, body?.dev);
  }
  lastDev = body.dev;
  return body.data;
}

export const api = {
  get<T>(path: string, extra?: RequestOptions): Promise<T> {
    return request<T>(path, {}, extra);
  },
  post<T>(path: string, data?: unknown, extra?: RequestOptions): Promise<T> {
    return request<T>(path, { method: 'POST', body: data ? JSON.stringify(data) : undefined }, extra);
  },
  put<T>(path: string, data?: unknown, extra?: RequestOptions): Promise<T> {
    return request<T>(path, { method: 'PUT', body: data ? JSON.stringify(data) : undefined }, extra);
  },
  patch<T>(path: string, data?: unknown, extra?: RequestOptions): Promise<T> {
    return request<T>(path, { method: 'PATCH', body: data ? JSON.stringify(data) : undefined }, extra);
  },
  delete<T>(path: string, extra?: RequestOptions): Promise<T> {
    return request<T>(path, { method: 'DELETE' }, extra);
  },
};

export function qs(params: Record<string, unknown>): string {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    if (Array.isArray(v)) {
      if (v.length) search.set(k, v.join(',')); // 数组用逗号分隔，后端 TransformStringArray 解析
    } else {
      search.set(k, String(v));
    }
  }
  const s = search.toString();
  return s ? `?${s}` : '';
}
