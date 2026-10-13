# 在**精确**的 CSS 视口宽度下测量布局。
#
# 为什么不用 --window-size：Windows 上的无头 Chrome 有最小窗口宽度（约 500px），
# 请求 390 会被钳到 500，于是"390px 手机上好不好看"这件事一直测不了。
#
# 这个脚本把应用放进一个固定尺寸的 <iframe>：iframe 的 CSS 宽度就是我们要的宽度，
# 不受窗口最小宽度影响；而且同源，可以直接读 iframe 里的 DOM 与几何。
#
# 还会往应用副本里注入一个"驾驶员"：替我们点掉出生点选择、再选一颗骰子，
# 这样量到的是**真正的对局界面**（操作条上出现按钮、也就是它最高的时候），
# 而不是只有出生点弹层的状态。顺带也是"真实浏览器里点击处理器能工作"的验证。
#
# 用法：pwsh tools/measure-narrow.ps1 -Width 390 -Height 844
# 注意：.ps1 必须带 BOM 保存，否则 PowerShell 5.1 按 ANSI 解码，中文注释会解析坏。

param(
  [int]$Width = 390,
  [int]$Height = 844,
  [string]$DistDir = 'dist'
)

$ErrorActionPreference = 'Continue'
$repo = Split-Path $PSScriptRoot -Parent
$dist = Join-Path $repo $DistDir
if (-not (Test-Path $dist)) { Write-Host "找不到 $dist，请先 pnpm build"; exit 1 }

$work = Join-Path $repo '.tools\narrow-run'
Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path (Join-Path $work 'app') | Out-Null
Copy-Item (Join-Path $dist '*') (Join-Path $work 'app') -Recurse -Force

$appIndex = Join-Path $work 'app\index.html'
$appHtml = [System.IO.File]::ReadAllText($appIndex)
$driver = @'
<script>
(function () {
  function clickByText(text) {
    var buttons = Array.prototype.slice.call(document.querySelectorAll('button'));
    for (var i = 0; i < buttons.length; i += 1) {
      var label = buttons[i].textContent || '';
      if (label.indexOf(text) >= 0) { buttons[i].click(); return true; }
    }
    return false;
  }
  var step = 0;
  var timer = setInterval(function () {
    step += 1;
    if (step === 3) clickByText('用推荐的中央格');
    if (step === 9) { var die = document.querySelector('.die'); if (die) die.click(); }
    if (step > 24) clearInterval(timer);
  }, 300);
})();
</script>
</body>
'@
[System.IO.File]::WriteAllText($appIndex, ($appHtml -replace '</body>', $driver), (New-Object System.Text.UTF8Encoding($false)))

$wrapper = @"
<!doctype html>
<html><head><meta charset="utf-8"><title>PROBE|waiting</title>
<style>
  html,body{margin:0;padding:0;background:#222}
  iframe{width:${Width}px;height:${Height}px;border:0;display:block}
</style></head>
<body>
<iframe id="f" src="app/index.html"></iframe>
<script>
setTimeout(function () {
  var f = document.getElementById('f');
  var w = f.contentWindow, d = w.document;
  function m(sel) {
    var el = d.querySelector(sel);
    if (!el) return sel + '=null';
    var r = el.getBoundingClientRect();
    return sel + '=[x' + Math.round(r.left) + '-' + Math.round(r.right) +
      ' w' + Math.round(r.width) + ' h' + Math.round(r.height) + ']';
  }
  var over = [];
  d.querySelectorAll('*').forEach(function (el) {
    var r = el.getBoundingClientRect();
    if (r.width > 0 && (r.right > w.innerWidth + 1 || r.left < -1)) over.push(el.className || el.tagName);
  });
  document.title = 'PROBE|viewport=' + w.innerWidth + 'x' + w.innerHeight +
    '|scrollWidth=' + d.documentElement.scrollWidth +
    '|mounted=' + (d.querySelector('.hexboard') ? 'yes' : 'no') +
    '|inGame=' + (d.querySelector('.sheet__panel') ? 'no(仍是弹层)' : 'yes') +
    '|dice=' + d.querySelectorAll('.die').length +
    '|actionButtons=' + d.querySelectorAll('.actionbar__buttons .btn').length +
    '|' + m('.actionbar') + '|' + m('.mine .hexboard') + '|' + m('.depot') +
    '|' + m('.opponent') + '|overflowing=' + over.length +
    (over.length ? ' -> ' + over.slice(0, 5).join(' / ') : '');
}, 9000);
</script>
</body></html>
"@
[System.IO.File]::WriteAllText((Join-Path $work 'index.html'), $wrapper, (New-Object System.Text.UTF8Encoding($false)))

$py = 'C:\Users\danwei.zheng\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\python\python.exe'
$server = Start-Process -FilePath $py -ArgumentList @('-m','http.server','5195','--bind','127.0.0.1','--directory',$work) -NoNewWindow -PassThru
Start-Sleep -Seconds 3

$chrome = "$env:ProgramFiles\Google\Chrome\Application\chrome.exe"
$domPath = Join-Path $env:TEMP 'cob-narrow.html'
$profile = Join-Path $env:TEMP "cob-n-$(Get-Random)"
# 窗口开得足够大，保证 iframe 完整可见（CSS 视口宽度由 iframe 自己决定）
$args = @('--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check',
          "--user-data-dir=$profile",'--window-size=1200,1400','--virtual-time-budget=20000',
          '--dump-dom','http://127.0.0.1:5195/')
Start-Process -FilePath $chrome -ArgumentList $args -NoNewWindow -Wait -RedirectStandardOutput $domPath -RedirectStandardError (Join-Path $env:TEMP 'cob-n-err.txt')

Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue
Remove-Item $profile -Recurse -Force -ErrorAction SilentlyContinue

$dom = [System.IO.File]::ReadAllText($domPath, [System.Text.Encoding]::UTF8)
$match = [regex]::Match($dom, '<title>(PROBE\|.*?)</title>')
Write-Host ("iframe 尺寸 {0}x{1}" -f $Width, $Height)
if ($match.Success) {
  foreach ($part in ($match.Groups[1].Value -split '\|')) {
    if ($part -and $part -ne 'PROBE') { Write-Host ("  " + $part) }
  }
} else {
  Write-Host '  没拿到测量结果（应用可能没在 iframe 里挂载完）'
}
Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue
