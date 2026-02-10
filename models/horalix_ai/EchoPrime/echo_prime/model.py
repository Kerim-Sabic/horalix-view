# Standard library imports
import os
import math
import glob
import json
import pickle
import random
import warnings
from typing import Sequence

# Third-party library imports
import torch
import torchvision
import torch.nn.functional as F
import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
from tqdm import tqdm
import cv2
import pydicom
import sklearn
import sklearn.metrics
import transformers


# Local module imports
from ..utils import utils

def _load_torch(path, map_location, label):
    try:
        return torch.load(path, map_location=map_location, weights_only=True)
    except TypeError:
        warnings.warn(f"torch.load weights_only not supported for {label}; loading with weights_only=False", RuntimeWarning)
        return torch.load(path, map_location=map_location)


class EchoPrime:
    def __init__(self, device=None):
        self.frames_to_take = 32
        self.frame_stride = 2
        self.video_size = 224
        self.mean = torch.tensor([29.110628, 28.076836, 29.096405]).reshape(3,1,1,1)
        self.std = torch.tensor([47.989223, 46.456997, 47.20083]).reshape(3,1,1,1)
        # Determine device
        device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        
        # Base path for all relative files
        base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

        # Load echo encoder
        checkpoint_path = os.path.join(base_dir, "model_data", "weights", "echo_prime_encoder.pt")
        checkpoint = _load_torch(checkpoint_path, device, "echo encoder")
        echo_encoder = torchvision.models.video.mvit_v2_s()
        echo_encoder.head[-1] = torch.nn.Linear(echo_encoder.head[-1].in_features, 512)
        echo_encoder.load_state_dict(checkpoint)
        echo_encoder.eval()
        echo_encoder.to(device)
        for param in echo_encoder.parameters():
            param.requires_grad = False
        
        # Load view classifier
        vc_path = os.path.join(base_dir, "model_data", "weights", "view_classifier.pt")
        vc_state_dict = _load_torch(vc_path, device, "view classifier")
        view_classifier = torchvision.models.convnext_base()
        view_classifier.classifier[-1] = torch.nn.Linear(view_classifier.classifier[-1].in_features, 11)
        view_classifier.load_state_dict(vc_state_dict)
        view_classifier.to(device)
        view_classifier.eval()
        for param in view_classifier.parameters():
            param.requires_grad = False

        self.echo_encoder = echo_encoder
        self.view_classifier = view_classifier
        self.device = device

        # Load MIL weights
        mil_path = os.path.join(base_dir, "assets", "MIL_weights.csv")
        self.MIL_weights = pd.read_csv(mil_path)
        self.non_empty_sections = self.MIL_weights['Section']
        self.section_weights = self.MIL_weights.iloc[:,1:].to_numpy()

        # Load candidate reports and embeddings
        candidates_dir = os.path.join(base_dir, "model_data", "candidates_data")
        self.candidate_studies = list(pd.read_csv(os.path.join(candidates_dir, 'candidate_studies.csv'))['Study'])
        candidate_embeddings_p1 = _load_torch(os.path.join(candidates_dir, "candidate_embeddings_p1.pt"), device, "candidate embeddings p1").to(device)
        candidate_embeddings_p2 = _load_torch(os.path.join(candidates_dir, "candidate_embeddings_p2.pt"), device, "candidate embeddings p2").to(device)
        self.candidate_embeddings = torch.cat((candidate_embeddings_p1, candidate_embeddings_p2), dim=0)
        self.candidate_labels = pd.read_pickle(os.path.join(candidates_dir, "candidate_labels.pkl"))
        section_to_phenotypes_path = os.path.join(base_dir, "assets", "section_to_phenotypes.pkl")
        self.section_to_phenotypes = pd.read_pickle(section_to_phenotypes_path)

    def process_dicoms(self,INPUT, return_meta: bool = False):
        """
        Reads DICOM video data from the specified folder and returns a tensor 
        formatted for input into the EchoPrime model.

        Args:
            INPUT (str | Sequence[str]): Path to DICOM root or explicit ordered DICOM paths.

        Returns:
            stack_of_videos (torch.Tensor): A float tensor of shape  (N, 3, 16, 224, 224)
                                            representing the video data where N is the number of videos,
                                            ready to be fed into EchoPrime.
        """

        if isinstance(INPUT, (list, tuple)):
            dicom_paths = [str(p) for p in INPUT]
        else:
            dicom_paths = sorted(glob.glob(f'{INPUT}/**/*.dcm', recursive=True))
        stack_of_videos=[]
        kept_paths=[]
        kept_uids=[]
        kept_meta=[]
        for idx, dicom_path in tqdm(enumerate(dicom_paths),total=len(dicom_paths)):
            try:
                # simple dicom_processing
                dcm=pydicom.dcmread(dicom_path)
                pixels = dcm.pixel_array
                
                # exclude images like (600,800) or (600,800,3)
                if pixels.ndim < 3:
                    continue
                if pixels.ndim == 3 and pixels.shape[2] == 3:
                    continue

                # Normalize to (F, H, W, 3)
                if pixels.ndim == 3:
                    pixels = np.repeat(pixels[..., None], 3, axis=3)
                elif pixels.ndim == 4:
                    if pixels.shape[-1] == 1:
                        pixels = np.repeat(pixels, 3, axis=3)
                    elif pixels.shape[-1] > 3:
                        pixels = pixels[..., :3]
                else:
                    continue

                # Convert non-uint8 cines (e.g. 10/12/16-bit) to uint8 via min-max scaling.
                if pixels.dtype != np.uint8:
                    pixels_f = pixels.astype(np.float32)
                    p_min = float(np.nanmin(pixels_f))
                    p_max = float(np.nanmax(pixels_f))
                    if not np.isfinite(p_min) or not np.isfinite(p_max):
                        continue
                    if p_max > p_min:
                        pixels = np.clip((pixels_f - p_min) * (255.0 / (p_max - p_min)), 0, 255).astype(np.uint8)
                    else:
                        pixels = np.zeros(pixels.shape, dtype=np.uint8)
                else:
                    pixels = np.ascontiguousarray(pixels)

                # mask everything outside ultrasound region
                pixels = utils.mask_outside_ultrasound(pixels)
                if pixels.ndim == 3:
                    pixels = np.repeat(pixels[..., None], 3, axis=3)
                elif pixels.ndim == 4 and pixels.shape[-1] == 1:
                    pixels = np.repeat(pixels, 3, axis=3)
                if pixels.ndim != 4:
                    continue
                if pixels.shape[-1] > 3:
                    pixels = pixels[..., :3]
                if pixels.shape[-1] != 3:
                    continue

                #model specific preprocessing
                x = np.zeros((len(pixels),224,224,3), dtype=np.float32)
                for i in range(len(x)):
                    x[i] = utils.crop_and_scale(pixels[i])
                
                x = torch.as_tensor(x, dtype=torch.float).permute([3,0,1,2])
                # normalize
                x.sub_(self.mean).div_(self.std)
            
                ## if not enough frames add padding
                if x.shape[1] < self.frames_to_take:
                    padding = torch.zeros(
                    (
                        3,
                        self.frames_to_take - x.shape[1],
                        self.video_size,
                        self.video_size,
                    ),
                    dtype=torch.float,
                    )
                    x = torch.cat((x, padding), dim=1)
                    
                start=0
                stack_of_videos.append(x[:, start : ( start + self.frames_to_take) : self.frame_stride, : , : ])
                kept_paths.append(dicom_path)
                sop_instance_uid = str(getattr(dcm, "SOPInstanceUID", os.path.splitext(os.path.basename(dicom_path))[0]))
                kept_uids.append(sop_instance_uid)
                instance_number = getattr(dcm, "InstanceNumber", None)
                try:
                    instance_number = int(instance_number) if instance_number is not None else None
                except Exception:
                    instance_number = None
                kept_meta.append(
                    {
                        "dicom_path": str(dicom_path),
                        "sop_instance_uid": sop_instance_uid,
                        "series_instance_uid": str(getattr(dcm, "SeriesInstanceUID", "") or ""),
                        "instance_number": instance_number,
                        "acquisition_time": str(getattr(dcm, "AcquisitionTime", "") or ""),
                        "content_time": str(getattr(dcm, "ContentTime", "") or ""),
                    }
                )
                
            except Exception as e:
                print("corrupt file")
                print(str(e))

        if not stack_of_videos:
            stack_of_videos = torch.empty((0, 3, 16, 224, 224), dtype=torch.float)
        else:
            stack_of_videos=torch.stack(stack_of_videos)

        if return_meta:
            return stack_of_videos, kept_paths, kept_uids, kept_meta
        return stack_of_videos

    def process_mp4s(self,INPUT):
        """
        Reads MP4 video data from the specified folder and returns a tensor 
        formatted for input into the EchoPrime model.

        Args:
            INPUT (str): Path to the folder containing MP4 files.

        Returns:
            stack_of_videos (torch.Tensor): A float tensor of shape  (N, 3, 16, 224, 224)
                                            representing the video data where N is the number of videos,
                                            ready to be fed into EchoPrime.
        """

        dicom_paths = glob.glob(f'{INPUT}/**/*.mp4',recursive=True)
        stack_of_videos=[]
        for idx, dicom_path in enumerate(dicom_paths):
            try:
                # simple dicom_processing
                pixels,_,metadata = torchvision.io.read_video(dicom_path)
                fps=metadata['video_fps']
                pixels=np.array(pixels)

                #model specific preprocessing
                x = np.zeros((len(pixels),224,224,3))
                for i in range(len(x)):
                    x[i] = utils.crop_and_scale(pixels[i])

                x = torch.as_tensor(x, dtype=torch.float).permute([3,0,1,2])
                # normalize
                x.sub_(self.mean).div_(self.std)

                ## if not enough frames add padding
                if x.shape[1] < self.frames_to_take:
                    padding = torch.zeros(
                    (
                        3,
                        self.frames_to_take - x.shape[1],
                        self.video_size,
                        self.video_size,
                    ),
                    dtype=torch.float,
                    )
                    x = torch.cat((x, padding), dim=1)

                start=0
                stack_of_videos.append(x[:, start : ( start + self.frames_to_take) : self.frame_stride, : , : ])

            except Exception as e:
                print("corrupt file")
                print(str(e))

        stack_of_videos=torch.stack(stack_of_videos)

        return stack_of_videos

    def embed_videos(self,stack_of_videos):
        """
        Given a set of videos that belong to one echocardiogram study,
        embed them in the latent space using EchoPrime encoder
        
        Args:
            stack_of_videos (torch.Tensor): A float tensor of shape (N, 3, 16, 224, 224)
                                            with preprocessed echo video data
            
        Returns:
            stack_of_features (torch.Tensor) A float tensor of shape (N, 512)
                                            with latent embeddings corresponding to echo videos
        """
        bin_size=50
        n_bins=math.ceil(stack_of_videos.shape[0]/bin_size)
        stack_of_features_list=[]
        with torch.no_grad():
            for bin_idx in range(n_bins):
                start_idx = bin_idx * bin_size
                end_idx = min( (bin_idx + 1) * bin_size, stack_of_videos.shape[0])
                bin_videos = stack_of_videos[start_idx:end_idx].to(self.device)
                bin_features = self.echo_encoder(bin_videos)
                stack_of_features_list.append(bin_features)
            stack_of_features=torch.cat(stack_of_features_list,dim=0)
        return stack_of_features

    def get_views(self, stack_of_videos, visualize=False, return_view_list=False, return_scores: bool = False):  # CHANGED: added return_scores
        """
        Args:
            stack_of_videos (torch.Tensor): A float tensor with preprocessed echo video data
            visualize (bool): show montage
            return_view_list (bool): return list of view labels
            return_scores (bool): when used with return_view_list=True, also return per-class softmax probabilities  # NEW

        Returns:
            if return_view_list and return_scores:
                (view_list, view_confidence_list)
            elif return_view_list:
                view_list: List[str]
            else:
                stack_of_view_encodings (torch.Tensor) one-hot embeddings with shape (N, 11)
        """
        ## get views
        stack_of_first_frames = stack_of_videos[:, :, 0, :, :].to(self.device)
        with torch.no_grad():
            out_logits = self.view_classifier(stack_of_first_frames)
        out_views = torch.argmax(out_logits, dim=1)
        view_list = [utils.COARSE_VIEWS[v] for v in out_views]
        stack_of_view_encodings = torch.nn.functional.one_hot(out_views, num_classes=11).float().to(self.device)

        probs = torch.softmax(out_logits, dim=1)  # NEW: per-class probabilities [N, 11]
        probs_list = probs.detach().cpu().tolist()

        view_confidence_list = probs.max(dim=1).values.detach().cpu().tolist()

        # visualize images and the assigned views
        if visualize:
            print("Preprocessed and normalized video inputs")
            rows, cols = (len(view_list) // 12 + (len(view_list) % 9 > 0)), 12
            fig, axes = plt.subplots(rows, cols, figsize=(cols, rows))
            axes = axes.flatten()
            for i in range(len(view_list)):
                display_image = (stack_of_first_frames[i].cpu().permute([1, 2, 0]) * 255).numpy()
                display_image = np.clip(display_image, 0, 255).astype('uint8')
                display_image = np.ascontiguousarray(display_image)
                display_image = cv2.cvtColor(display_image, cv2.COLOR_RGB2BGR)
                cv2.putText(display_image, view_list[i].replace("_", " "), (10, 25), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 220, 255), 2)
                axes[i].imshow(display_image)
                axes[i].axis('off')

            for j in range(i + 1, len(axes)):
                axes[j].axis('off')
            plt.subplots_adjust(wspace=0.05, hspace=0.05)
            plt.show()

        if return_view_list and return_scores:         # NEW: dual return with scores
            return view_list, view_confidence_list

        if return_view_list:
            return view_list

        return stack_of_view_encodings
    
    @torch.no_grad()
    def encode_study(self,stack_of_videos,visualize=False):
        """
        Produces an EchoPrime embedding of the echocardiography study

        Args:
            stack_of_videos (torch.Tensor): A float tensor of shape (N, 3, 16, 224, 224)
                                            with preprocessed echo video data           
        Returns:
            encoded_study (torch.Tensor): A float tensor of shape (N, 523)
        """
        stack_of_features=self.embed_videos(stack_of_videos)
        stack_of_view_encodings=self.get_views(stack_of_videos,visualize)
        encoded_study = torch.cat( (stack_of_features ,stack_of_view_encodings),dim=1)
        
        return encoded_study

    def predict_metrics(self,study_embedding: torch.Tensor,
                    k=50) -> dict:
        """
        study_embedding is a set of embeddings of all videos from the study e.g (52,512)
        Takes a study embedding as input and
        outputs a dictionary for a set of 26 features
        """
        #per_section_study_embedding has shape (15,512)
        per_section_study_embedding = torch.zeros(len(self.non_empty_sections), 512, device=self.device)
        study_embedding = study_embedding.to(self.device)
        # make per section study embedding
        for s_dx, sec in enumerate(self.non_empty_sections):
            # get section weights
            this_section_weights=[self.section_weights[s_dx][torch.where(view_encoding==1)[0]]
                        for view_encoding in study_embedding[:,512:]]
            this_section_study_embedding = (study_embedding[:,:512] * \
                                            torch.tensor(this_section_weights,
                                                        dtype=torch.float, device=self.device).unsqueeze(1))
            
            #weighted average
            this_section_study_embedding=torch.sum(this_section_study_embedding,dim=0)
            per_section_study_embedding[s_dx]=this_section_study_embedding
            
        per_section_study_embedding=torch.nn.functional.normalize(per_section_study_embedding)
        #similarities has shape (15,230676)
        similarities=per_section_study_embedding @ self.candidate_embeddings.T

        # for each row find indices of 50 highest values
        #top_candidate_ids has shape (15,50)
        top_candidate_ids=torch.topk(similarities, k=k, dim=1).indices
        #now predict for each phenotype:
        preds={}
        for s_dx, section in enumerate(self.section_to_phenotypes.keys()):
            for pheno in self.section_to_phenotypes[section]:
                preds[pheno] = np.nanmean([self.candidate_labels[pheno][self.candidate_studies[c_ids]]
                                    for c_ids in top_candidate_ids[s_dx]
                                        if self.candidate_studies[c_ids] in self.candidate_labels[pheno]])
        
        return preds

