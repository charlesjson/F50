# Linux 安装

本地构建的 x86_64 安装包；项目没有配置在线更新仓库。

## Arch Linux / EndeavourOS / Manjaro

```sh
sudo pacman -U ./ufi-panel-linux-0.4.4-1-x86_64.pkg.tar.zst
```

此包使用 Arch 官方仓库的 `electron43`，不重复包含 Chromium。系统还未安装 Electron 43 时，pacman 会下载该依赖；小安装包不代表运行时不占空间。Manjaro 需仓库已提供 electron43，不能通过忽略依赖强行安装。应用依赖该主版本，更新由发行版包管理器提供。

## Debian 12+ / Ubuntu 22.04+ / Linux Mint

```sh
sudo apt install ./ufi-panel-linux_0.4.4-1_amd64.deb
```

apt 会处理依赖；不需要另外安装 Node.js、npm 或 Electron。此包自带 Electron，因此仍较大。请使用 apt 安装本地文件，不要只执行 dpkg 后忽略未满足的依赖。

## Fedora / 兼容 RPM 的桌面发行版

```sh
sudo dnf install ./ufi-panel-linux-0.4.4-1.x86_64.rpm
```

openSUSE 可用 `sudo zypper install ./ufi-panel-linux-0.4.4-1.x86_64.rpm`，具体依赖包名仍取决于版本。RPM 自带 Electron，尚未在每个 RPM 发行版实机验证。

## 启动和卸载

安装后在应用菜单搜索“UFI”，或运行 `ufi-panel-linux`。正常使用以普通用户启动。原先手动下载的 AppImage 是独立文件，不会被包管理器自动替换；关闭旧版后使用新的菜单入口。

- Arch 卸载：`sudo pacman -Rns ufi-panel-linux`
- Debian 卸载：`sudo apt remove ufi-panel-linux`
- Fedora 卸载：`sudo dnf remove ufi-panel-linux`

卸载不删除用户连接配置。应用设置中的自启动是用户主动启用的 `~/.config/autostart/ufi-panel-linux.desktop`，可先在应用里关闭。加密口令依赖系统密钥环；没有密钥环时仍可使用，但不会保存明文口令。
