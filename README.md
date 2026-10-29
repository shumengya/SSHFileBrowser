# SSH 文件管理器

[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

通过 SSH / SFTP 在浏览器里管理远程 Linux 服务器上的文件。操作方式照着 Windows 资源管理器和宝塔面板的文件管理来做:标签页、地址栏、右键菜单、框选、拖放、快捷键都是熟悉的样子。

前端打包进 Go 二进制,**一个 exe,双击就能用**,不需要装数据库,也不需要在服务器上装任何东西,只要服务器能 SSH 登录。

## 快速开始

1. 双击 `bin\sshfilebrowser.exe`,浏览器会自动打开 http://127.0.0.1:8090
2. 第一次打开时创建管理员账号(这个账号能访问你添加的所有服务器,请用强密码)
3. 点「添加服务器」,填地址、用户名、密码或私钥,可以先「测试连接」
4. 点服务器就能浏览文件

关闭控制台窗口即退出。再次双击时如果已经在运行,会直接打开浏览器,不会重复启动。

## 功能

**浏览**

- 多标签页,每个标签页可以是不同服务器;标签页和所在目录关闭浏览器后会恢复
- 面包屑地址栏,点空白处可直接输入路径(支持 `~` 和相对路径)
- 详细信息 / 大图标两种视图,按名称、时间、类型、大小、权限、所有者排序(文件夹始终在前,数字自然排序)
- 显示/隐藏以 `.` 开头的文件;软链接带角标,失效链接标红
- 当前目录下递归搜索文件名(不区分大小写,最多 500 条)
- 侧栏「快速访问」:主目录、根目录、固定的常用目录

**操作**

- 选择:单击、Ctrl 多选、Shift 连选、鼠标框选、方向键、输入首字母跳转
- 复制 / 剪切 / 粘贴,支持**跨服务器**;同名时可选替换、跳过、保留两者;同目录复制自动生成「xxx - 副本」
- 拖放:拖到文件夹上是移动,按住 Ctrl 是复制
- 新建文件夹/文件后直接进入重命名;F2 原地重命名
- 删除前确认(没有回收站,删除不可恢复)
- 修改权限(勾选框和数字双向联动)、所有者、用户组,可递归应用到子目录
- 压缩为 zip / tar.gz / tar.bz2 / tar.xz / tar,解压到当前目录、同名文件夹或指定目录
- 属性面板,可计算文件夹总大小

**传输**

- 上传文件或整个文件夹,也可以从桌面直接拖进来;3 个文件并行,有进度和取消
- 上传先写临时文件,传完再改名,中途断开不会留下半截文件
- 单个文件直接下载(支持断点续传);多个文件或文件夹边打包边下载 zip
- 复制、移动、压缩、解压在服务器后台执行,关掉浏览器也会继续;右上角「传输与任务」查看进度

**编辑与预览**

- 文本编辑器:行号、Tab 缩进(自动识别原文件用 Tab 还是空格)、回车保持缩进、自动换行、Ctrl+S 保存,保留原文件的 CRLF / LF
- 图片、视频、音频预览,左右方向键切换同目录的同类文件

## 复制是怎么执行的

| 场景 | 方式 |
| --- | --- |
| 同一台服务器内移动 | 直接改名,瞬间完成;跨分区时退回复制后删除 |
| 同一台服务器内复制 | 有 rsync 用 `rsync -a`(带进度),没有就用 `cp -a`,保留权限、时间、软链接 |
| 跨服务器 | 两边各开 SFTP,数据经本程序中转,并发分块读写;保留权限和修改时间 |

跨服务器复制的流量经过运行本程序的电脑,大文件建议把程序部署在离服务器近的地方。

## 快捷键

| 按键 | 作用 |
| --- | --- |
| Enter / 双击 | 打开文件夹、编辑文本、预览图片 |
| Backspace、Alt+← / Alt+→ | 后退 / 前进 |
| Alt+↑ | 上一级 |
| F2 | 重命名 |
| Delete | 删除 |
| Ctrl+C / Ctrl+X / Ctrl+V | 复制 / 剪切 / 粘贴 |
| Ctrl+A | 全选 |
| Ctrl+Shift+N | 新建文件夹 |
| Ctrl+F、F3 | 搜索 |
| Ctrl+L、Alt+D | 编辑地址栏 |
| F5 | 刷新 |
| Esc | 取消选择 / 退出搜索 / 关闭弹窗 |
| Ctrl+S | 编辑器中保存 |

## 服务器要求

- 能用 SSH 登录,开启了 SFTP 子系统(OpenSSH 默认开启)
- 支持密码、私钥(OpenSSH / PEM 格式,可带口令)、keyboard-interactive 登录
- 压缩、解压、修改所有者、rsync 加速、`rm -rf` 快速删除需要服务器能执行 shell 命令,以及对应的 `zip` `unzip` `tar` `rsync`。连接时会自动检测,缺少的功能按钮会变灰
- Windows 自带的 OpenSSH 服务器没有 POSIX shell,只能用基础的浏览、上传、下载、复制、删除

## 数据与安全

数据都在 exe 旁边的 `data` 目录:

| 文件 | 内容 |
| --- | --- |
| `sshfilebrowser.db` | 管理员账号、服务器列表、快速访问 |
| `secret.key` | 加密服务器密码和私钥的密钥 |

- 服务器密码和私钥用 AES-256-GCM 加密后存进数据库,接口永远不会返回明文
- **`secret.key` 丢了,已保存的服务器凭证就解不开了,需要重新填写;它和数据库一起泄露,等于服务器密码泄露。** 备份时两个文件一起备份,妥善保管
- 首次连接记住服务器的主机指纹,之后指纹变化会拒绝连接并提示,确认后才能信任新指纹(防中间人)
- 管理员密码用 bcrypt 存储;同一 IP 15 分钟内登录失败 5 次会被暂时锁定
- 会话 cookie 为 HttpOnly + SameSite,修改数据的请求都要带自定义请求头,防 CSRF
- 默认只监听 `127.0.0.1`,其它电脑访问不到。要让别人访问,请参考下面的「部署到服务器」

### 忘记管理员密码

在 exe 所在目录打开命令行,执行:

```
sshfilebrowser.exe reset-password
```

按提示输入用户名和新密码。重置后所有已登录的浏览器需要重新登录。

## 配置

所有配置都通过环境变量,不设置就用默认值:

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `SFB_LISTEN` | `127.0.0.1:8090` | 监听地址。`0.0.0.0:8090` 表示允许其它电脑访问 |
| `SFB_DATA_DIR` | exe 旁的 `data` | 数据目录 |
| `SFB_NO_BROWSER` | 空 | 设为 `1` 启动时不自动打开浏览器 |
| `SFB_SECURE_COOKIE` | 空 | 通过 HTTPS 访问时设为 `1` |
| `SFB_TRUSTED_PROXIES` | 空 | 反向代理的 IP(逗号分隔),用于登录限流识别真实客户端 IP |
| `SFB_SECRET_KEY` | 空 | 直接指定 base64 编码的 32 字节密钥,代替 `secret.key` 文件 |

Windows 下想换端口,可以在 exe 旁边建一个 `start.cmd`:

```bat
@echo off
set SFB_LISTEN=127.0.0.1:9000
sshfilebrowser.exe
```

## 部署到服务器

不建议把它直接暴露在公网上,请放在 HTTPS 反向代理后面。

**编译 Linux 版本**(纯 Go,没有 CGO,在 Windows 上就能交叉编译):

```powershell
cd frontend; pnpm build; cd ..\backend
$env:GOOS="linux"; $env:GOARCH="amd64"
go build -trimpath -ldflags "-s -w" -o ..\bin\sshfilebrowser-linux-amd64 .
```

**systemd 服务** `/etc/systemd/system/sshfilebrowser.service`:

```ini
[Unit]
Description=SSH File Browser
After=network.target

[Service]
ExecStart=/opt/sshfilebrowser/sshfilebrowser
Environment=SFB_LISTEN=127.0.0.1:8090
Environment=SFB_DATA_DIR=/opt/sshfilebrowser/data
Environment=SFB_NO_BROWSER=1
Environment=SFB_SECURE_COOKIE=1
Environment=SFB_TRUSTED_PROXIES=127.0.0.1
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

**nginx**(注意关闭上传大小限制和缓冲,否则大文件上传、下载会失败或很慢):

```nginx
location / {
    proxy_pass http://127.0.0.1:8090;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    client_max_body_size 0;
    proxy_request_buffering off;
    proxy_buffering off;
    proxy_read_timeout 3600s;
}
```

## 从源码构建

需要 Go 1.26+、Node.js 20+、pnpm。

```
build.cmd
```

产物是 `bin\sshfilebrowser.exe`。版本号默认是构建日期,要指定就先 `set VERSION=1.0.0` 再运行 `build.cmd`。

**开发模式**(前端热更新):

```
cd backend  && go run .      # 后端,:8090
cd frontend && pnpm dev      # 前端,:5173,/api 自动代理到后端
```

浏览器打开 http://localhost:5173。

**测试**:

```
cd backend  && go test ./...      # 在进程内起 SSH/SFTP 服务器,测试文件操作、复制、移动、打包等
cd frontend && pnpm typecheck
```

`go build` 会把 `backend/web/dist` 打进二进制,干净的仓库要先在 `frontend` 里 `pnpm build` 一次,否则编译报错。

## 技术栈与目录结构

- 后端:Go + Gin + SQLite(modernc,纯 Go)+ `golang.org/x/crypto/ssh` + `pkg/sftp`
- 前端:React + Vite + TypeScript + CSS Modules + axios,包管理用 pnpm

```
backend/
  main.go, cli.go        启动、自动打开浏览器、reset-password 等命令
  web/                   go:embed 内嵌的前端构建产物
  internal/
    api/                 HTTP 接口:登录、服务器、文件操作、上传下载、后台任务
    remote/              SSH 连接池、SFTP 文件操作、rsync/cp 复制、压缩解压、搜索
    task/                后台任务管理(复制/移动/压缩/解压)
    store/               SQLite 存储
    secret/              凭证加密
frontend/src/
  api/                   接口封装
  components/explorer/   文件浏览器:列表、选择、拖放、快捷键、右键菜单
  components/dialogs/    编辑器、预览、权限、属性、压缩、解压
  state/                 剪贴板、上传队列与任务、跨标签页刷新
build.cmd                一键构建
```

## 已知限制

- 只有一个管理员账号,没有多用户和权限分级
- 删除没有回收站
- 在线编辑只支持 UTF-8 编码、5 MB 以内的文本文件;GBK 等其它编码的文件会提示无法编辑,以免保存后乱码
- 上传文件夹时,空的子文件夹不会被创建
- 搜索只匹配文件名,不搜内容
- 跨服务器复制的速度受本机网络限制

## 常见问题

**双击后窗口一闪就没了?** 新版本出错时会停在窗口里显示原因。常见原因是 8090 端口被别的程序占用,用上面的 `start.cmd` 换个端口。

**连接失败「认证失败」?** 检查用户名、密码。私钥要粘贴完整内容(包括 `-----BEGIN ... KEY-----` 那几行),加密的私钥要填口令。

**提示「服务器指纹发生变化」?** 如果刚重装过系统或重新生成了 SSH 主机密钥,确认后点「信任新指纹」即可;否则先排查是否有人在拦截连接。

**压缩、解压按钮是灰的?** 服务器上没有对应命令,装上即可,例如 `apt install zip unzip` 或 `yum install zip unzip`。连接会缓存一段时间,装好后重启本程序才会重新检测。

**换电脑后服务器列表还在吗?** 把整个 `data` 目录(包括 `secret.key`)和 exe 一起拷过去就行。

## 开源协议

本项目基于 [Apache License 2.0](LICENSE) 开源,Copyright 2026 shumengya。

简单说:你可以自由使用、修改、分发甚至商用,但需要保留版权声明和协议文本,修改过的文件要注明;协议同时附带专利授权和免责声明。
