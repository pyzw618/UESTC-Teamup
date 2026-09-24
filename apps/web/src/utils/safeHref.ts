/**
 * M1（纵深防御）：`:href` 绑定的外部链接只放行 http(s) 协议。
 *
 * 竞赛的 officialUrl / sourceUrl / materials.url 均来自采集与人工录入，
 * 若库里混入 `javascript:alert(1)` 这类值，直接绑到 href 就形成 XSS 注入点。
 * 这里统一做协议白名单：解析失败或非 http(s) 一律返回 '#'。
 */
export function safeHref(url: string | null | undefined): string {
  if (!url) return '#';
  try {
    const parsed = new URL(url, window.location.origin);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? url : '#';
  } catch {
    return '#';
  }
}

/** 与 safeHref 配套：判断链接是否可用（用于 v-if 隐藏无效链接） */
export function isSafeHref(url: string | null | undefined): boolean {
  return safeHref(url) !== '#';
}

/**
 * 来源链接的展示文本：去掉协议与路径，只留域名。
 * 非法链接返回空串，避免渲染出 "javascript:…" 这样的误导文本。
 */
export function hrefHost(url: string | null | undefined): string {
  if (safeHref(url) === '#') return '';
  return String(url).replace(/^https?:\/\//, '').split('/')[0];
}