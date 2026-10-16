# 生产入口架构与运维（IPv4 + HTTPS）

> 2026-10-16 上线。应用与数据仍在 `temp`（家庭网络，仅有公网 IPv6）；公网 IPv4 入口、
> TLS 终止放在 `lcz`（Azure 东京），两者之间走 frp 反向隧道。

## 1. 架构

```
Internet ── IPv4 :443 ──▶ lcz 20.89.19.232 (Azure Tokyo)
                          │  nginx 1.24：TLS 终止（Let's Encrypt）
                          │  X-Forwarded-For = 真实客户端 IP（覆盖清洗）
                          │  X-Forwarded-Proto = https
                          ▼
                       127.0.0.1:18080 (frps 隧道出口)
                          ▲
                          │  frp 隧道：temp 主动外连 lcz:7000（token + TLS）
                          │  不依赖 temp 的公网 IPv6，也不开 temp 入站端口
                          ▼
temp (家庭网络 192.168.31.88)
  frpc ──▶ 127.0.0.1:18080 ──▶ web 容器 nginx :80 ──▶ api:3000 ──▶ db/redis
```

- DNS（Cloudflare，DNS only/灰云）：`A teamup.20050917.xyz → 20.89.19.232`；**不要加 AAAA**。
- 跳转：`http://` → `301 https://`（含 ACME 放行路径 `/.well-known/acme-challenge/`）。
- 真实客户端 IP 链路：lcz nginx `$remote_addr` → 隧道原样透传 → temp nginx
  `$http_x_forwarded_for` 透传 → 后端 `trust proxy=1` 取到真实 IP（限流依赖）。
  ⚠️ 两侧任意一层若改回覆盖式 `$remote_addr`，限流会退化成全站共享桶（见 2026-10-13 事故）。

## 2. 组件清单

| 位置 | 组件 | 说明 |
| --- | --- | --- |
| lcz | nginx | `/etc/nginx/sites-available/teamup.conf`（80 跳转 + 443 反代） |
| lcz | certbot | 证书 `/etc/letsencrypt/live/teamup.20050917.xyz/`，续期 hook `renewal-hooks/deploy/reload-nginx.sh` |
| lcz | frps 0.71.1 | `/etc/frp/frps.toml`（600），`/usr/local/bin/frps`，systemd `frps` |
| lcz | frp 面板 | `127.0.0.1:7500`（仅环回）：`ssh -L 7500:127.0.0.1:7500 lcz` |
| temp | frpc 0.71.1 | `/etc/frp/frpc.toml`（600），`/usr/local/bin/frpc`，systemd `frpc` |
| temp | web 端口 | compose 中绑 `127.0.0.1:18080:80`（公网不可直连） |
| temp | 应用 | `/root/teamup-src`，`docker compose -f deploy/docker-compose.yml` |

隧道控制口 `lcz:7000` 对公网开放，靠 256 位随机 token + TLS 保护；业务口 18080 只绑环回。

## 3. 上线步骤（复现用）

```bash
# ---- lcz ----
sudo apt install -y nginx certbot
curl -fL https://github.com/fatedier/frp/releases/download/v0.71.1/frp_0.71.1_linux_amd64.tar.gz | sudo tar xz -C /tmp
sudo install /tmp/frp_0.71.1_linux_amd64/frps /usr/local/bin/frps
sudo cp <frps.toml> /etc/frp/frps.toml && sudo chmod 600 /etc/frp/frps.toml
sudo systemctl enable --now frps
sudo nginx -t && sudo systemctl reload nginx

# ---- temp ----
sudo install /tmp/frp_0.71.1_linux_amd64/frpc /usr/local/bin/frpc
sudo cp <frpc.toml> /etc/frp/frpc.toml && sudo chmod 600 /etc/frp/frpc.toml
sudo systemctl enable --now frpc
# deploy/docker-compose.yml 已含 127.0.0.1:18080:80；deploy/.env 设 WEB_ORIGIN / COOKIE_SECURE

# ---- DNS 切到 lcz 后签证书 ----
sudo mkdir -p /var/www/certbot
sudo certbot certonly --webroot -w /var/www/certbot -d teamup.20050917.xyz \
  --email <邮箱> --agree-tos --no-eff-email
```

证书 90 天有效，`certbot.timer` 自动续期并在 deploy hook 里 `systemctl reload nginx`；
上线/续期可用 `sudo certbot renew --dry-run` 演练。

## 4. 日常运维

```bash
# 状态
ssh temp 'systemctl status frpc; cd /root/teamup-src && docker compose -f deploy/docker-compose.yml ps'
ssh lcz  'systemctl status frps nginx; sudo ss -tlnp | grep -E ":(80|443|7000|18080)"'

# 日志
ssh temp 'journalctl -u frpc -f'                        # 隧道
ssh temp 'cd /root/teamup-src && docker compose -f deploy/docker-compose.yml logs -f web api'
ssh lcz  'sudo journalctl -u frps -f; sudo tail -f /var/log/nginx/access.log'

# 更新应用（只重建 web/api，不影响 db/redis 数据）
ssh temp 'cd /root/teamup-src && git pull && docker compose -f deploy/docker-compose.yml up -d --build web api'
```

## 5. 故障排查

| 现象 | 排查顺序 |
| --- | --- |
| 全站 502/超时 | ① `lcz: curl -H 'Host: teamup.20050917.xyz' http://127.0.0.1:18080/` ② `systemctl status frpc/frps` ③ `ss -tlnp \| grep 18080` 两侧是否都在 |
| 登录失效 / cookie 收不到 | 确认 `deploy/.env` 的 `COOKIE_SECURE=true` 与全站 HTTPS 一致；直接 IP 访问不再是有效入口 |
| 限流把所有人当同一 IP | 检查两侧 nginx 是否维持 XFF 透传（见 §1 警告）与 `deploy/.env` 的 `WEB_ORIGIN` |
| 证书告警 | `ssh lcz 'sudo certbot certificates'`；80 端口 ACME 路径是否可达 |
| 家庭网络重启后不可用 | frpc/frps 均 `Restart=always`，确认 temp 能出网访问 `20.89.19.232:7000` |

## 6. 回滚

```bash
# 1) Cloudflare：恢复 AAAA → temp 的 IPv6（若仍有公网 v6），删除 A
# 2) temp：
ssh temp 'cd /root/teamup-src/deploy && \
  cp .env.bak-cutover-<TS> .env && cp nginx.conf.bak-cutover-<TS> nginx.conf && \
  cp docker-compose.yml.bak-cutover-<TS> docker-compose.yml && \
  sed -i "s/localPort = 18080/localPort = 80/" /etc/frp/frpc.toml && \
  cd .. && docker compose -f deploy/docker-compose.yml up -d web api && systemctl restart frpc'
# 3) lcz：sudo systemctl stop frps nginx
```

数据库、Redis、应用数据全程未改动，回滚无数据风险。
