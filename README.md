# Diagnose

通用、临时、由用户控制权限的远程 AI 诊断探针。支持逐次审批、批量计划和会话自动批准。MIT 开源，TypeScript 源码随安装包提供。Node.js **22.18+**。

## 安装及使用

使用 npm 安装公开包 `@masstensor/diagnose`：

```sh
npm install -g @masstensor/diagnose
diagnose start
```

也可无需全局安装，直接运行 `npx @masstensor/diagnose start`。原 HTTPS 下载地址继续保留为首版安装包。

用户把终端显示的完整 `D1.…` 配对码私下交给诊断者。诊断者运行：

```sh
diagnose connect
```

交互输入配对码及诊断者/AI 提供商标签。用户核对自报标签与会话指纹后选择权限。配对码不经命令行参数传入；不要公开分享代码。两端都主动连接 443，不需要用户开放端口。

**权限选择**（只在用户本机决定）：

- 配对时输入 `y`：每个任务/整批计划各确认一次执行、一次合并结果发送，不按每个子步骤询问。
- 配对时输入 `a`：明确授权本次会话**自动执行并自动发送**，后续任务不再弹确认。命令有当前OS用户权限；输出会直接提供给诊断者及其AI。终端持续显示任务及发送摘要，审计继续记录。文本脱敏仍不是秘密识别保证，二进制不会自动脱敏。
- 会话中输入 `permissions` 查看模式；`permissions ask` 撤销自动权限、取消正在运行的任务/整批，后续恢复审批。已发送内容不能撤回。
- 想在会话中开启自动模式：先输入 `permissions auto` 阅读说明，再在60秒内输入 `permissions allow-auto` 明确确认。远端请求没有切换权限的字段。
- `cancel` 取消当前任务/整批，保留当前权限模式；`Ctrl+C` 或 `exit` 结束会话。新会话恢复默认逐次审批，不继承自动授权。

诊断者终端输入 JSON，请求立即返回任务 ID，使用 `wait <id>` 查看，`cancel <id>` 取消，`exit` 退出：

```json
{"operation":"system.inspect","arguments":{},"reason":"检查电脑与串口环境"}
{"operation":"process.run","arguments":{"executable":"/usr/bin/sw_vers","args":[],"timeoutMs":10000},"reason":"查看 macOS 版本"}
{"operation":"file.read","arguments":{"path":"/absolute/path/to/log","offset":0,"length":65536},"reason":"检查用户指定日志"}
{"operation":"serial.capture","arguments":{"path":"/dev/cu.usbserial-2110","baudRate":115200,"durationMs":20000},"reason":"采集设备启动日志；串口可能导致重启"}
```

所有命令接受可选的中继地址：`diagnose start https://your-relay.example`。远程中继强制 TLS；回环测试允许 ws/http。

## 一次提交多个操作或整段脚本

两端均需升级到 **0.2.0+**：`npm install -g @masstensor/diagnose@latest`。长会话超时选项需要新版中继；当前AWS中继随0.3更新。旧版本仍可使用原有单操作协议。

批量JSON示例（交互终端粘贴时压成一行，AI/MCP可直接传结构化参数）：

```json
{
  "operation": "batch.run",
  "reason": "一次采集系统环境和运行时信息",
  "arguments": {
    "steps": [
      {"operation":"system.inspect","arguments":{}},
      {"operation":"process.script","arguments":{"interpreter":"node","script":"const os = require('node:os');\nconsole.log(JSON.stringify({uptime: os.uptime(), freeMemory: os.freemem()}));","timeoutMs":10000}}
    ],
    "stopOnError": true,
    "timeoutMs": 60000
  }
}
```

默认顺序执行，最多32步，不允许嵌套批量；遇错停止，显式设置 `stopOnError:false` 可继续独立步骤。整批总时限最多300秒，全部输出合计最多10MiB。返回每步状态及已完成/未运行数量，输出按 `0.stdout`、`1.file` 等区分。任何批次取消/断线/撤权都会终止当前进程组、释放串口并跳过后续步骤；已发生的修改不会自动回滚。

