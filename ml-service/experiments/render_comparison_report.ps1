param(
  [string]$InputFile = (Join-Path $PSScriptRoot 'results/comparison_results.json'),
  [string]$OutputFile = (Join-Path $PSScriptRoot 'results/comparison_report.png')
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$data = Get-Content -LiteralPath $InputFile -Raw | ConvertFrom-Json
$width = 1800
$height = 1220
$bitmap = New-Object System.Drawing.Bitmap($width, $height)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit
$graphics.Clear([System.Drawing.Color]::FromArgb(247, 249, 252))

$titleFont = New-Object System.Drawing.Font('Segoe UI', 30, [System.Drawing.FontStyle]::Bold)
$subtitleFont = New-Object System.Drawing.Font('Segoe UI', 14, [System.Drawing.FontStyle]::Regular)
$sectionFont = New-Object System.Drawing.Font('Segoe UI', 20, [System.Drawing.FontStyle]::Bold)
$headerFont = New-Object System.Drawing.Font('Segoe UI', 13, [System.Drawing.FontStyle]::Bold)
$rowFont = New-Object System.Drawing.Font('Segoe UI', 13, [System.Drawing.FontStyle]::Regular)
$footFont = New-Object System.Drawing.Font('Segoe UI', 11, [System.Drawing.FontStyle]::Regular)
$darkBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(23, 37, 61))
$mutedBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(86, 101, 122))
$whiteBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
$gridPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(220, 226, 235), 1)
$headerBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(35, 72, 128))
$cardBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)

$graphics.DrawString('SBMS Duplicate Detection Research', $titleFont, $darkBrush, 55, 35)
$subtitle = "Synthetic dataset: $($data.dataset.rows.ToString('N0')) pairs / $($data.dataset.groups.ToString('N0')) groups  |  Group holdout: $($data.split.test_percent)%  |  Seed: $($data.split.random_state)  |  Threshold: $($data.threshold)"
$graphics.DrawString($subtitle, $subtitleFont, $mutedBrush, 58, 88)

function Format-Value($metrics, [string]$key) {
  switch ($key) {
    'precision' { return ('{0:P1}' -f [double]$metrics.precision) }
    'recall' { return ('{0:P1}' -f [double]$metrics.recall) }
    'f1' { return ('{0:P1}' -f [double]$metrics.f1) }
    'accuracy' { return ('{0:P1}' -f [double]$metrics.accuracy) }
    'roc_auc' { return ('{0:F4}' -f [double]$metrics.roc_auc) }
    'false_positives' { return [string]$metrics.false_positives }
    'false_negatives' { return [string]$metrics.false_negatives }
    'confusion' {
      $matrix = $metrics.confusion_matrix_labels_0_1
      return "TN $($matrix[0][0])  FP $($matrix[0][1])  FN $($matrix[1][0])  TP $($matrix[1][1])"
    }
    'training_seconds' { return ('{0:F2} s' -f [double]$metrics.training_seconds) }
    'test_prediction_ms_per_pair' { return ('{0:F4} ms' -f [double]$metrics.test_prediction_ms_per_pair) }
  }
}

function Draw-Table([string]$heading, $results, [int]$top) {
  $left = 55
  $tableWidth = 1690
  $labelWidth = 510
  $modelWidth = ($tableWidth - $labelWidth) / 2
  $headerHeight = 44
  $rowHeight = 38
  $columns = @($results.PSObject.Properties.Name)
  $rows = @(
    @('Precision', 'precision'),
    @('Recall', 'recall'),
    @('F1-score', 'f1'),
    @('Accuracy', 'accuracy'),
    @('ROC-AUC', 'roc_auc'),
    @('False positives', 'false_positives'),
    @('False negatives', 'false_negatives'),
    @('Confusion matrix', 'confusion'),
    @('Training / tuning time', 'training_seconds'),
    @('Prediction time per test pair', 'test_prediction_ms_per_pair')
  )

  $graphics.DrawString($heading, $sectionFont, $darkBrush, $left, $top)
  $tableTop = $top + 42
  $graphics.FillRectangle($cardBrush, $left, $tableTop, $tableWidth, $headerHeight + ($rowHeight * $rows.Count))
  $graphics.FillRectangle($headerBrush, $left, $tableTop, $tableWidth, $headerHeight)
  $graphics.DrawString('Metric', $headerFont, $whiteBrush, $left + 14, $tableTop + 11)
  for ($column = 0; $column -lt $columns.Count; $column++) {
    $x = $left + $labelWidth + ($column * $modelWidth) + 14
    $graphics.DrawString($columns[$column], $headerFont, $whiteBrush, $x, $tableTop + 11)
  }

  for ($row = 0; $row -lt $rows.Count; $row++) {
    $y = $tableTop + $headerHeight + ($row * $rowHeight)
    $graphics.DrawLine($gridPen, $left, $y, $left + $tableWidth, $y)
    $graphics.DrawString($rows[$row][0], $rowFont, $darkBrush, $left + 14, $y + 9)
    for ($column = 0; $column -lt $columns.Count; $column++) {
      $modelName = $columns[$column]
      $metrics = $results.$modelName
      $value = Format-Value $metrics $rows[$row][1]
      $x = $left + $labelWidth + ($column * $modelWidth) + 14
      $graphics.DrawString($value, $rowFont, $darkBrush, $x, $y + 9)
    }
  }
  $graphics.DrawRectangle($gridPen, $left, $tableTop, $tableWidth, $headerHeight + ($rowHeight * $rows.Count))
}

Draw-Table '1. Random Forest vs XGBoost' $data.model_comparison 132
Draw-Table '2. Jaro-Winkler vs normalized Levenshtein' $data.name_similarity_comparison 620

$footer = 'Research on synthetic data only. Do not interpret these results as real-world beneficiary performance or as a production model change.'
$graphics.DrawString($footer, $footFont, $mutedBrush, 58, 1170)

$directory = Split-Path -Parent $OutputFile
New-Item -ItemType Directory -Path $directory -Force | Out-Null
$bitmap.Save($OutputFile, [System.Drawing.Imaging.ImageFormat]::Png)
$graphics.Dispose()
$bitmap.Dispose()
$titleFont.Dispose()
$subtitleFont.Dispose()
$sectionFont.Dispose()
$headerFont.Dispose()
$rowFont.Dispose()
$footFont.Dispose()
$darkBrush.Dispose()
$mutedBrush.Dispose()
$whiteBrush.Dispose()
$gridPen.Dispose()
$headerBrush.Dispose()
$cardBrush.Dispose()
Write-Output "Saved screenshot-ready comparison table: $OutputFile"
