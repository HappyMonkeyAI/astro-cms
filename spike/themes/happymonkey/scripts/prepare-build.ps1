# Prepare a build directory: copy spike/emdash-site, then overlay HappyMonkey theme files.
$ErrorActionPreference = "Stop"
$Theme = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
# $PSScriptRoot = .../happymonkey/scripts → theme = happymonkey, repo = astro-cms
$ThemeRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$Root = Resolve-Path (Join-Path $ThemeRoot "..\..\..")
$Src = Join-Path $Root "spike\emdash-site"
$Out = if ($args[0]) { $args[0] } else { Join-Path $ThemeRoot ".build" }

if (Test-Path $Out) { Remove-Item -Recurse -Force $Out }
New-Item -ItemType Directory -Force -Path $Out | Out-Null

robocopy $Src $Out /E /XD node_modules dist .git /NFL /NDL /NJH /NJS /nc /ns /np | Out-Null
if ($LASTEXITCODE -ge 8) { throw "robocopy failed with $LASTEXITCODE" }

Copy-Item -Force (Join-Path $ThemeRoot "astro.config.mjs") (Join-Path $Out "astro.config.mjs")
Copy-Item -Force (Join-Path $ThemeRoot "src\styles\theme.css") (Join-Path $Out "src\styles\theme.css")
Copy-Item -Force (Join-Path $ThemeRoot "seed\seed.json") (Join-Path $Out "seed\seed.json")
Copy-Item -Force (Join-Path $ThemeRoot "Dockerfile") (Join-Path $Out "Dockerfile")
Copy-Item -Force (Join-Path $ThemeRoot "DESIGN.md") (Join-Path $Out "DESIGN.md")
Copy-Item -Force (Join-Path $ThemeRoot "COMPOSITION.md") (Join-Path $Out "COMPOSITION.md")

New-Item -ItemType Directory -Force -Path (Join-Path $Out "src\components\blocks") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $Out "src\pages\projects") | Out-Null
Copy-Item -Force (Join-Path $ThemeRoot "src\components\blocks\*.astro") (Join-Path $Out "src\components\blocks\")
Copy-Item -Force (Join-Path $ThemeRoot "src\pages\index.astro") (Join-Path $Out "src\pages\index.astro")
Copy-Item -Force (Join-Path $ThemeRoot "src\pages\projects\index.astro") (Join-Path $Out "src\pages\projects\index.astro")
Copy-Item -Force (Join-Path $ThemeRoot "src\pages\projects\[slug].astro") (Join-Path $Out "src\pages\projects\[slug].astro")

$publicSrc = Join-Path $ThemeRoot "public"
if (Test-Path $publicSrc) {
  New-Item -ItemType Directory -Force -Path (Join-Path $Out "public") | Out-Null
  Copy-Item -Recurse -Force (Join-Path $publicSrc "*") (Join-Path $Out "public\")
}

$base = Join-Path $Out "src\layouts\Base.astro"
$text = Get-Content -Raw $base
$patched = $text.Replace(
  'collections={["posts", "pages"]}',
  'collections={["posts", "pages", "projects"]}'
)
if ($patched -ne $text) { Set-Content -Path $base -Value $patched -NoNewline }

Write-Host "Prepared build context at $Out"
