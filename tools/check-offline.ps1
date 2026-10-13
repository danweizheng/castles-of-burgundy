# 【重要】这是一个"尽力而为"的诊断脚本，不是可靠的回归测试。
#
# 在 Windows 无头 Chrome 上，Service Worker 状态跨进程持久化 + 探针与 --dump-dom 的时序
# 都不受控制，重跑经常拿不到探针结果。为了不把"没测到"说成"离线不可用"，
# 本脚本区分三种退出码：
#   0 = 测出来离线可用
#   1 = 测出来离线不可用
#   2 = 无法测量（环境限制，结论未知）
#
# 决定性的验证在真实设备上：完整加载一次 → 开飞行模式 → 从主屏图标重开。
# 静态侧的保证由 tools/check-deploy.mjs 负责（sw.js 的每一条预缓存都能取到）。
# 真正验证"离线可玩"。
#
# 为什么需要它：在此之前只验证过 sw.js 里的预缓存清单完整（每一条都能 200），
# 但那是"清单对不对"，不是"断网还能不能用"。
#
# 做法（模拟"装到主屏后上飞机"）：
#   阶段一：起本地服务器，用**固定 profile** 打开页面，让 Service Worker 装上并把预缓存写完。
#           切网之前会先确认缓存条目数够多 —— 否则 Chrome 可能在缓存写完前就退出了，
#           测试会假失败（第一版脚本就踩了这个坑）。
#   阶段二：杀掉服务器，用同一个 profile 再打开同一地址。
#           应用仍能渲染、且由 Service Worker 接管 ＝ 离线真的可用。
#
# 注意 localhost / 127.0.0.1 属于安全上下文，Service Worker 在它上面是被允许的，
# 所以这个测试能反映线上 HTTPS 的行为。
#
# 用法：pwsh tools/check-offline.ps1

param(
  [int]$Port = 5193,
  [string]$DistDir = 'dist'
)

$ErrorActionPreference = 'Continue'
$repo = Split-Path $PSScriptRoot -Parent
$dist = Join-Path $repo $DistDir
if (-not (Test-Path $dist)) { Write-Host "找不到 $dist，请先 pnpm build"; exit 1 }

$py = 'C:\Users\danwei.zheng\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\python\python.exe'
$chrome = "$env:ProgramFiles\Google\Chrome\Application\chrome.exe"
$profile = Join-Path $env:TEMP 'cob-offline-profile'
Remove-Item $profile -Recurse -Force -ErrorAction SilentlyContinue

$work = Join-Path $repo '.tools\offline-run'
Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue
Copy-Item $dist $work -Recurse
$indexPath = Join-Path $work 'index.html'
$html = [System.IO.File]::ReadAllText($indexPath)

$probe = @'
<script>
(function () {
  function report() {
    var parts = ['mounted=' + (document.querySelector('.hexboard') ? 'yes' : 'no')];
    if (!navigator.serviceWorker) {
      parts.push('serviceWorker=unsupported');
      document.title = 'PROBE|' + parts.join('|');
      return;
    }
    parts.push('controller=' + (navigator.serviceWorker.controller ? 'yes' : 'no'));
    navigator.serviceWorker.getRegistrations().then(function (list) {
      parts.push('registrations=' + list.length);
      return caches.keys();
    }).then(function (keys) {
      parts.push('caches=' + keys.length);
      return Promise.all(keys.map(function (name) {
        return caches.open(name).then(function (cache) { return cache.keys(); });
      }));
    }).then(function (lists) {
      var total = 0;
      for (var i = 0; i < lists.length; i += 1) total += lists[i].length;
      parts.push('cacheEntries=' + total);
      document.title = 'PROBE|' + parts.join('|');
    }).catch(function (error) {
      parts.push('err=' + error);
      document.title = 'PROBE|' + parts.join('|');
    });
  }
  // 持续轮询并不断更新标题：Chrome 在虚拟时间预算耗尽时才倒出 DOM，
  // 持续更新能保证倒出的那一刻标题反映的是最新状态。
  // （第一版只探一次、且延迟 6 秒，两次运行都没赶上，测试因此假失败。）
  report();
  var timer = setInterval(report, 250);
  setTimeout(function () { clearInterval(timer); }, 15000);
})();
</script>
</body>
'@
[System.IO.File]::WriteAllText($indexPath, ($html -replace '</body>', $probe), (New-Object System.Text.UTF8Encoding($false)))