整段脚本也可以独立提交：

```json
{"operation":"process.script","arguments":{"interpreter":"/bin/sh","script":"uname -a\nprintf '\\n--- Disk ---\\n'\ndf -h\n","timeoutMs":30000},"reason":"一次采集系统和磁盘信息"}
```

必须明确指定解释器（如 `node`、`/bin/sh`）及可选 `args`、`cwd`。脚本通过stdin传入，默认不落临时脚本文件；人工审批时展示完整原文，一次授权整段脚本。脚本本身可以并发采集，但不会逐行审批。Windows应选择可从stdin读取脚本的解释器及对应参数。

批量里的所有 `file.write` 会在整批审批前保存预览与旧文件哈希；若前面步骤修改了该目标，后续写入会因快照变化而拒绝，不会静默覆盖新内容。

## 一条命令启动诊断 Agent（0.3.1+）

诊断者已安装并登录对应 CLI 后，直接运行：

```sh
diagnose agent codex
diagnose agent claude
diagnose agent gemini
```

无需执行mcp add或手动启动diagnose mcp。启动器为本次进程加载当前安装版本的Diagnose MCP，再启动对应Agent；退出后不保留这次MCP配置。不会自动安装Agent、登录账号或改变审批模式。默认使用现有AWS中继。

未全局安装时：`npx @masstensor/diagnose@latest agent codex`。

`diagnose agent codex --relay https://your-relay.example -- --model your-model`：--前的参数属于Diagnose，后面的参数原样交给Agent。配对码仍在Agent会话里私下提供，不放命令行参数。

Codex使用-c覆盖、Claude使用--mcp-config，均不写全局配置。Gemini没有等价的启动参数，因此创建私有临时配置目录，用GEMINI_CLI_HOME仅传给当前子进程；复制用户设置并加入MCP，通过符号链接复用已有登录、历史等文件，保留管理员策略及正常工作区信任流程。退出时删除临时目录；在本次Gemini会话中修改用户设置不会写回原settings.json。原先全局配置过的其他MCP仍按各CLI规则加载。Gemini功能在macOS验收，Windows符号链接权限尚未验收。

远端用户仍运行`diagnose start`，把配对码交给诊断者，并在本机确认连接。示例指令：“使用diagnose连接配对码D1.…，只读取远端欧万网关日志并诊断，不修改配置。”

源码：[GitHub / zkwasm/diagnose](https://github.com/zkwasm/diagnose)，MIT许可。

## AI / MCP

在诊断者电脑的 MCP 客户端配置中加入（确保其环境 PATH 可找到安装后的 diagnose）：

```json
{"mcpServers":{"diagnose":{"command":"diagnose","args":["mcp"]}}}
```

基础工具：`diagnose_pair(code,label)`、`diagnose_start(operation,arguments,reason)`、`diagnose_batch(steps,reason,stopOnError,timeoutMs)`、`diagnose_wait(id,timeoutMs,release)`、`diagnose_cancel(id)`、`diagnose_disconnect()`。AI优先用diagnose_batch提交整份采集计划；整段脚本使用diagnose_start的process.script。批量与脚本都立即返回一个任务ID。等待一次最多 25 秒，pending 时继续轮询。大结果读取后可 release 释放诊断端缓存。MCP 使用本地 stdio，不暴露公网执行端口。配对码由你交给 AI，因此也会进入你所用 AI 的上下文；中继的加密边界不覆盖 AI 提供商。

## 0.3：接近 SSH 的诊断能力

两端升级到0.3+。用户仍执行 `diagnose start`；诊断者可以执行 `diagnose terminal`，输入配对码后打开真正的交互式终端。支持持续的 cwd/环境、stdin、实时 stdout/stderr、终端尺寸调整和信号。Ctrl+C发往远端，Ctrl+]脱离终端；普通退出会关闭未显式保留的进程。

AI新增5个MCP工具：

