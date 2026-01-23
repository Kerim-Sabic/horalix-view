**AI Models Guide**

This guide explains how to install AI weights, configure commands, and run
models locally and in Docker. All paths below are relative to the repo root.

**Quick Start (Docker, recommended)**
- Ensure your repo has `models/` and `results/` directories on the host.
- Docker bind-mounts those into the backend container automatically.

```bash
mkdir -p models results
cp docker/.env.example docker/.env
```

Edit `docker/.env` for GPU machines:

```bash
AI_DEVICE=cuda:0
AI_AUTO_LOAD_MODELS=true
AI_ECHONET_MEASUREMENTS_CMD=python -m app.services.ai.external_runners.echonet_measurements
AI_GIGAPATH_CMD=python -m app.services.ai.external_runners.prov_gigapath
AI_HOVERNET_CMD=python -m app.services.ai.external_runners.hovernet
HF_TOKEN=your_hf_token_here
```

Then:

```bash
docker compose -f docker/docker-compose.yml up -d --build
```

**How model commands work**
- External command runners are shell commands executed by the backend.
- Commands have access to these placeholders:
  - `$INPUT_NPZ`, `$INPUT_JSON`, `$INPUT_DIR`, `$OUTPUT_JSON`
  - `$DEVICE`, `$WEIGHTS_PATH`, `$RESULTS_DIR`, `$MODEL_NAME`
- The same values are also exported as env vars:
  - `HORALIX_INPUT_NPZ`, `HORALIX_INPUT_JSON`, `HORALIX_INPUT_DIR`, `HORALIX_OUTPUT_JSON`
  - `HORALIX_DEVICE`, `HORALIX_WEIGHTS_PATH`, `HORALIX_RESULTS_DIR`

If you want to run repo-native scripts (e.g., `inference.py`, `infer.py`, `run_infer.py`),
set `AI_EXTERNAL_WORKDIR` to the repo path and use a custom command template:

```bash
AI_EXTERNAL_WORKDIR=/app/models/echonet_measurements
AI_ECHONET_MEASUREMENTS_CMD=python inference.py --model $WEIGHTS_PATH/checkpoints/echonet_measurements.pt --input $INPUT_DIR --output $RESULTS_DIR
```

**Model installs (Windows PowerShell + Bash)**

**EchoNet Measurements**
Weights are stored in Git LFS and must be pulled after cloning.

PowerShell:

```powershell
git clone https://github.com/echonet/measurements.git models/echonet_measurements
cd models/echonet_measurements
git lfs install
git lfs pull
cd ../..
```

Bash:

```bash
git clone https://github.com/echonet/measurements.git models/echonet_measurements
cd models/echonet_measurements
git lfs install
git lfs pull
cd ../..
```

**Prov-GigaPath**
Weights are hosted on Hugging Face. You must set `HF_TOKEN`.

PowerShell:

```powershell
$env:HF_TOKEN="your_hf_token_here"
python -m pip install "huggingface_hub[cli]"
huggingface-cli login --token $env:HF_TOKEN
huggingface-cli download prov-gigapath/prov-gigapath `
  --local-dir models/prov_gigapath `
  --local-dir-use-symlinks False
```

Bash:

```bash
export HF_TOKEN="your_hf_token_here"
python -m pip install "huggingface_hub[cli]"
huggingface-cli login --token $HF_TOKEN
huggingface-cli download prov-gigapath/prov-gigapath \
  --local-dir models/prov_gigapath \
  --local-dir-use-symlinks False
```

Expected files include:
- `models/prov_gigapath/tile_encoder.bin`
- `models/prov_gigapath/slide_encoder.pth`

**HoVer-Net**
Download the PanNuke fast checkpoint and extract into `models/hovernet/`.

PowerShell:

```powershell
Invoke-WebRequest -OutFile models/hovernet_fast_pannuke_type_tf2.tar.gz `
  https://github.com/vqdang/hover_net/releases/download/v0.2/hovernet_fast_pannuke_type_tf2.tar.gz
mkdir -p models/hovernet
tar -xzf models/hovernet_fast_pannuke_type_tf2.tar.gz -C models/hovernet
```

Bash:

```bash
wget -O models/hovernet_fast_pannuke_type_tf2.tar.gz \
  https://github.com/vqdang/hover_net/releases/download/v0.2/hovernet_fast_pannuke_type_tf2.tar.gz
mkdir -p models/hovernet
tar -xzf models/hovernet_fast_pannuke_type_tf2.tar.gz -C models/hovernet
```

**Verify model availability**

```bash
curl http://localhost:8000/api/v1/ai/models
```

Each model reports:
- `available`: weights found and command configured
- `status`: loaded or not
- `errors`: missing weights or command misconfigurations

**Run inference**
- From the UI, open a study and click **AI Tools**.
- Or call the API:

```bash
curl -X POST http://localhost:8000/api/v1/ai/infer \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "model_type": "echonet_measurements",
    "task_type": "cardiac",
    "study_uid": "<study_uid>",
    "series_uid": "<series_uid>"
  }'
```

**Troubleshooting**
- Missing weights: verify the folder structure matches `AI_MODELS_DIR`.
- External command fails: run the command manually inside the backend container:

```bash
docker compose -f docker/docker-compose.yml exec backend bash
```

Then run the configured command with environment variables (see above).
