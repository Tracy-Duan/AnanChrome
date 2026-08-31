using System.Diagnostics;
using System.Net;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text.Json;

namespace AnanChrome.Runtime;

internal sealed record DownloadState(string Status, long Bytes = 0, long Total = 0,
    string? Error = null, long UpdatedAt = 0);

internal static class ModelDownload
{
    public const string FileName = "Qwen3.5-9B-Uncensored-HauhauCS-Aggressive-Q4_K_M.gguf";
    public const string Url = "https://huggingface.co/HauhauCS/Qwen3.5-9B-Uncensored-HauhauCS-Aggressive/resolve/main/" + FileName + "?download=true";
    public const string Sha256 = "2ca636d9e81d3d23ca9b60c234fe185d30ec082eeba69ce770fdb0c76559a4f5";
    private static readonly string Root = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "AnanChrome", "Models");
    private static readonly string Destination = Path.Combine(Root, FileName);
    private static readonly string StatePath = Path.Combine(Root, "download-state.json");
    private static readonly string LockPath = Path.Combine(Root, "download.lock");

    private static FileStream? TryLock()
    {
        Directory.CreateDirectory(Root);
        try { return new FileStream(LockPath, FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None); }
        catch (IOException) { return null; }
    }

    private static DownloadState ReadState()
    {
        try { return JsonSerializer.Deserialize<DownloadState>(File.ReadAllText(StatePath)) ?? new("notDownloaded"); }
        catch { return new("notDownloaded"); }
    }

    private static void WriteState(DownloadState state)
    {
        var value = state with { UpdatedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() };
        File.WriteAllText(StatePath + ".tmp", JsonSerializer.Serialize(value));
        File.Move(StatePath + ".tmp", StatePath, overwrite: true);
    }

    public static DownloadState Status()
    {
        var state = ReadState();
        if (state.Status == "ready" && (!File.Exists(Destination) || new FileInfo(Destination).Length != state.Total))
            return new("notDownloaded");
        if (state.Status is "queued" or "downloading" or "verifying")
        {
            using var gate = TryLock();
            if (gate is not null && DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() - state.UpdatedAt > 15000)
                return state with { Status = "interrupted", Error = "下载已中断，点击继续下载即可续传。" };
        }
        return state;
    }

    public static DownloadState Start()
    {
        var existing = Status();
        if (existing.Status is "ready" or "queued" or "downloading" or "verifying") return existing;
        using (var gate = TryLock())
        {
            if (gate is null) return ReadState();
            existing = ReadState();
            if (existing.Status == "queued" && DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() - existing.UpdatedAt < 15000) return existing;
            WriteState(new("queued"));
        }
        try
        {
            // Shell launch keeps a long download independent of the native message pipe.
            using var process = Process.Start(new ProcessStartInfo {
                FileName = Environment.ProcessPath!, Arguments = "--download-model",
                UseShellExecute = true, WindowStyle = ProcessWindowStyle.Hidden
            });
            if (process is null) throw new IOException("无法启动下载进程");
        }
        catch (Exception ex) { WriteState(new("error", Error: ex.Message)); }
        return ReadState();
    }

    public static async Task<int> RunAsync()
    {
        using var gate = TryLock();
        if (gate is null) return 0;
        try
        {
            using HttpClient client = new() { Timeout = Timeout.InfiniteTimeSpan };
            await TransferAsync(client, Url, Destination, Sha256, WriteState);
            Program.SelectDownloadedModel(Destination);
            long size = new FileInfo(Destination).Length;
            WriteState(new("ready", size, size));
            return 0;
        }
        catch (Exception ex)
        {
            long bytes = File.Exists(Destination + ".part") ? new FileInfo(Destination + ".part").Length : 0;
            WriteState(new("error", bytes, Error: $"下载未完成：{ex.Message}。点击继续下载重试。"));
            return 1;
        }
    }

    // Fixed URL/hash in the native entry point. Injectable here only for local tests.
    internal static async Task TransferAsync(HttpClient client, string url, string destination, string hash, Action<DownloadState> progress)
    {
        if (File.Exists(destination))
        {
            progress(new("verifying"));
            if (await HasHashAsync(destination, hash)) return;
        }
        string partial = destination + ".part";
        long offset = File.Exists(partial) ? new FileInfo(partial).Length : 0;
        using var request = new HttpRequestMessage(HttpMethod.Get, url);
        if (offset > 0) request.Headers.Range = new RangeHeaderValue(offset, null);
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(90));
        using var response = await client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, timeout.Token);
        if (response.StatusCode == HttpStatusCode.RequestedRangeNotSatisfiable && offset > 0)
        {
            progress(new("verifying", offset, offset));
            if (await HasHashAsync(partial, hash)) { File.Move(partial, destination, true); return; }
            File.Delete(partial);
            throw new InvalidDataException("未完成文件已失效，已清理，请重试");
        }
        if (!response.IsSuccessStatusCode)
            throw new HttpRequestException(response.StatusCode == HttpStatusCode.TooManyRequests
                ? "模型下载站暂时限流（HTTP 429），请稍后重试"
                : $"模型下载站返回 HTTP {(int)response.StatusCode}，暂时无法下载", null, response.StatusCode);
        bool resume = offset > 0 && response.StatusCode == HttpStatusCode.PartialContent;
        if (resume && response.Content.Headers.ContentRange?.From != offset)
            throw new InvalidDataException("服务器返回了不匹配的续传范围");
        if (!resume) offset = 0; // Server ignored Range: restart, never append a full response.
        long total = offset + (response.Content.Headers.ContentLength ?? 0);
        long written = offset;
        progress(new("downloading", written, total));
        using (var output = new FileStream(partial, resume ? FileMode.Append : FileMode.Create, FileAccess.Write, FileShare.Read, 1048576, true))
        using (var input = await response.Content.ReadAsStreamAsync())
        {
            byte[] buffer = new byte[1048576];
            var clock = Stopwatch.StartNew();
            while (true)
            {
                using var readTimeout = new CancellationTokenSource(TimeSpan.FromSeconds(90));
                int count = await input.ReadAsync(buffer, readTimeout.Token);
                if (count == 0) break;
                await output.WriteAsync(buffer.AsMemory(0, count)); written += count;
                if (clock.ElapsedMilliseconds >= 1000) { progress(new("downloading", written, total)); clock.Restart(); }
            }
        }
        progress(new("verifying", written, total));
        if (!await HasHashAsync(partial, hash))
        {
            File.Delete(partial); // Only this downloader's corrupt temporary file.
            throw new InvalidDataException("模型 SHA-256 校验失败，未启用该文件");
        }
        File.Move(partial, destination, overwrite: true);
    }

    private static async Task<bool> HasHashAsync(string path, string expected)
    {
        using var stream = File.OpenRead(path);
        return Convert.ToHexString(await SHA256.HashDataAsync(stream)).Equals(expected, StringComparison.OrdinalIgnoreCase);
    }
}
