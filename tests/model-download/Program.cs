using System.Net;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using AnanChrome.Runtime;

if (args.Contains("--check-source")) {
    using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(30) };
    using var request = new HttpRequestMessage(HttpMethod.Head, ModelDownload.Url);
    using var response = await client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead);
    response.EnsureSuccessStatusCode();
    Console.WriteLine($"Model source HEAD: {(int)response.StatusCode}, bytes={response.Content.Headers.ContentLength}. No weights downloaded.");
    return;
}

string root = Path.Combine(Path.GetTempPath(), "AnanChromeDownloadTest-" + Guid.NewGuid().ToString("N"));
Directory.CreateDirectory(root);
byte[] payload = "synthetic GGUF test data, not a real model"u8.ToArray();
string hash = Convert.ToHexString(SHA256.HashData(payload));
string target = Path.Combine(root, "test.gguf");
int passed = 0;
try
{
    async Task Run(HttpMessageHandler handler) {
        using HttpClient client = new(handler);
        await ModelDownload.TransferAsync(client, "http://test.local/model", target, hash, _ => {});
    }
    HttpResponseMessage Body(byte[] bytes, HttpStatusCode code = HttpStatusCode.OK) => new(code) { Content = new ByteArrayContent(bytes) };
    void Check(bool ok, string name) { if (!ok) throw new Exception(name); passed++; }

    await Run(new Handler(_ => Body(payload)));
    Check(File.ReadAllBytes(target).SequenceEqual(payload), "fresh download verifies and promotes");
    await Run(new Handler(_ => throw new Exception("valid existing file must not redownload")));
    Check(File.Exists(target), "valid existing model reused");
    File.Delete(target);
    File.WriteAllBytes(target + ".part", payload[..7]);
    await Run(new Handler(request => {
        Check(request.Headers.Range?.Ranges.Single().From == 7, "resume uses exact byte offset");
        var response = Body(payload[7..], HttpStatusCode.PartialContent);
        response.Content.Headers.ContentRange = new ContentRangeHeaderValue(7, payload.Length - 1, payload.Length);
        return response;
    }));
    Check(File.ReadAllBytes(target).SequenceEqual(payload), "resumed file is exact");
    File.Delete(target); File.WriteAllBytes(target + ".part", payload[..7]);
    await Run(new Handler(_ => Body(payload)));
    Check(File.ReadAllBytes(target).SequenceEqual(payload), "ignored Range restarts without duplicate prefix");
    File.Delete(target); File.WriteAllBytes(target + ".part", payload);
    await Run(new Handler(_ => Body([], HttpStatusCode.RequestedRangeNotSatisfiable)));
    Check(File.Exists(target), "complete partial at 416 is verified and promoted");
    File.Delete(target); File.WriteAllBytes(target + ".part", payload[..7]);
    try { await Run(new Handler(_ => Body([], HttpStatusCode.Forbidden))); throw new Exception("expected HTTP failure"); }
    catch (HttpRequestException) { Check(new FileInfo(target + ".part").Length == 7, "network failure preserves resume file"); }
    try { await Run(new Handler(_ => Body([], HttpStatusCode.TooManyRequests))); throw new Exception("expected rate limit"); }
    catch (HttpRequestException ex) { Check(ex.Message.Contains("限流"), "rate limits explain retry in Chinese"); }
    try { await Run(new Handler(_ => {
        var response = Body(payload, HttpStatusCode.PartialContent);
        response.Content.Headers.ContentRange = new ContentRangeHeaderValue(0, payload.Length - 1, payload.Length);
        return response;
    })); throw new Exception("expected mismatched range"); }
    catch (InvalidDataException) { Check(new FileInfo(target + ".part").Length == 7, "bad Content-Range never corrupts partial"); }
    File.Delete(target + ".part"); File.WriteAllText(target, "old model must survive bad download");
    try { await Run(new Handler(_ => Body("corrupt"u8.ToArray()))); throw new Exception("expected hash failure"); }
    catch (InvalidDataException) {
        Check(File.ReadAllText(target) == "old model must survive bad download", "bad download never replaces old model");
        Check(!File.Exists(target + ".part"), "corrupt partial is removed");
    }
    Console.WriteLine($"PASS: {passed} model download checks (synthetic bytes, no real weights downloaded)");
}
finally { Directory.Delete(root, true); }

sealed class Handler(Func<HttpRequestMessage, HttpResponseMessage> respond) : HttpMessageHandler {
    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) => Task.FromResult(respond(request));
}
namespace AnanChrome.Runtime { internal static class Program { public static void SelectDownloadedModel(string path) => throw new Exception("Unit tests must not touch installed config"); } }
