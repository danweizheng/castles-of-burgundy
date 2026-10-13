# 在真实浏览器里量线上/本地产物的布局几何。
#
# 为什么要这么做：截图只能靠肉眼（还得靠模型转述），而布局问题大多是"某个元素超出了视口"
# 这类可以量化的事。这个脚本把探针脚本注入 dist/index.html 的副本，
# 用无头 Chrome 打开，然后把测量结果从 <title> 里读回来。
#
# 用法：
#   pwsh tools/measure-layout.ps1 -Width 390 -Height 844
#   pwsh tools/measure-layout.ps1 -Width 844 -Height 390 -Scale 2

param(
  [int]$Width = 390,
  [int]$Height = 844,
  [int]$Scale = 1,
  [string]$DistDir = 'dist'
)

$ErrorActionPreference = 'Continue'
$repo = Split-Path $PSScriptRoot -Parent
$dist = Join-Path $repo $DistDir
if (-not (Test-Path $dist)) { Write-Host "找不到 $dist，请先 pnpm build"; exit 1 }

$work = Join-Path $repo '.tools\measure-run'
Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue
Copy-Item $dist $work -Recurse

$indexPath = Join-Path $work 'index.html'
$html = [System.IO.File]::ReadAllText($indexPath)
$probe = @'
<script>
setTimeout(function () {
  function m(sel) { var el = document.querySelector(sel); if (!el) return "null";
    var r = el.getBoundingClientRect();
    return "x" + Math.round(r.left) + "-" + Math.round(r.right) + " w" + Math.round(r.width) + " h" + Math.round(r.height); }
  var over = [];
  document.querySelectorAll("*").forEach(function (el) {
    var r = el.getBoundingClientRect();
    if (r.width > 0 && (r.right > window.innerWidth + 1 || r.left < -1)) over.push(el.className || el.tagName);
  });
  var p = document.querySelector(".sheet__panel p");
  var pLines = 0;
  if (p) { pLines = Math.round(p.getBoundingClientRect().height / parseFloat(getComputedStyle(p).lineHeight)); }
  document.title = "PROBE|viewport=" + window.innerWidth + "x" + window.innerHeight +
    "|scrollWidth=" + document.documentElement.scrollWidth +
    "|panel=" + m(".sheet__panel") + "|setupTextLines=" + pLines +
    "|depotRow=" + m(".depot") + "|myBoard=" + m(".mine .hexboard") +
    "|oppBoard=" + m(".opponent .hexboard") + "|actionBar=" + m(".actionbar") +
    "|screen=" + m(".screen") + "|overflowing=" + over.length +
    (over.length ? " -> " + over.slice(0, 6).join(" / ") : "");
}, 2600);
</script>
</body>
'@
[System.IO.File]::WriteAllText($indexPath, ($html -replace '</body>', $probe), (New-Object System.Text.UTF8Encoding($false)))

$py = 'C:\Users\danwei.zheng\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\python\python.exe'
$server = Start-Process -FilePath $py -ArgumentList @('-m','http.server','5196','--bind','127.0.0.1','--directory',$work) -NoNewWindow -PassThru
Start-Sleep -Seconds 3

$chrome = "$env:ProgramFiles\Google\Chrome\Application\chrome.exe"
$domPath = Join-Path $env:TEMP 'cob-measure.html'
$profile = Join-Path $env:TEMP "cob-m-$(Get-Random)"
$args = @('--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check',
          "--user-data-dir=$profile",('--window-size=' + $Width + ',' + $Height),
          ('--force-device-scale-factor=' + $Scale),
          '--virtual-time-budget=9000','--dump-dom','http://127.0.0.1:5196/')
Start-Process -FilePath $chrome -ArgumentList $args -NoNewWindow -Wait -RedirectStandardOutput $domPath -RedirectStandardError (Join-Path $env:TEMP 'cob-m-err.txt')

Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue
Remove-Item $profile -Recurse -Force -ErrorAction SilentlyContinue

$dom = [System.IO.File]::ReadAllText($domPath, [System.Text.Encoding]::UTF8)
$match = [regex]::Match($dom, '<title>(PROBE\|.*?)</title>')
Write-Host ("请求窗口 {0}x{1} (scale {2})" -f $Width, $Height, $Scale)
if ($match.Success) {
  foreach ($part in ($match.Groups[1].Value -split '\|')) {
    if ($part -and $part -ne 'PROBE') { Write-Host ("  " + $part) }
  }
} else {
  Write-Host '  没拿到测量结果（页面可能没挂载完）'
}
Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue
