# 0.4.4 历史记录：Electron 安装包与运行时体积

当前 0.5.0 已迁移到 Tauri，见 [新版本说明](RELEASE-0.5.0.md)。以下保留 0.4.4 的构建记录。

当时发布 0.4.4 提供原生安装包。已有设备控制、短信、AT 模板和持续监控继续使用同一份业务代码。

## 为什么 AppImage 超过 100 MB

0.4.3 的 `resources/app.asar` 约 316 KB，Electron 主程序解压后约 218 MB，整套运行时约 283 MB。AppImage 的大部分体积来自 Chromium、Node.js、字体/国际化资源和系统桥接。增加少量表单或调整界面框架对这部分没有明显影响。

本版提供两种运行时分发方式：

| 安装包 | 运行时来源 | 适用系统 |
| --- | --- | --- |
| `.pkg.tar.zst` | 依赖系统 `electron43`，只打包应用归档、启动器、图标和文档 | Arch / EndeavourOS；其他 Arch 衍生版需仓库有 electron43 |
| `.deb` | 自带 Electron 44.7.2 | Debian 12+、Ubuntu 22.04+、兼容 Linux Mint |
| `.rpm` | 自带 Electron 44.7.2 | Fedora，以及能满足依赖的兼容 RPM 发行版 |
| AppImage / tar.gz | 自带 Electron 44.7.2 | 便携运行，适合不使用本机包管理器时 |

Arch 小包是复用已安装的运行时；首次安装仍可能额外下载约百 MB 的 Electron 依赖。该依赖由多个 Electron 应用共享，不能把小安装包等同于应用总内存或首次下载体积。

安装、卸载命令见 [安装说明](../packaging/INSTALL.md)。`release/package-sizes.json` 给出本次实际产物的字节数，最终验证见 `artifacts/validation-0.4.4.json`。

## 构建

```sh
npm ci
npm run dist
```

完整构建首先生成便携包，再调用 `scripts/build-linux-packages.cjs` 生成 Arch / DEB / RPM。只生成可安装包：

```sh
npm run dist:packages
```

已有与源码一致的 `release/linux-unpacked` 时，也可直接运行 `node scripts/build-linux-packages.cjs`。脚本检查版本和逐文件一致性后才开始，避免将旧程序包装成新版本。

Arch 包使用 `makepkg`；需要本机有 Arch 构建工具及 `electron43`、`libsecret`、`xdg-utils`，不执行 `makepkg -i`。DEB/RPM 使用 electron-builder 提供并校验的 FPM 工具，RPM 另需 `rpmbuild`。脚本通过结构化参数执行工具，不注入 Shell 命令。

`release/ufi-panel-linux-0.4.4-arch-build/` 包含可离线复现的 PKGBUILD 与应用归档，SHA-256 已写入 PKGBUILD。没有发布到 AUR 或任何软件源。DEB/RPM 的维护者字段明确标记为 local builds，`.invalid` 地址是保留的本地元数据，不是支持邮箱；项目没有公开仓库 URL，不伪造官方项目关系。

## 系统集成

- 安装 `/usr/bin/ufi-panel-linux`、应用菜单和 hicolor 图标，普通用户直接启动。
- Arch 借用系统 Electron；自启动保留应用归档参数，避免只启动 Electron 默认页面。
- DEB/RPM 安装到 `/opt/ufi-panel-linux`，不要求另装 Node.js/npm。
- 保留 Chromium 沙箱。安装器为自带运行时设置标准 chrome-sandbox SUID 权限；兼容新版 AppArmor 的系统才安装 userns 配置。启动器不添加 `--no-sandbox`。
- 安装不自动启用开机启动，也不自动连接设备。卸载不删除用户配置。
- 安装包更新不会替换曾经手动下载的 AppImage，应关闭旧进程并使用新应用菜单入口。

## 验证

Arch 包通过 makepkg 生成、pacman 查询元数据；解包后使用已安装的 Electron 43 验证实际界面、隔离桥接和临时目录中的自启动开关。验证不在宿主机执行系统安装。

DEB 使用隔离的 Debian 12 容器通过 apt 安装并解析依赖，再在 Xvfb 中运行 Electron 交互检查。验证容器文件见 `packaging/validation/Dockerfile.debian` 与 `Dockerfile.fedora`。运行验证容器时使用 `docker run --init --rm ...`，避免 Xvfb 启动脚本作为 PID 1 时等待启动信号。Docker 对用户命名空间有限制，只有该测试容器显式启用测试脚本的 `--no-sandbox`；生产安装入口保留沙箱。

RPM 使用兼容 RPM 4 的包格式与 SHA-256 文件摘要，并检查依赖、文件所有权和脚本。Fedora 43 容器进一步验证 dnf 安装、界面与卸载；这不等同于 openSUSE 实机验收。当前仅构建 x86_64，没有声称 ARM64 或所有旧发行版可用。Debian 12 验证不覆盖 Ubuntu 24.04 的实际宿主 AppArmor 策略。

## 是否迁移 Tauri

可以。Tauri 在 Linux 使用系统 WebKitGTK，现有 HTML/CSS/大部分页面逻辑可以复用。主要迁移工作是将 Electron 主进程的协议请求、长任务、密钥环存储、文件选择与导出、多窗口、托盘和 IPC 桥接改成 Tauri 命令。仅换窗口外壳但仍捆绑 Node 后端时，还会有 Node 运行时体积。

Tauri 版的包体需要实际构建后衡量；系统 WebKitGTK 首次安装也可能较大。本版通过 Arch 共享运行时先解决重复打包的问题；DEB/RPM 保留已经验证的自带运行时。Tauri 迁移尚未执行，不将安装包格式变化描述为 UI 框架迁移。

## 官方依据

- [Arch PKGBUILD 规范](https://man.archlinux.org/man/PKGBUILD.5.en)
- [Arch Electron 说明](https://wiki.archlinux.org/title/Electron)
- [Debian 二进制包格式](https://manpages.debian.org/bookworm/dpkg-dev/deb.5.en.html)
- [electron-builder Linux 目标](https://www.electron.build/v26/docs/linux/)
- [Tauri Linux 依赖](https://v2.tauri.app/start/prerequisites/)
