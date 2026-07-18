# migrate_architecture.ps1
# Run this script from the root of soc-frontend to physically migrate the files.

Write-Host "Starting Architectural Migration Phase 1 & 2..." -ForegroundColor Cyan

# 1. Create the new folder skeleton
$folders = @(
    "src/app/providers", 
    "src/app/styles", 
    "src/layouts", 
    "src/features/investigations/components", 
    "src/features/playbooks/components", 
    "src/features/alerts/components", 
    "src/shared/ui/TwoKeyModal", 
    "src/shared/api", 
    "src/shared/hooks", 
    "src/shared/lib", 
    "src/shared/config"
)

foreach ($folder in $folders) {
    if (-not (Test-Path -Path $folder)) {
        New-Item -ItemType Directory -Force -Path $folder | Out-Null
        Write-Host "Created directory: $folder" -ForegroundColor Green
    }
}

# 2. Move App.css
if (Test-Path "src/App.css") {
    Move-Item -Path "src/App.css" -Destination "src/app/styles/App.css" -Force
    Write-Host "Moved App.css to app/styles/" -ForegroundColor Green
}

# 3. Move Shared UI & Libs
if (Test-Path "src/components/TwoKeyModal.tsx") {
    Move-Item -Path "src/components/TwoKeyModal.tsx" -Destination "src/shared/ui/TwoKeyModal/index.tsx" -Force
    Write-Host "Moved TwoKeyModal to shared/ui/" -ForegroundColor Green
}

if (Test-Path "src/lib") {
    Move-Item -Path "src/lib/*" -Destination "src/shared/lib/" -Force
    Write-Host "Moved lib utilities to shared/lib/" -ForegroundColor Green
    Remove-Item "src/lib" -Recurse -Force
}

if (Test-Path "src/hooks") {
    Move-Item -Path "src/hooks/*" -Destination "src/shared/hooks/" -Force
    Write-Host "Moved hooks to shared/hooks/" -ForegroundColor Green
    Remove-Item "src/hooks" -Recurse -Force
}

# 4. Clean up proxy folders
if (Test-Path "src/components/layout") {
    Remove-Item "src/components/layout" -Recurse -Force
    Write-Host "Removed transitional proxy folder: components/layout" -ForegroundColor Yellow
}
if (Test-Path "src/components/shared") {
    Remove-Item "src/components/shared" -Recurse -Force
    Write-Host "Removed transitional proxy folder: components/shared" -ForegroundColor Yellow
}

Write-Host "Migration script completed successfully! Please restart your Vite dev server." -ForegroundColor Cyan
