const { spawn } = require('node:child_process');
const path = require('node:path');
const assert = require('node:assert/strict');
const exe = path.join(__dirname, '../runtime/dist/win-x64/AnanChromeRuntime.exe');
function request(action) {
  return new Promise((resolve, reject) => {
    const child = spawn(exe, ['chrome-extension://padicgoaheglbafnjjbjaooakfdcjfmi/'], { windowsHide: true });
    const chunks = []; let stderr = '';
    child.stdout.on('data', data => chunks.push(data)); child.stderr.on('data', data => { stderr += data; });
    child.on('error', reject);
    child.on('close', () => {
      try {
        const data = Buffer.concat(chunks); assert.equal(data.readUInt32LE(0), data.length - 4, stderr);
        resolve(JSON.parse(data.subarray(4).toString()));
      } catch (error) { reject(error); }
    });
    const payload = Buffer.from(JSON.stringify({ action })); const header = Buffer.alloc(4); header.writeUInt32LE(payload.length);
    child.stdin.end(Buffer.concat([header, payload]));
  });
}
(async () => {
  const status = await request('modelDownloadStatus'); assert.equal(status.ok, true); assert.ok(status.download.status);
  const unknown = await request('unrecognized-test-action'); assert.equal(unknown.status, 'unsupportedAction'); assert.equal(unknown.ok, false);
  console.log('PASS: built native host returns framed download status; unknown actions do not start the server.');
})().catch(error => { console.error(error); process.exitCode = 1; });