| 工具 | 用途 |
|---|---|
| diagnose_process | 创建普通进程或PTY；指定cwd/env、timeoutMs、retainOnDisconnect |
| diagnose_resource | list/status/read/input/resize/signal/close；从返回cursor继续读取，检查ended及exitCode |
| diagnose_resume | 用原资源ID和resumeToken请求恢复；不重跑命令 |
| diagnose_transfer | upload/download后台无损传输，status/cancel查询进度；SHA-256校验、续传、显式覆盖 |
| diagnose_forward | 在获准net.forward句柄上启动、查看或关闭本地端点 |

创建实时资源时，先在本机批准操作及**持续原始输入输出**，之后同一句柄内输入、读取、调整尺寸、信号或连接不逐次弹窗。自动模式仍仅由用户本机开启。创建成功只表示句柄已建立，进程是否成功须查看退出码。

终端JSON示例：

```json
{"operation":"process.open","arguments":{"executable":"/bin/sh","pty":true,"retainOnDisconnect":true,"timeoutMs":0},"reason":"持续交互诊断，断线后保留原进程"}
{"operation":"net.forward","arguments":{"direction":"local","host":"192.168.31.217","port":11500},"reason":"访问用户局域网内的网关TCP服务"}
```

`wait <task>`取得资源ID和恢复凭据后，可使用 `resources`、`read <id> [cursor]`、`input <id> "一行输入\\n"`、`resize <id> 120 40`、`signal <id> SIGINT`、`close <id>`。`forward <id> [localPort]`启动转发。

转发包括local固定远端目标、remote用户侧回环监听转至诊断者目标，以及socks诊断者侧SOCKS5 TCP代理。SOCKS的allowedHosts默认["*"]表示任意目标，应按需求缩小。监听仅限回环；不支持UDP、TUN或公共监听。

`upload {"localPath":"/local/file","remotePath":"/remote/file","reason":"上传诊断文件"}`；download交换源/目标含义。MCP同样传路径，不让大段base64进入AI上下文。上传先写私有暂存文件，完整SHA校验及目标旧哈希匹配后替换；下载使用.diagnose.part和0600恢复侧文件，完成校验后替换。文件路径/权限管理另有file.stat/list/mkdir/remove/rename/chmod；rename默认拒绝覆盖。

用户本机 `jobs`查看资源、`recover <id>`重新生成恢复凭据、`secret <id>`向已批准进程输入隐藏本地文本（macOS/Linux；程序仍可能回显）。不要让AI收集系统密码；交互sudo使用本机输入，不自动提权。

断线后探针继续运行并显示**新配对码**；需要用户再次确认，用ID与resumeToken恢复保留资源。普通进程默认不保留，文件传输默认保留。探针自身重启后可恢复加密输出及文件暂存，不能接管原进程的PTY；不会重跑创建命令。Ctrl+C/exit、cancel或permissions ask终止相应资源。恢复凭据与配对码均应私下分享。

`diagnose start --session-minutes 240 --idle-minutes 30`调整超时；0关闭端点对应计时，中继最多7天，帧计数安全上限仍生效。实时进程默认1小时，可设timeoutMs:0；每进程输出默认64MiB、最大1GiB，达到上限终止进程。完成输出保存在本机，不自动清理，可结束诊断后自行清理~/.diagnose/resources。

这不是SSH协议服务器，不能直接使用ssh/scp/sftp客户端；不包含SSH证书体系、agent/X11转发、图形桌面或OS服务管理。可用获准脚本调用电脑已有工具。macOS已验收，Windows ConPTY及Linux探针仍需真实环境验收。

## 能力与约束

| operation | arguments |
|---|---|
| system.inspect | `{}`；OS、Node、串口枚举 |
| process.run | executable、args、cwd?、timeoutMs?；直接 spawn，不自动加 shell |
| process.script | interpreter、script、args?、cwd?、timeoutMs?；完整脚本通过stdin交给显式解释器 |
| batch.run | steps、stopOnError?、timeoutMs?；一次审批整个顺序计划及合并结果 |
| file.read | path、offset?、length?；每次最多 1 MiB |
| file.write | path、content、expectedSha256?；预览前后内容，核对旧文件哈希，临时文件加 rename |
| serial.capture | path、baudRate?、durationMs?；8N1，DTR/RTS=false，可能复位设备 |
| serial.exchange | 同上，另需 dataHex；发送明确字节后采集 |

