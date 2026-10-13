# 真实浏览器里的完整对局冒烟测试。
#
# 为什么需要它：jsdom 能验证状态机与接线，但**验证不了"在真浏览器的真实布局与事件系统里
# 能不能把一整局点完"** —— SVG 六边形能不能点、按钮会不会被别的元素盖住、点了之后
# React 会不会更新，这些只有真浏览器能回答。
#
# 关键手法：用 --virtual-time-budget 让 Chrome **快进定时器**。AI 每步要等 300ms，
# 实时跑完一局要一分多钟；虚拟时间下这些等待瞬间走完，于是整局可以在几秒内跑完。
#
# 脚本注入一个"自动驾驶"：反复执行
#   有结算面板 → 结束
#   选中的骰子有可点仓库格 → 点它
#   选中的骰子有可点领地格 → 点它
#   还有骰子 → 点第一颗
#   有"结束回合" → 点它
#   有"取 2 个工人" → 点它
# 并监视"进度签名"（面板数/骰子数/按钮数/点亮数/正文长度）连续不变时判定卡住。
#
# 用法：pwsh tools/smoke-play.ps1

param(
  [int]$Width = 390,
  [int]$Height = 844,
  [string]$DistDir = 'dist'
)

$ErrorActionPreference = 'Continue'
$repo = Split-Path $PSScriptRoot -Parent
$dist = Join-Path $repo $DistDir
if (-not (Test-Path $dist)) { Write-Host "找不到 $dist，请先 pnpm build"; exit 1 }

$work = Join-Path $repo '.tools\smoke-run'
Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path (Join-Path $work 'app') | Out-Null
Copy-Item (Join-Path $dist '*') (Join-Path $work 'app') -Recurse -Force

$driver = @'
<script>
window.__smoke = { ticks: 0, clicks: 0, stuck: 0, lastSignature: '', done: false, error: null };
(function () {
  var S = window.__smoke;
  function all(sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); }
  function enabled(sel) {
    return all(sel).filter(function (el) { return !el.disabled && el.offsetParent !== null; });
  }
  // click() 是 HTMLElement 的方法，**SVG 元素没有** —— 领地六边形是 SVG，
  // 所以统一走派发事件这条路。
  function clickEl(el) {
    if (typeof el.click === 'function') { el.click(); return; }
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  }
  function byText(text) {
    return all('button').filter(function (b) {
      return !b.disabled && (b.textContent || '').indexOf(text) >= 0;
    })[0];
  }
  function signature() {
    return [
      all('.scorecard').length,
      all('.die').length,
      all('.actionbar__buttons button').length,
      all('.slot--target').length,
      all('.hex--target').length,
      document.body.textContent.length
    ].join('|');
  }
  function tick() {
    if (S.done) return;
    S.ticks += 1;
    // 上限与周期性进度上报：否则"没打完"时什么诊断都拿不到
    if (S.ticks > 4000) {
      S.done = true;
      document.title = 'SMOKE|finished=no|cap=yes|' + report();
      return;
    }
    if (S.ticks % 20 === 0) {
      document.title = 'SMOKE|finished=no|progress|' + report();
    }
    try {
      if (all('.scorecard').length > 0) {
        S.done = true;
        document.title = 'SMOKE|finished=yes|' + report();
        return;
      }
      // 浮层优先：modal 打开时必须先处理它。
      // 注意 element.click() **会绕过浮层的命中测试**（真实手指点不到底下的元素），
      // 所以不先处理浮层的话，脚本会一直去点被盖住的骰子、永远出不来。
      var sheet = document.querySelector('.sheet__panel');
      if (sheet) {
        var startCastle = byText('用推荐的中央格');
        if (startCastle) { clickEl(startCastle); S.clicks += 1; return; }
        // 多选一的选择框：点第一个可选项
        var option = sheet.querySelector('button:not([disabled])');
        if (option) { clickEl(option); S.clicks += 1; return; }
        S.done = true;
        var sheetTitle = sheet.querySelector('.sheet__title');
        document.title = 'SMOKE|finished=no|sheetStuck=' + (sheetTitle ? sheetTitle.textContent : '?');
        return;
      }

      // 有可点区域就直接点。它出现在两种情况：选过骰子之后，以及**待处理选择**时
      // （后者界面不给骰子也不给按钮，只点亮若干格；早先只在"已选骰子"时才点，
      //   于是卡死在"请先解决上面的选择"上出不来）。
      // 船只效果要选"哪个货物格"（.goodsbin--target）。早先漏了这一类，卡在只点亮货物格的状态上。
      var goods = all('.goodsbin--target')[0];
      if (goods) { clickEl(goods); S.clicks += 1; return; }
      var slot = enabled('.slot--target')[0];
      if (slot) { clickEl(slot); S.clicks += 1; return; }
      var hex = all('.hex--target')[0];
      if (hex) { clickEl(hex); S.clicks += 1; return; }
      // 仓库效果要选"卖哪一种货物"（.goodschip--target）。漏了这一类同样会卡住。
      var chip = all('.goodschip--target')[0];
      if (chip) { clickEl(chip); S.clicks += 1; return; }
      // 已选骰子却无可点区域：取工人永远合法，用它把这颗骰子花掉
      if (document.querySelector('.die--selected')) {
        var workers = byText('取 2 个工人');
        if (workers) { clickEl(workers); S.clicks += 1; return; }
      }
      var die = enabled('.die')[0];
      if (die) { clickEl(die); S.clicks += 1; return; }
      var endTurn = byText('结束回合');
      if (endTurn) { clickEl(endTurn); S.clicks += 1; return; }

      // 没有可点的东西：可能是对手在思考，也可能真的卡住了
      var sig = signature();
      if (sig === S.lastSignature) {
        S.stuck += 1;
        if (S.stuck > 60) {
          S.done = true;
          document.title = 'SMOKE|finished=no|stuck=yes|' + report();
        }
      } else {
        S.lastSignature = sig;
        S.stuck = 0;
      }
    } catch (error) {
      S.done = true;
      S.error = String(error);
      document.title = 'SMOKE|finished=no|error=' + String(error);
    }
  }
  function report() {
    var cards = all('.scorecard');
    var scores = [];
    for (var i = 0; i < cards.length; i += 1) {
      scores.push((cards[i].textContent || '').replace(/\s+/g, ' ').slice(0, 60));
    }
    function text(sel) {
      var el = document.querySelector(sel);
      return el ? (el.textContent || '').replace(/\s+/g, ' ').slice(0, 80) : 'none';
    }
    return 'ticks=' + S.ticks + '|clicks=' + S.clicks +
      '|dice=' + all('.die').length +
      '|actionBtns=' + all('.actionbar__buttons button').length +
      '|litSlots=' + all('.slot--target').length +
      '|litHexes=' + all('.hex--target').length +
      '|topText=' + text('.topbar') +
      '|barText=' + text('.actionbar') +
      '|title=' + (document.querySelector('.sheet__title') ? document.querySelector('.sheet__title').textContent : 'none') +
      '|scorecards=' + cards.length +
      '|scores=' + scores.join(' /// ') +
      '|alive=' + (document.querySelector('.hexboard') ? 'yes' : 'no') +
      '|crash=' + (document.querySelector('.crash') ? 'yes' : 'no');
  }
  setInterval(tick, 60);
})();
</script>
</body>
'@
$appIndex = Join-Path $work 'app\index.html'
[System.IO.File]::WriteAllText($appIndex, ([System.IO.File]::ReadAllText($appIndex) -replace '</body>', $driver), (New-Object System.Text.UTF8Encoding($false)))

