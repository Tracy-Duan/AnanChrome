using System.Diagnostics;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace AnanChrome.Runtime;

internal sealed class RuntimeConfig
{
    public string ServerUrl { get; set; } = "http://127.0.0.1:8080";
    public string LlamaServerPath { get; set; } = "";
    public string ModelPath { get; set; } = "";
    public string ModelDirectory { get; set; } = "";
    public int Port { get; set; } = 8080;
    public int ContextSize { get; set; } = 8192;
    public int GpuLayers { get; set; } = -1;
    public int StartupTimeoutSeconds { get; set; } = 120;
}

internal sealed class NativeRequest
{
    public string Action { get; set; } = "ensureServer";
}

internal sealed class NativeResponse
{
    public bool Ok { get; set; }
    public string Status { get; set; } = "unknown";
    public string? Error { get; set; }
    public string? ServerUrl { get; set; }
    public long ElapsedMs { get; set; }
    public DownloadState? Download { get; set; }
}

internal static class Program
{
    private enum ServerProbe
    {
        Unavailable,
        Loading,
        Ready
    }

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
    };

    public static async Task<int> Main(string[] args)
    {
        if (args.Contains("--download-model", StringComparer.OrdinalIgnoreCase)) return await ModelDownload.RunAsync();
        if (args.Contains("--ensure", StringComparer.OrdinalIgnoreCase))
        {
            NativeResponse result = await EnsureServerAsync(startIfNeeded: true);
            Console.WriteLine(JsonSerializer.Serialize(result, JsonOptions));
            return result.Ok ? 0 : 1;
        }

        if (args.Contains("--status", StringComparer.OrdinalIgnoreCase))
        {
            NativeResponse result = await EnsureServerAsync(startIfNeeded: false);
            Console.WriteLine(JsonSerializer.Serialize(result, JsonOptions));
            return result.Ok ? 0 : 1;
        }

        try
        {
            string? origin = args.FirstOrDefault(arg => arg.StartsWith("chrome-extension://", StringComparison.Ordinal));
            AppendRuntimeLog($"Native messaging request received; origin={origin ?? "diagnostic"}");
            NativeRequest request = await ReadNativeMessageAsync(Console.OpenStandardInput()) ?? new NativeRequest();
            NativeResponse response = request.Action switch {
                "status" => await EnsureServerAsync(startIfNeeded: false),
                "ensureServer" => await EnsureServerAsync(startIfNeeded: true),
                "downloadModel" => new() { Ok = true, Status = "modelDownload", Download = ModelDownload.Start() },
                "modelDownloadStatus" => new() { Ok = true, Status = "modelDownload", Download = ModelDownload.Status() },
                _ => new() { Ok = false, Status = "unsupportedAction", Error = "此版本运行时不支持该操作，请重新运行整合包中的安装入口。" }
            };
            await WriteNativeMessageAsync(Console.OpenStandardOutput(), response);
            return response.Ok ? 0 : 1;
        }
        catch (Exception ex)
        {
            AppendRuntimeLog($"Native messaging failure: {ex}");
            try
            {
                await WriteNativeMessageAsync(Console.OpenStandardOutput(), new NativeResponse
                {
                    Ok = false,
                    Status = "runtimeError",
                    Error = ex.Message
                });
            }
            catch
            {
                // Chrome may already have closed the pipe.
            }
            return 1;
        }
    }

    private static async Task<NativeResponse> EnsureServerAsync(bool startIfNeeded)
    {
        Stopwatch stopwatch = Stopwatch.StartNew();
        RuntimeConfig config;
        try
        {
            config = LoadConfig();
        }
        catch (Exception ex)
        {
            return Failure("runtimeNotConfigured", $"运行时配置无效：{ex.Message}", stopwatch);
        }

        ServerProbe initialProbe = await ProbeServerAsync(config.ServerUrl);
        if (initialProbe == ServerProbe.Ready)
        {
            return Success("alreadyRunning", config.ServerUrl, stopwatch);
        }

        if (initialProbe == ServerProbe.Loading)
        {
            if (!startIfNeeded)
            {
                return Failure("loading", "本地模型正在加载", stopwatch);
            }
            return await WaitForReadyAsync(config, stopwatch);
        }

        if (!startIfNeeded)
        {
            return Failure("notRunning", "本地模型服务尚未运行", stopwatch);
        }

        string serverPath;
        string modelPath;
        try
        {
            serverPath = ExpandPath(config.LlamaServerPath);
            modelPath = ModelLocator.Resolve(config.ModelDirectory, config.ModelPath);
        }
        catch (ModelSelectionException ex)
        {
            return Failure(ex.Status, ex.Message, stopwatch);
        }
        catch (Exception ex)
        {
            return Failure("runtimeNotConfigured", $"模型或运行时路径配置无效：{ex.Message}", stopwatch);
        }
        if (!File.Exists(serverPath))
        {
            return Failure("runtimeNotConfigured", $"找不到 llama-server：{serverPath}", stopwatch);
        }

        using Mutex mutex = new(initiallyOwned: false, "Local\\AnanChrome.Runtime.ServerStart");
        bool ownsMutex = false;
        bool waitForReady = false;
        try
        {
            try
            {
                ownsMutex = mutex.WaitOne(TimeSpan.FromSeconds(15));
            }
            catch (AbandonedMutexException)
            {
                ownsMutex = true;
            }

            if (!ownsMutex)
            {
                return Failure("startBusy", "另一个 AnanChrome 运行时正在启动模型", stopwatch);
            }

            /* Mutex is thread-affine. Do not await while it is owned. */
            ServerProbe lockedProbe = ProbeServer(config.ServerUrl);
            if (lockedProbe == ServerProbe.Ready)
            {
                return Success("alreadyRunning", config.ServerUrl, stopwatch);
            }

            if (lockedProbe == ServerProbe.Unavailable)
            {
                StartServerDetached(config, serverPath, modelPath);
                DateTime bindDeadline = DateTime.UtcNow.AddSeconds(10);
                do
                {
                    Thread.Sleep(100);
                    lockedProbe = ProbeServer(config.ServerUrl);
                }
                while (lockedProbe == ServerProbe.Unavailable && DateTime.UtcNow < bindDeadline);
            }
            waitForReady = true;
        }
        catch (Exception ex)
        {
            AppendRuntimeLog($"Failed to start server: {ex}");
            return Failure("startFailed", $"无法启动本地模型：{ex.Message}", stopwatch);
        }
        finally
        {
            if (ownsMutex) mutex.ReleaseMutex();
        }

        return waitForReady
            ? await WaitForReadyAsync(config, stopwatch)
            : Failure("startFailed", "本地模型启动状态未知", stopwatch);
    }

    private static RuntimeConfig LoadConfig()
    {
        string localConfig = Path.Combine(AppContext.BaseDirectory, "config.json");
        string userConfig = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "AnanChrome", "Runtime", "config.json");
        string configPath = File.Exists(localConfig) ? localConfig : userConfig;
        if (!File.Exists(configPath))
        {
            throw new FileNotFoundException("未找到 config.json，请重新安装 AnanChrome 本地运行时", configPath);
        }

        RuntimeConfig? config = JsonSerializer.Deserialize<RuntimeConfig>(File.ReadAllText(configPath), JsonOptions);
        if (config is null) throw new InvalidDataException("config.json 内容为空");
        config.ServerUrl = config.ServerUrl.TrimEnd('/');
        return config;
    }

    internal static void SelectDownloadedModel(string path)
    {
        RuntimeConfig config = LoadConfig();
        config.ModelPath = path;
        config.ModelDirectory = "";
        string localConfig = Path.Combine(AppContext.BaseDirectory, "config.json");
        string configPath = File.Exists(localConfig) ? localConfig : Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "AnanChrome", "Runtime", "config.json");
        File.WriteAllText(configPath + ".tmp", JsonSerializer.Serialize(config, JsonOptions));
        File.Move(configPath + ".tmp", configPath, overwrite: true);
    }

    private static string ExpandPath(string value)
    {
        return Path.GetFullPath(Environment.ExpandEnvironmentVariables(value));
    }

    private static async Task<ServerProbe> ProbeServerAsync(string serverUrl)
    {
        try
        {
            using HttpClient client = new() { Timeout = TimeSpan.FromSeconds(2) };
            using HttpResponseMessage response = await client.GetAsync($"{serverUrl.TrimEnd('/')}/health");
            return response.IsSuccessStatusCode ? ServerProbe.Ready : ServerProbe.Loading;
        }
        catch
        {
            return ServerProbe.Unavailable;
        }
    }

    private static ServerProbe ProbeServer(string serverUrl)
    {
        try
        {
            using HttpClient client = new() { Timeout = TimeSpan.FromSeconds(2) };
            using HttpResponseMessage response = client.GetAsync($"{serverUrl.TrimEnd('/')}/health")
                .GetAwaiter().GetResult();
            return response.IsSuccessStatusCode ? ServerProbe.Ready : ServerProbe.Loading;
        }
        catch
        {
            return ServerProbe.Unavailable;
        }
    }

    private static async Task<NativeResponse> WaitForReadyAsync(RuntimeConfig config, Stopwatch stopwatch)
    {
        DateTime deadline = DateTime.UtcNow.AddSeconds(Math.Clamp(config.StartupTimeoutSeconds, 15, 300));
        while (DateTime.UtcNow < deadline)
        {
            await Task.Delay(500);
            if (await ProbeServerAsync(config.ServerUrl) == ServerProbe.Ready)
            {
                return Success("ready", config.ServerUrl, stopwatch);
            }
        }
        return Failure("startTimeout", "模型加载超时，请检查运行时日志和显存是否足够", stopwatch);
    }

    private static void StartServerDetached(RuntimeConfig config, string serverPath, string modelPath)
    {
        string logDir = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "AnanChrome", "Logs");
        Directory.CreateDirectory(logDir);
        string stdoutLog = Path.Combine(logDir, "llama-server.log");
        string stderrLog = Path.Combine(logDir, "llama-server-error.log");
        string stdinFile = Path.Combine(logDir, "llama-server-stdin.txt");
        if (!File.Exists(stdinFile)) File.WriteAllText(stdinFile, string.Empty);

        string argumentLine = string.Join(' ', new[]
        {
            "--model", QuoteWindowsArgument(modelPath),
            "--port", config.Port.ToString(),
            "--ctx-size", config.ContextSize.ToString(),
            "--n-gpu-layers", config.GpuLayers.ToString(),
            "--host", "127.0.0.1"
        });

        string script = string.Join("; ", new[]
        {
            "$ErrorActionPreference='Stop'",
            $"Start-Process -FilePath '{EscapePowerShell(serverPath)}' " +
            $"-ArgumentList '{EscapePowerShell(argumentLine)}' " +
            $"-WorkingDirectory '{EscapePowerShell(Path.GetDirectoryName(serverPath)!)}' " +
            "-WindowStyle Hidden " +
            $"-RedirectStandardInput '{EscapePowerShell(stdinFile)}' " +
            $"-RedirectStandardOutput '{EscapePowerShell(stdoutLog)}' " +
            $"-RedirectStandardError '{EscapePowerShell(stderrLog)}'"
        });
        string encoded = Convert.ToBase64String(Encoding.Unicode.GetBytes(script));

        using Process? launcher = Process.Start(new ProcessStartInfo
        {
            FileName = "powershell.exe",
            Arguments = $"-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand {encoded}",
            // ShellExecute gives the short-lived launcher its own standard handles.
            // Otherwise llama-server can keep Chrome's native-messaging pipe open
            // after this runtime has already written its response.
            UseShellExecute = true,
            WindowStyle = ProcessWindowStyle.Hidden
        });
        if (launcher is null) throw new InvalidOperationException("无法创建模型启动进程");
        if (!launcher.WaitForExit(15_000)) throw new TimeoutException("模型启动器未及时返回");
        if (launcher.ExitCode != 0) throw new InvalidOperationException($"模型启动器退出码：{launcher.ExitCode}");
        AppendRuntimeLog($"llama-server launch requested: {serverPath}");
    }

    private static string QuoteWindowsArgument(string value)
    {
        return $"\"{value.Replace("\"", "\\\"")}\"";
    }

    private static string EscapePowerShell(string value) => value.Replace("'", "''");

    private static void AppendRuntimeLog(string line)
    {
        try
        {
            string dir = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "AnanChrome", "Logs");
            Directory.CreateDirectory(dir);
            File.AppendAllText(Path.Combine(dir, "runtime.log"), $"{DateTime.Now:O} {line}{Environment.NewLine}");
        }
        catch
        {
            // Logging must never break native messaging.
        }
    }

    private static NativeResponse Success(string status, string serverUrl, Stopwatch stopwatch) => new()
    {
        Ok = true,
        Status = status,
        ServerUrl = serverUrl,
        ElapsedMs = stopwatch.ElapsedMilliseconds
    };

    private static NativeResponse Failure(string status, string error, Stopwatch stopwatch) => new()
    {
        Ok = false,
        Status = status,
        Error = error,
        ElapsedMs = stopwatch.ElapsedMilliseconds
    };

    private static async Task<NativeRequest?> ReadNativeMessageAsync(Stream input)
    {
        byte[] lengthBuffer = new byte[4];
        int lengthRead = await ReadExactlyOrEofAsync(input, lengthBuffer);
        if (lengthRead == 0) return new NativeRequest();
        if (lengthRead != 4) throw new InvalidDataException("Native message length header is incomplete");

        int length = BitConverter.ToInt32(lengthBuffer, 0);
        if (length is <= 0 or > 1024 * 1024) throw new InvalidDataException("Native message length is invalid");
        byte[] payload = new byte[length];
        if (await ReadExactlyOrEofAsync(input, payload) != length) throw new EndOfStreamException("Native message is incomplete");
        return JsonSerializer.Deserialize<NativeRequest>(payload, JsonOptions);
    }

    private static async Task<int> ReadExactlyOrEofAsync(Stream stream, byte[] buffer)
    {
        int total = 0;
        while (total < buffer.Length)
        {
            int read = await stream.ReadAsync(buffer.AsMemory(total));
            if (read == 0) break;
            total += read;
        }
        return total;
    }

    private static async Task WriteNativeMessageAsync(Stream output, NativeResponse response)
    {
        byte[] payload = JsonSerializer.SerializeToUtf8Bytes(response, JsonOptions);
        byte[] length = BitConverter.GetBytes(payload.Length);
        await output.WriteAsync(length);
        await output.WriteAsync(payload);
        await output.FlushAsync();
    }
}
