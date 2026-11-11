# 速记 · Memo Overlay

一个随时唤出的单页 Markdown 速记浮层：无边框、始终置顶、拖到屏幕边缘自动收起成一条细光条，悬停或按全局快捷键立刻展开。

## 特性

- **随时唤出**：默认全局快捷键 `Ctrl+Alt+M`，在任何应用里都能唤出 / 收起。
- **单页 Markdown**：只有一个页面，无分页、无标签页；`Ctrl+E` 在编辑与预览之间切换，支持标题、列表、任务清单、代码块、表格、引用等 GFM 语法。
- **可视化 Markdown 工具栏**：待办、无序列表、有序列表、加粗、斜体、删除线、行内代码都是一键操作，不用手写语法；有选区时包裹选区，无选区时插入标记并把光标放在中间。编辑和预览模式下都能用。
- **最高层级**：无边框浮层 + 始终置顶，可跨工作区显示，不被普通窗口遮挡。
- **QQ 式贴边隐藏**：把窗口拖到屏幕任意边缘，松手后自动收成 7px 光条；鼠标碰到光条自动展开并聚焦输入框。拖拽由应用自绘（指针跟随 + 主进程移动窗口），不会触发窗口管理器的分屏 / 磁贴。设置里可关闭。
- **内容不落盘为文档**：正文只写入应用自己的缓存目录（`~/.config/memo-overlay/cache/memo.cache`），不会在桌面或文档目录生成 `.md` / `.txt` 文件；关机/重启后自动恢复。
- **一键清空**：顶栏垃圾桶按钮一次点击即清空正文并删除缓存，底部提示条提供 6 秒「撤销」，误触可恢复。
- **托盘常驻**：关闭按钮只隐藏窗口；托盘菜单可唤出、贴边收起、切换置顶、清空、退出。
- **轻量设置**：全局快捷键可录制修改，置顶 / 贴边开关、字号（小 / 标准 / 大）、背景透明度（0–45%）均即时生效。
- **安全隔离**：`contextIsolation` + `sandbox` + 禁用 `nodeIntegration`，Markdown 预览经 DOMPurify 净化，链接只允许以系统浏览器打开 http(s)。

## 快速开始

```bash
cd memo-overlay
npm install     # 安装 Electron 28 并自动复制 marked / DOMPurify、生成图标
npm start
```

### 安装为独立应用（推荐日常使用）

```bash
./scripts/package.sh
```

会把应用打包成自包含目录并注册到开始菜单，之后不需要 `npm start`：

- `~/.local/opt/memo-overlay/`：Electron 运行时 + 应用资源（约 253MB）
- `~/.local/bin/memo-overlay`：ELF 启动器（自动补 `--no-sandbox`），在 PATH 里可直接运行
- `~/.local/share/applications/memo-overlay.desktop`：开始菜单入口，搜索「速记」或「memo」即可启动

修改代码后重新执行一次 `./scripts/package.sh` 即可更新安装。`PREFIX=/path` 可以改安装前缀（要求 `bin` 与 `opt` 同级）。

> 这是按用户安装（无需 root）。如果要装到 `/usr` / `/opt` 供所有用户使用，建议再打一个 `.deb` 后用 `sudo dpkg -i` 安装。

> 说明：在 UOS / Debian 10（glibc 2.28）环境下使用 Electron 28；启动脚本带 `--no-sandbox`，因为 npm 安装的 `chrome-sandbox` 默认没有 setuid 权限。若想启用 Chromium 沙箱：
>
> ```bash
> sudo chown root:root node_modules/electron/dist/chrome-sandbox
> sudo chmod 4755 node_modules/electron/dist/chrome-sandbox
> ```
>
> 然后去掉 `package.json` 里 `start` 脚本的 `--no-sandbox`。
>
> 如果 `npm install` 卡在下载 Electron 二进制，可使用国内镜像重试：
>
> ```bash
> ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npm install
> ```

## 使用

### 快捷键

| 操作 | 快捷键 |
| --- | --- |
| 全局唤出 / 收起 | `Ctrl+Alt+M`（可在设置中录制修改） |
| 编辑 / 预览切换 | `Ctrl+E` |
| 隐藏窗口 | `Esc` |
| 缩进 / 列表内缩进 | `Tab`（插入两个空格） |
| 列表续写 | 回车自动续写 `- `、`1. `、`- [ ] `、`> `；空项回车退出列表 |

### Markdown 工具栏

