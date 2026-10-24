# UESTC TeamUp · Android 壳应用

以 WebView 加载线上站点 <https://teamup.20050917.xyz/> 的轻量安卓壳，产物为可直接侧载安装的 APK。

## 功能边界

- 站内链接在应用内打开，Cookie 会话与手机浏览器一致（登录状态互通）
- 站外链接、`target=_blank`、`window.open`（日历 .ics 订阅、管理后台导出）交给系统浏览器处理
- 主框架加载失败时显示「网络连接失败 / 重试」页
- 返回键：优先回退网页历史，无历史时退出应用
- 预留文件上传通道（`onShowFileChooser`，当前站点无上传入口）
- 网站更新后应用自动呈现最新版，无需重新发 APK

## 构建

依赖（本机已配置，用户级环境变量）：

| 变量 | 值 |
| --- | --- |
| `JAVA_HOME` | `D:\android-dev\jdk-17.0.20.1+1` |
| `ANDROID_HOME` | `C:\Users\27190\AppData\Local\Android\Sdk`（联接 → `D:\android-dev\sdk`） |
| `PATH` 追加 | `%JAVA_HOME%\bin`、`D:\android-dev\gradle-8.9\bin` |

```bash
cd apps/android
gradlew.bat :app:assembleDebug     # 产物：app/build/outputs/apk/debug/app-debug.apk
```

> 注意：仓库路径含中文目录（`Desktop\项目`），**必须用 JDK 17 作为启动 JVM**（Java 8
> 启动器无法从含中文的 classpath 加载 gradle-wrapper.jar）。守护进程 JDK 通过用户级
> `~/.gradle/gradle.properties` 的 `org.gradle.java.home` 指定（本机已配置，不进仓库）；
> 启动 JVM 取决于 `JAVA_HOME`。依赖仓库已配置阿里云镜像（`settings.gradle.kts`），
> Gradle 发行版走腾讯镜像。

## 发布签名（release）

`signing.properties`（工程根目录，已 gitignore）：

```properties
storeFile=D:/path/to/release.keystore
storePassword=***
keyAlias=***
keyPassword=***
```

生成密钥库：

```bash
keytool -genkeypair -v -keystore release.keystore -alias teamup -keyalg RSA -keysize 2048 -validity 36500
```

之后 `gradlew.bat :app:assembleRelease` 产出已签名 APK。

## 图标

`scripts/make_icons.py` 从 `apps/web/public/brand/badge-512.png` 生成全部启动器图标
（传统 + 自适应前景，背景色 `#0f4c8c` = 站点 `--uestc-blue`）。改版重跑该脚本即可。
