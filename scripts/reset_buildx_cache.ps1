param(
    [switch]$NoPrune
)

Write-Host "Resetting Docker Buildx builder cache..."

if (-not $NoPrune) {
    try {
        docker buildx prune -af | Out-Host
    } catch {
        Write-Host "buildx prune failed: $($_.Exception.Message)"
    }
    try {
        docker builder prune -af | Out-Host
    } catch {
        Write-Host "builder prune failed: $($_.Exception.Message)"
    }
}

try {
    docker buildx rm horalix-builder | Out-Null
} catch {
    # ignore
}

try {
    docker buildx create --name horalix-builder --use | Out-Host
    docker buildx inspect --bootstrap | Out-Host
} catch {
    Write-Host "Failed to create/buildx builder: $($_.Exception.Message)"
    exit 1
}

Write-Host "Buildx builder reset complete."
