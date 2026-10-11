$ErrorActionPreference = "Stop"

$scenarios = @(
  "bicycle-bicycle",
  "bicycle-car",
  "bicycle-motorbike",
  "bicycle-heavy-duty"
)

Write-Host "Cyclesafe SUMO smoke test" -ForegroundColor Cyan
Write-Host "Runner: http://localhost:8090"
Write-Host ""

$failed = $false

foreach ($scenario in $scenarios) {
  Write-Host "[$scenario]" -ForegroundColor Yellow
  $result = Invoke-RestMethod -Method Post -Uri "http://localhost:8090/simulate?scenario=$scenario" -ContentType "application/json" -Body (@{ scenario = $scenario } | ConvertTo-Json)

  $points = @($result.points)
  $withProximity = @($points | Where-Object { $null -ne $_.proximity_m })
  $minProximity = if ($withProximity.Count -gt 0) { ($withProximity.proximity_m | Measure-Object -Minimum).Minimum } else { $null }
  $closeSamples = @($withProximity | Where-Object { $_.proximity_m -lt 2.0 }).Count
  $passEvents = @()
  if ($result.metadata.pass_events) {
    $parsedPassEvents = $result.metadata.pass_events | ConvertFrom-Json
    # PowerShell can wrap a JSON array as an object exposing a `value` property
    # (especially when the JSON originated from a .NET collection). Normalize
    # both shapes so Count reflects the actual number of events.
    if ($null -ne $parsedPassEvents.PSObject.Properties['value']) {
      $passEvents = @($parsedPassEvents.value)
    } else {
      $passEvents = @($parsedPassEvents)
    }
  }

  Write-Host ("  engine:          {0}" -f $result.metadata.engine)
  Write-Host ("  source:          {0}" -f $result.source)
  Write-Host ("  samples:         {0}" -f $points.Count)
  Write-Host ("  min proximity:   {0} m" -f ($(if ($null -eq $minProximity) { "n/a" } else { "{0:N3}" -f $minProximity })))
  Write-Host ("  < 2 m samples:   {0}" -f $closeSamples)
  Write-Host ("  pass events:     {0}" -f ($passEvents | ConvertTo-Json -Compress))

  if ($result.source -ne "sumo" -or $result.metadata.engine -notlike "Eclipse SUMO*") {
    Write-Host "  FAIL: runner did not report Eclipse SUMO." -ForegroundColor Red
    $failed = $true
  }
  if ($points.Count -lt 20) {
    Write-Host "  FAIL: too few ego samples." -ForegroundColor Red
    $failed = $true
  }
  if ($null -eq $minProximity -or $minProximity -ge 2.0) {
    Write-Host "  FAIL: scenario never produced a sub-2m interaction measurement." -ForegroundColor Red
    $failed = $true
  }
  if ($scenario -ne "bicycle-bicycle" -and $passEvents.Count -lt 2) {
    Write-Host "  FAIL: expected left-side pass start/completion events." -ForegroundColor Red
    $failed = $true
  }
  Write-Host ""
}

if ($failed) {
  Write-Host "SUMO runner smoke test FAILED." -ForegroundColor Red
  exit 1
}

Write-Host "SUMO runner smoke test completed successfully." -ForegroundColor Green