输入框上方有一排快捷按钮，点一下即可插入对应 Markdown，不必记语法：

| 按钮 | 作用 |
| --- | --- |
| ☑ 待办 | 给当前行（或选中行）加 / 去掉 `- [ ] ` |
| ☰ 无序列表 | 加 / 去掉 `- ` |
| 1. 有序列表 | 加 / 去掉 `1. `、`2. `… 自动编号 |
| B 加粗 | 包裹 `**…**`，再点一次取消 |
| I 斜体 | 包裹 `*…*` |
| S 删除线 | 包裹 `~~…~~` |
| `</>` 行内代码 | 包裹 `` `…` `` |

有选区时作用于选区；没有选区时插入标记并把光标放在中间。预览模式下点按钮会自动切回编辑并应用。

### 背景透明度

设置 → 背景透明度，0% 为不透明，45% 为很通透；拖动时实时预览，松手后自动保存。

### 贴边隐藏

- 把窗口拖到屏幕左 / 右 / 上 / 下边缘并松手，窗口会在约 0.3 秒后收起成一条细光条。
- 鼠标移出后再碰一下光条即可展开；展开后会自动聚焦编辑器，可以直接输入。收起后光标通常还压在边缘上，因此首次需要先移开一次，避免刚收起又立刻弹出。
- 顶栏的 `‹` 按钮可直接贴到最近的屏幕边缘。
- 拖拽是自绘的，不会触发窗管的分屏 / 磁贴；如果拖动时窗口被系统夹到屏幕边缘，松手也会触发贴边收起。
- 设置里关闭「贴边自动隐藏」后，此行为停用。

### 置顶

默认开启。顶栏图钉按钮或设置里的「始终置顶」可切换。少数窗口管理器会让全屏应用盖住置顶窗口，这是 WM 的行为，应用层无法强制突破。

## 存储与隐私

| 内容 | 位置 |
| --- | --- |
| 正文缓存 | `~/.config/memo-overlay/cache/memo.cache` |
| 窗口/偏好设置 | `~/.config/memo-overlay/settings.json` |

- 正文是纯文本缓存，没有扩展名，不会被当作文档打开或同步。
- 一键清空会删除 `memo.cache`；清空后若未撤销，退出应用也不会重新写回。
- 设置页底部可以直接打开缓存目录。

## 桌面图标

日常使用推荐上面的 `./scripts/package.sh`，它会安装独立应用并注册开始菜单。

如果只想给当前源码目录建一个开发用菜单入口：

```bash
./scripts/install-desktop.sh
```

会在 `~/.local/share/applications/memo-overlay.desktop` 写入指向 `scripts/run.sh` 的启动器。

## 目录结构

```
memo-overlay/
├── main.js                 # 主进程：窗口、置顶、贴边、快捷键、托盘、缓存
├── preload.js              # contextBridge 最小权限桥接
├── src/
│   ├── index.html          # 单页 H5 界面
│   ├── styles.css          # 暗色浮层样式 / Markdown 样式 / 贴边光条
│   ├── renderer.js         # 编辑、预览、自动缓存、设置、清空
│   └── vendor/             # marked + DOMPurify（安装时复制，离线可用）
├── assets/                 # 应用图标 / 托盘图标（脚本生成）
└── scripts/
    ├── make-icons.js       # 纯 Node 绘制 PNG 图标
    ├── vendor.js           # 复制浏览器端依赖
    ├── run.sh              # 本地启动脚本
    ├── launcher.c          # 独立应用的 ELF 启动器
    ├── package.sh          # 打包为自包含应用并注册开始菜单
    └── install-desktop.sh  # 开发用 .desktop 启动器
```

## 开发说明

- 目标环境：X11（UOS / deepin / KDE 等）。Wayland 下全局快捷键与屏幕边缘坐标可能受限。
- 临时打开开发者工具：`MEMO_DEV=1 npm start` 不会自动打开，可在代码里加 `win.webContents.openDevTools()`；当前默认关闭。
- 修改界面后无需构建，`npm start` 直接加载 `src/`。
- 重新生成图标：`npm run icons`。

## 可选打包

日常安装用 `./scripts/package.sh` 就够了。如果需要 .deb / AppImage，也可以自行安装 `electron-builder`：

```bash
npm i -D electron-builder
npx electron-builder --linux dir
```

注意 UOS 20 的 glibc 2.28 限制，Electron 主版本不要高于 28。