class EchoPrimeTextEncoder(torch.nn.Module):
    def __init__(self,device="cuda"):
        super().__init__()
        self.device=device
        config = transformers.AutoConfig.from_pretrained("microsoft/BiomedNLP-BiomedBERT-base-uncased-abstract")
        self.backbone = transformers.AutoModelForMaskedLM.from_config(config)
        self.text_projection = torch.nn.Linear(768, 512)
        self.tokenizer = transformers.AutoTokenizer.from_pretrained(
            "microsoft/BiomedNLP-BiomedBERT-base-uncased-abstract"
        )
        self.tokenizer.max_length=512
        self.to(device)
    def forward(self,report):
        text = self.tokenizer(
        report,
        padding="max_length",  # Pad to max_length
        max_length=512,        # Set the maximum length to 512 tokens
        truncation=True,        # Truncate if the input is longer than max_length,
        return_tensors="pt"
        )
        if text["input_ids"].shape[1] > 512:
            # find sep token positions
            sep_positions = list(
                torch.where(text["input_ids"].squeeze(0) == 3)[0].numpy()
            )

            # get maximum possible start that's not going to run out of tokens
            max_start = sep_positions[-1] - 512
            possible_starts = [pos for pos in sep_positions if pos < max_start]
            # add 0 as a possible start
            possible_starts.insert(0, 0)

            start = possible_starts[random.randint(0, len(possible_starts) - 1)]

            max_end = start + 512
            # find the first number less than max_end in sep_position
            for p in reversed(sep_positions):
                if p <= max_end:
                    end = p
                    break
            # finally cut the tokens
            text = transformers.BatchEncoding(
                data={k: v[:, start:end] for (k, v) in text.items()}
            )
        with torch.no_grad():
            text.to(self.device)
            text_emb = self.text_projection(
                self.backbone(**text, output_hidden_states=True).hidden_states[-1][
                    :, 0, :
                ]
            )
        return text_emb
