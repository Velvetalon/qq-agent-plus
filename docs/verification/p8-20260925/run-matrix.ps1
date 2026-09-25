param(
  [string]$Node = 'E:\node22\node.exe'
)

$ErrorActionPreference = 'Continue'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$evidence = $PSScriptRoot
$indexPath = Join-Path $evidence '00-matrix-command-index.txt'

if (-not (Test-Path -LiteralPath $Node)) {
  throw "Node runtime not found: $Node"
}

$env:NODE_OPTIONS = ''
$env:PATH = "$(Split-Path -Parent $Node);$env:PATH"

$cases = @(
  @{ Id = '01-p2-focused'; Args = @('--test', '--test-reporter=tap',
      'test/plugin-tool-context.test.mjs', 'test/plugin-lifecycle.test.mjs',
      'test/plugin-registry.test.mjs', 'test/plugin-app-start.test.mjs') },
  @{ Id = '02-p3-focused'; Args = @('--test', '--test-reporter=tap',
      'test/p3-active-silence.test.mjs', 'test/orchestrator.test.mjs',
      'test/tools.test.mjs', 'test/tool-scheduler-wrapper.test.mjs',
      'test/experimental-tool-scheduler.test.mjs', 'test/store.test.mjs') },
  @{ Id = '03-p4-notebook-focused'; Args = @('--test', '--test-reporter=tap',
      'test/self-evolution-notebook.test.mjs') },
  @{ Id = '04-p5-retrieval-focused'; Args = @('--test', '--test-reporter=tap',
      'test/retrieval.test.mjs') },
  @{ Id = '05-p6-reflection-focused'; Args = @('--test', '--test-reporter=tap',
      'test/self-evolution-reflection.test.mjs') },
  @{ Id = '06-p7-console-focused'; Args = @('--test', '--test-reporter=tap',
      'test/p7-console-observability.test.mjs', 'test/layout.test.mjs',
      'test/memory-page-separation.test.mjs', 'test/session-persona-label.test.mjs') },
  @{ Id = '07-prompt'; Args = @('test/test-prompt.mjs') },
  @{ Id = '08-local'; Args = @('test/local/run.mjs') },
  @{ Id = '09-render'; Args = @('test/render-test.mjs') },
  @{ Id = '10-scroll'; Args = @('test/scroll-test.mjs') },
  @{ Id = '11-usage'; Args = @('test/usage-e2e.mjs') },
  @{ Id = '12-full-unit'; Args = @('--test', '--test-reporter=tap', 'test/*.test.mjs') },
  @{ Id = '13-deployment-integration'; Args = @('--test', '--test-reporter=tap',
      'test/deployment-scripts.test.mjs', 'test/deploy-all-preflight.test.mjs',
      'test/deploy-image-mirror.test.mjs', 'test/linux-integration.test.mjs',
      'test/delivery-integration.test.mjs') },
  @{ Id = '14-fault-injection-boundaries'; Args = @('--test', '--test-reporter=tap',
      'test/plugin-lifecycle.test.mjs', 'test/plugin-app-start.test.mjs',
      'test/self-evolution-notebook.test.mjs', 'test/retrieval.test.mjs',
      'test/self-evolution-reflection.test.mjs', 'test/p3-active-silence.test.mjs',
      'test/delivery-integration.test.mjs', 'test/p7-console-observability.test.mjs') }
)

Set-Content -LiteralPath $indexPath -Encoding ascii -Value @(
  "node=$Node",
  "cwd=$root",
  "NODE_OPTIONS=<cleared>",
  "started=$(Get-Date -Format o)",
  ''
)

foreach ($case in $cases) {
  $log = Join-Path $evidence "$($case.Id).log"
  $started = Get-Date
  $display = "$Node $($case.Args -join ' ')"
  "RUN $($case.Id): $display" | Tee-Object -FilePath $log
  & $Node @($case.Args) 2>&1 | Tee-Object -Append -FilePath $log
  $exit = $LASTEXITCODE
  $elapsed = [int]((Get-Date) - $started).TotalMilliseconds
  "EXIT $($case.Id) code=$exit duration_ms=$elapsed" | Tee-Object -Append -FilePath $log
  Add-Content -LiteralPath $indexPath -Encoding ascii -Value (
    "$($case.Id)|exit=$exit|duration_ms=$elapsed|$display"
  )
}

"finished=$(Get-Date -Format o)" | Add-Content -LiteralPath $indexPath -Encoding ascii
