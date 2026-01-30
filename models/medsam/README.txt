MedSAM weights folder

Place the MedSAM checkpoint file here so the container can find it:
  medsam_vit_b.pth

Host path:
  C:\Users\malik\Desktop\horalix-view\models\medsam\medsam_vit_b.pth

Docker path (inside container):
  /app/models/medsam/medsam_vit_b.pth

Note: The backend mounts the host ./models folder to /app/models.
