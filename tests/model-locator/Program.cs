using AnanChrome.Runtime;

string root = Path.Combine(Path.GetTempPath(), "AnanChromeModelTest-" + Guid.NewGuid().ToString("N"));
Directory.CreateDirectory(root);
int passed = 0;
try
{
    string models = Path.Combine(root, "models");
    Directory.CreateDirectory(models);
    string fallback = Path.Combine(root, "old.gguf");
    File.WriteAllBytes(fallback, []);
    Check(ModelLocator.Resolve(models, fallback) == fallback, "empty directory preserves older model");
    Expect("modelMissing", () => ModelLocator.Resolve(models, ""));

    string first = Path.Combine(models, "任意模型名称.GGUF");
    File.WriteAllBytes(first, []);
    Check(ModelLocator.Resolve(models, fallback) == first, "single model overrides external fallback");
    File.WriteAllBytes(Path.Combine(models, "mmproj-test.gguf"), []);
    Check(ModelLocator.Resolve(models, "") == first, "projection is not selected as a model");
    string second = Path.Combine(models, "second.gguf");
    File.WriteAllBytes(second, []);
    Expect("multipleModels", () => ModelLocator.Resolve(models, fallback));
    Check(ModelLocator.Resolve("", fallback) == fallback, "explicit model mode");
    File.Delete(first);
    Check(ModelLocator.Resolve(models, "") == second, "replacement is discovered on next resolution");
    File.Delete(second);
    Expect("modelMissing", () => ModelLocator.Resolve(models, ""));
    Expect("modelDirectoryMissing", () => ModelLocator.Resolve(Path.Combine(root, "moved"), fallback));
    Expect("modelMissing", () => ModelLocator.Resolve("", Path.Combine(root, "missing.gguf")));
    Console.WriteLine($"PASS: {passed} model discovery checks");
}
finally
{
    // root is a freshly created, uniquely named test directory, never a user model path.
    Directory.Delete(root, recursive: true);
}

void Check(bool value, string label)
{
    if (!value) throw new Exception("FAIL: " + label);
    passed++;
}

void Expect(string status, Func<string> action)
{
    try { action(); }
    catch (ModelSelectionException ex) when (ex.Status == status) { passed++; return; }
    throw new Exception("Expected: " + status);
}