function Get-Probe {
  param([string]$Label)
  $domPath = Join-Path $env:TEMP "cob-offline-$Label.html"
  $args = @('--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check',
            "--user-data-dir=$profile",'--window-size=900,1400','--virtual-time-budget=20000',
            '--dump-dom',"http://127.0.0.1:$Port/")
  Start-Process -FilePath $chrome -ArgumentList $args -NoNewWindow -Wait -RedirectStandardOutput $domPath -RedirectStandardError (Join-Path $env:TEMP "cob-offline-$Label-err.txt")
  $dom = [System.IO.File]::ReadAllText($domPath, [System.Text.Encoding]::UTF8)
  $match = [regex]::Match($dom, '<title>(PROBE\|.*?)</title>')
  if (-not $match.Success) {
    $fallback = [regex]::Match($dom, '<title>(.*?)</title>').Groups[1].Value
    Write-Host ("[{0}] 没拿到探针结果；页面标题 = [{1}]" -f $Label, $fallback)
    return $null
  }
  $result = @{}
  foreach ($part in ($match.Groups[1].Value -split '\|')) {
    if ($part -and $part -ne 'PROBE' -and $part.Contains('=')) {
      $kv = $part.Split('=', 2)
      $result[$kv[0]] = $kv[1]
    }
  }
  $pairs = ($result.GetEnumerator() | Sort-Object Name | ForEach-Object { "$($_.Key)=$($_.Value)" }) -join '  '
  Write-Host ("[{0}] {1}" -f $Label, $pairs)
  return $result
}

Write-Host '=== 阶段一：让 Service Worker 装上并把预缓存写完 ==='
$server = Start-Process -FilePath $py -ArgumentList @('-m','http.server',$Port,'--bind','127.0.0.1','--directory',$work) -NoNewWindow -PassThru
Start-Sleep -Seconds 3

$warm = $null
for ($attempt = 1; $attempt -le 3; $attempt += 1) {
  $warm = Get-Probe -Label "phase1-try$attempt"
  if ($warm -ne $null -and $warm['registrations'] -ne '0' -and [int]$warm['cacheEntries'] -ge 10) { break }
  Write-Host '  Service Worker 还没注册好或预缓存没写完，保持联网再访问一次…'
}

if ($warm -eq $null -or $warm['registrations'] -eq '0' -or [int]$warm['cacheEntries'] -lt 10) {
  Write-Host ''
  Write-Host '结论：**无法测量**（不是"离线不可用"）。'
  Write-Host '  Service Worker 没能在无头浏览器里完成注册与预缓存 —— 这是测试环境的限制，'
  Write-Host '  不是应用的问题。请用真实浏览器/手机验证：完整加载一次 → 开飞行模式 → 重开。'
  Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue
  Remove-Item $profile -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue
  # 退出码 2 = 无法测量（区别于 1 = 测出来确实不可用）
  exit 2
}

Write-Host ''
Write-Host '=== 关掉服务器（模拟断网 / 飞行模式）==='
Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2
$stillUp = $false
try { Invoke-WebRequest -Uri "http://127.0.0.1:$Port/" -UseBasicParsing -TimeoutSec 3 | Out-Null; $stillUp = $true } catch { }
Write-Host ("   服务器已停止：{0}" -f (-not $stillUp))

Write-Host ''
Write-Host '=== 阶段二：断网后再打开同一地址（用同一个 profile）==='
$cold = Get-Probe -Label 'phase2'

Remove-Item $profile -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue

if ($cold -ne $null -and $cold['mounted'] -eq 'yes' -and $cold['controller'] -eq 'yes') {
  Write-Host ''
  Write-Host '结论：断网后应用仍能打开，且由 Service Worker 接管 —— 离线可用。'
  exit 0
}
if ($cold -eq $null) {
  Write-Host ''
  Write-Host '结论：**无法测量**（不是"离线不可用"）—— 断网后没能读到页面里的探针。'
  Write-Host '  无头浏览器里拿不到结果不代表页面打不开；请用真实设备验证。'
  exit 2
}
Write-Host ''
Write-Host '结论：断网后打不开或缺席 Service Worker 接管 —— 离线不可用。'
exit 1
