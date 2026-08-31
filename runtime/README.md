# AnanChrome Windows 本地运行时

1.5.0 发布入口已改为整合 ZIP：见项目 `release/README.zh-CN.md`。新包内置 llama.cpp，`setup-bundled.ps1` 离线安装运行程序，模型通过设置页单独下载。下方 `setup-windows.ps1` 是保留的旧在线安装入口，不是新版整合包的用户入口。

该运行时是浏览器扩展与 `llama-server` 之间的 Native Messaging 主机。用户安装一次后，扩展打开时会自动请求运行时在后台启动模型，不再需要手动运行 BAT。

## 开发构建

```powershell
.\runtime\build.ps1
```

输出为 `runtime\dist\win-x64\AnanChromeRuntime.exe`，是 Windows x64 自包含单文件程序，不依赖用户预装 .NET。

## 本机安装

已有项目和模型时，推荐双击项目根目录的 `Setup-AnanChrome.cmd`，将 GGUF 放进 `models` 文件夹。运行时每次启动服务时自动查找该目录；空目录可暂时回退到原来配置的模型。配置脚本不移动或下载权重，也不清除扩展聊天记录。

`install-runtime.ps1` 不再硬编码开发者磁盘的模型与 llama.cpp 路径，而是查找项目内 llama.cpp、上次配置及用户安装目录。用 `-ModelPath` 可固定选用一个文件；用 `-ModelDirectory` 可启用目录自动发现。项目目录移动后重新运行配置入口。

项目内置开发扩展 ID：`padicgoaheglbafnjjbjaooakfdcjfmi`。

```powershell
.\runtime\install-runtime.ps1
```

安装器会：

1. 把运行时复制到 `%LOCALAPPDATA%\AnanChrome\Runtime`；
2. 写入 `config.json`；
3. 生成 Native Messaging host manifest；
4. 在当前用户的 Chrome 和 Edge 注册表项中注册主机。

## 面向普通用户的一次性安装

普通用户双击 `Install-AnanChrome.cmd`。安装流程会下载并校验固定版本的 llama.cpp CUDA 12.4 运行时和 Qwen3.5-9B Q4_K_M 模型，安装到 `%LOCALAPPDATA%\AnanChrome`，再完成 Native Messaging 注册。模型约 5.24 GiB，只下载一次。

下载文件使用 SHA-256 校验；缓存保存在 `%LOCALAPPDATA%\AnanChrome\Downloads`，重复安装会复用已经通过校验的文件。

发布商店版本后，把商店分配的扩展 ID 一并传给安装器：

```powershell
.\runtime\install-runtime.ps1 -ExtensionIds @('开发扩展ID', '商店扩展ID')
```

## 手动验证

```powershell
& "$env:LOCALAPPDATA\AnanChrome\Runtime\AnanChromeRuntime.exe" --status
& "$env:LOCALAPPDATA\AnanChrome\Runtime\AnanChromeRuntime.exe" --ensure
```

日志位于 `%LOCALAPPDATA%\AnanChrome\Logs`。

## 正式分发注意事项

- Chrome/Edge 商店只分发扩展，Windows 本地运行时需要单独安装。
- `llama-server.exe` 依赖同目录的 llama.cpp/CUDA DLL，正式安装器必须分发完整运行时目录。
- 9B GGUF 模型约 5.24 GiB，建议首次启动时独立下载并支持断点续传，不要打进扩展包。
- `allowed_origins` 不允许通配符，发布后必须把实际商店扩展 ID 写入 Native Messaging host manifest。