$wrapper = @"
<!doctype html>
<html><head><meta charset="utf-8"><title>waiting</title>
<style>html,body{margin:0;padding:0;background:#222}iframe{width:${Width}px;height:${Height}px;border:0;display:block}</style>
</head><body>
<iframe id="f" src="app/index.html"></iframe>
<script>
// 把 iframe 里驾驶脚本写进自己的 title —— 外层拿到的就是最终报告
setInterval(function () {
  var w = document.getElementById('f').contentWindow;
  if (!w) return;
  var t = w.document.title || '';
  if (t.indexOf('SMOKE|') === 0) document.title = t;
}, 200);
</script>
</body></html>
"@
[System.IO.File]::WriteAllText((Join-Path $work 'index.html'), $wrapper, (New-Object System.Text.UTF8Encoding($false)))

$py = 'C:\Users\danwei.zheng\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\python\python.exe'
$server = Start-Process -FilePath $py -ArgumentList @('-m','http.server','5188','--bind','127.0.0.1','--directory',$work) -NoNewWindow -PassThru
Start-Sleep -Seconds 3

$chrome = "$env:ProgramFiles\Google\Chrome\Application\chrome.exe"
$domPath = Join-Path $env:TEMP 'cob-smoke.html'
$profile = Join-Path $env:TEMP "cob-smoke-$(Get-Random)"
# 虚拟时间放大到 15 分钟：AI 的每步 300ms 等待会被快进掉
$args = @('--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check',
          "--user-data-dir=$profile",'--window-size=900,1400','--virtual-time-budget=900000',
          '--dump-dom','http://127.0.0.1:5188/')
Start-Process -FilePath $chrome -ArgumentList $args -NoNewWindow -Wait -RedirectStandardOutput $domPath -RedirectStandardError (Join-Path $env:TEMP 'cob-smoke-err.txt')

Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue
Remove-Item $profile -Recurse -Force -ErrorAction SilentlyContinue

$dom = [System.IO.File]::ReadAllText($domPath, [System.Text.Encoding]::UTF8)
$match = [regex]::Match($dom, '<title>(SMOKE\|.*?)</title>')
Write-Host '=== 真实浏览器完整对局冒烟 ==='
if ($match.Success) {
  foreach ($part in ($match.Groups[1].Value -split '\|')) {
    if ($part -and $part -ne 'SMOKE') { Write-Host ("  " + $part) }
  }
  Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue
  if ($match.Groups[1].Value -match 'finished=yes') {
    Write-Host ''
    Write-Host '结论：整局在真实浏览器里点完了，并正常出现终局结算。'
    exit 0
  }
  Write-Host ''
  Write-Host '结论：没能打完（卡住或报错），细节见上。'
  exit 1
}
Write-Host '  没拿到报告 —— 页面可能都没挂载起来'
Write-Host ("  title = " + [regex]::Match($dom, '<title>(.*?)</title>').Groups[1].Value)
Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue
exit 1