网络/USB 专用诊断程序可通过 process.run 调用，无设备型号预设。任意获准进程拥有当前 OS 用户权限，**不是沙箱**；不自动提权，不安装常驻服务。通用进程的所有副作用无法完整跟踪，也无法通用回滚。文件写入检查可发现通常的编辑竞争，但不提供对恶意本机并发修改的隔离。

最多同时执行4个有限任务或整批计划；批内顺序执行。实时资源另有128个活动句柄上限。进程/脚本60秒默认、300秒上限；整批300秒默认/上限；串口最多300秒；整批合并输出10MiB上限；重复任务ID不再执行。10分钟空闲或60分钟会话结束。断线不重放，有限任务取消、串口释放；显式保留的实时进程和文件传输可在新配对后恢复。POSIX进程组以外主动脱离的程序不能保证被终止。

## 加密、审批与审计

Noise `NNpsk0_25519_ChaChaPoly_BLAKE2b`，256位随机配对秘密、临时X25519密钥、独立收发计数器、路由/角色/版本绑定。协议使用 noise-handshake 与 sodium；测试含公开 Cacophony 测试向量。每方向最多100万帧，远低于依赖的32位计数器边界。WSS同时校验证书。尚未经过独立安全审计。

中继只保存内存房间和密文缓冲，不持久化内容、密钥或离线消息。仍可见IP、路由、连接时间及流量大小，也能阻断服务。配对秘密不发送给中继，持码仅证明持有权，标签不等于真实身份。

本机 `~/.diagnose/audit-*.jsonl` 默认权限0600，记录任务ID、操作类型、目标路径/可执行文件/解释器、读取范围/串口参数、完整参数摘要、审批、各输出流采集/发送字节数、取消和结果。批内每步有父批次ID和独立结果，自动模式另记权限变更及自动批准的执行/发送阶段。工具写入文件时另记录路径、修改前后哈希及字节数。人工审批终端展示具体参数、完整脚本、写入前后内容与待发送预览；自动模式显示有长度上限的任务/发送摘要。实时资源的原始输出及恢复元数据另存于本机~/.diagnose/resources，使用AES-256-GCM逐条加密；密钥0600保存在同一用户目录，不能防御已控制该OS账号的攻击者。默认审计不保存内容、脚本原文或完整命令参数，避免落盘秘密。因此历史日志不是完整命令回放或文件修改监控。每次审计写入flush，审计不可写则停止任务。

有限任务的采集文本先做常见凭据脱敏并移除终端控制字符；实时终端、文件传输与TCP通道保持原始字节，不脱敏。人工模式在本机合并预览并确认发送；自动模式依据用户本地已授予的会话权限直接发送。正则不能识别所有秘密，二进制不自动脱敏。采集与发送分别审计。进程输出在本地有上限地缓冲，得到本次或会话发送授权后才传输。Ctrl+C撤销待审请求、取消任务并结束会话。

## 开发、测试、部署

```sh
npm ci
npm test
npm run check
npm pack
```

`test/live-gateway.ts` 是仅开发机显式调用的硬件验收，不包含在分发包中，也不随 npm test 运行。网关认证日志、固件、设备采集内容均不在包内。macOS探针与Linux中继实测；Windows及Linux探针暂为实验性，尚无真实串口与取消兼容性验收。

`deploy/ecosystem.config.cjs`、`deploy/Caddyfile` 提供部署模板。服务绑定127.0.0.1:8792，无数据库和运行密钥；DOWNLOAD_PATH可指定公开安装包路径。Caddy站点不开访问日志，PM2只记录固定启动/失败事件。仅部署打包后的白名单文件，不能同步用户诊断工作区。
