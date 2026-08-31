namespace AnanChrome.Runtime;

internal sealed class ModelSelectionException(string status, string message) : Exception(message)
{
    public string Status { get; } = status;
}

internal static class ModelLocator
{
    public static string Resolve(string modelDirectory, string fallbackModelPath)
    {
        if (!string.IsNullOrWhiteSpace(modelDirectory))
        {
            string directory = Path.GetFullPath(Environment.ExpandEnvironmentVariables(modelDirectory));
            if (!Directory.Exists(directory))
                throw new ModelSelectionException("modelDirectoryMissing",
                    $"模型目录不存在：{directory}。如果移动了项目，请重新运行 Setup-AnanChrome.cmd 配置一次。");

            string[] models = Directory.EnumerateFiles(directory, "*", SearchOption.TopDirectoryOnly)
                .Where(path => Path.GetExtension(path).Equals(".gguf", StringComparison.OrdinalIgnoreCase))
                .Where(path => !Path.GetFileName(path).StartsWith("mmproj", StringComparison.OrdinalIgnoreCase))
                .OrderBy(path => path, StringComparer.OrdinalIgnoreCase).ToArray();
            if (models.Length == 1) return models[0];
            if (models.Length > 1)
                throw new ModelSelectionException("multipleModels",
                    $"模型目录中有 {models.Length} 个 GGUF 主模型，请只保留一个，或用配置脚本的 -ModelPath 指定文件：{directory}");
        }

        if (!string.IsNullOrWhiteSpace(fallbackModelPath))
        {
            string fallback = Path.GetFullPath(Environment.ExpandEnvironmentVariables(fallbackModelPath));
            if (File.Exists(fallback)) return fallback;
        }

        throw new ModelSelectionException("modelMissing", string.IsNullOrWhiteSpace(modelDirectory)
            ? "尚未下载模型，请打开设置，点击“下载模型”。已有 GGUF 也可通过项目配置入口选用。"
            : $"尚未下载模型，请打开设置，点击“下载模型”；也可将完整 GGUF 放入：{modelDirectory}。");
    }
}
