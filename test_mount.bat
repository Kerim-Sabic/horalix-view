@echo off
docker run --rm -v "%HORALIX_AI_MODELS_HOST_PATH%:/test:ro" alpine ls -la /test
