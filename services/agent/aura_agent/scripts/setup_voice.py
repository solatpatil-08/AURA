"""AURA Local Voice Setup & License Verification Tool.

This utility explicitly downloads local models for Speech Recognition (faster-whisper)
and Text-to-Speech (Piper) when requested by a developer or user.

IMPORTANT ARCHITECTURAL RULE:
Automatic runtime downloads are strictly disabled in AURA to guarantee offline
privacy and predictable hardware execution.
"""

import argparse
import logging
import os
import sys
from pathlib import Path

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("aura.setup_voice")


def find_project_root() -> Path:
    current = Path(__file__).resolve().parent
    for parent in [current] + list(current.parents):
        if (parent / "package.json").exists() and (parent / "docs").exists():
            return parent
    return Path(__file__).resolve().parents[4]


DEFAULT_PROJECT_ROOT = find_project_root()
DEFAULT_MODELS_DIR = DEFAULT_PROJECT_ROOT / "models"


def print_license_warning(voice_name: str) -> None:
    """Print legal and licensing disclosure for selected voice models."""
    print("=" * 80)
    print("  AURA VOICE MODEL LICENSE VERIFICATION DISCLOSURE")
    print("=" * 80)
    if "lessac" in voice_name.lower():
        print(f"Target Voice: {voice_name}")
        print("Dataset: Lessac Corpus (derived from Blizzard Challenge 2013)")
        print("License: Research and Non-Commercial / Personal Use Only.")
        print("Notice:")
        print("  - Models fine-tuned or trained on the Lessac corpus inherit non-commercial")
        print("    dataset restrictions. Suitable for personal workstations, home companions,")
        print("    and local evaluation.")
        print("  - For commercial redistribution, choose an explicitly commercial-permissive voice")
        print("    such as 'en_US-libritts-r' (CC-BY 4.0) or clean public domain datasets.")
    elif "libritts" in voice_name.lower():
        print(f"Target Voice: {voice_name}")
        print("Dataset: LibriTTS Corpus")
        print("License: Creative Commons Attribution 4.0 International (CC-BY 4.0)")
        print("Notice: Permissive for commercial and non-commercial local deployment with attribution.")
    else:
        print(f"Target Voice: {voice_name}")
        print("License: Consult the upstream model card at https://huggingface.co/rhasspy/piper-voices")
    print("=" * 80)


def setup_whisper_model(model_name: str = "base.en", target_dir: Path = None) -> Path:
    """Download and cache a local faster-whisper CTranslate2 model."""
    if target_dir is None:
        target_dir = DEFAULT_MODELS_DIR / "whisper" / model_name

    target_dir.mkdir(parents=True, exist_ok=True)
    logger.info("Setting up faster-whisper model '%s' in %s...", model_name, target_dir)

    from faster_whisper import download_model

    downloaded_path = download_model(model_name, output_dir=str(target_dir))
    logger.info("faster-whisper model '%s' ready at: %s", model_name, downloaded_path)
    return Path(downloaded_path)


def setup_piper_voice(voice_name: str = "en_US-lessac-medium", target_dir: Path = None) -> Path:
    """Download a local Piper voice model and companion config."""
    if target_dir is None:
        target_dir = DEFAULT_MODELS_DIR / "piper"

    target_dir.mkdir(parents=True, exist_ok=True)
    print_license_warning(voice_name)

    logger.info("Downloading Piper voice '%s' into %s...", voice_name, target_dir)

    # Use Piper's built-in download_voices utility
    import subprocess
    cmd = [
        sys.executable,
        "-m",
        "piper.download_voices",
        voice_name,
        "--download-dir",
        str(target_dir),
    ]

    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        logger.error("Failed to download Piper voice: %s", result.stderr)
        raise RuntimeError(f"Piper voice download failed: {result.stderr}")

    logger.info("Piper voice '%s' downloaded successfully.", voice_name)
    return target_dir


def verify_voice_pipeline(whisper_model_path: Path, piper_model_dir: Path) -> bool:
    """Verify local voice pipeline by synthesizing speech and transcribing it back."""
    import asyncio
    from aura_agent.services.stt import FasterWhisperSTT
    from aura_agent.services.tts import PiperTTSService

    logger.info("--- Starting Voice Pipeline Self-Verification ---")

    # 1. Test TTS
    onnx_files = list(piper_model_dir.glob("*.onnx"))
    if not onnx_files:
        logger.error("No .onnx file found in %s", piper_model_dir)
        return False

    piper_model = str(onnx_files[0])
    logger.info("Found Piper model: %s", piper_model)

    tts = PiperTTSService(model_path=piper_model)
    test_phrase = "Hello! AURA local voice pipeline is operational on Windows."
    logger.info("Synthesizing test audio for: '%s'", test_phrase)
    audio_wav = asyncio.run(tts.synthesize(test_phrase))
    logger.info("Synthesized %d bytes of WAV audio.", len(audio_wav))

    # 2. Test STT
    stt = FasterWhisperSTT(
        model_size_or_path=str(whisper_model_path),
        model_dir=str(whisper_model_path),
    )
    logger.info("Transcribing synthesized audio locally with faster-whisper...")
    transcript = asyncio.run(stt.transcribe(audio_wav))
    logger.info("Transcribed text: '%s'", transcript)

    if transcript:
        logger.info(">>> VERIFICATION SUCCESS: Local voice loop complete. <<<")
        return True
    else:
        logger.warning("Verification finished but transcript was empty.")
        return False


def main():
    parser = argparse.ArgumentParser(description="AURA Voice Model Setup & License Verification")
    parser.add_argument("--whisper", default=None, help="Whisper model name (e.g., tiny.en, base.en)")
    parser.add_argument("--piper", default=None, help="Piper voice name (e.g., en_US-lessac-medium)")
    parser.add_argument("--all", action="store_true", help="Download both base.en and en_US-lessac-medium")
    parser.add_argument("--verify", action="store_true", help="Run end-to-end local STT/TTS self-verification")

    args = parser.parse_args()

    whisper_path = None
    piper_dir = None

    if args.all or args.whisper:
        w_model = args.whisper or "base.en"
        whisper_path = setup_whisper_model(w_model)

    if args.all or args.piper:
        p_voice = args.piper or "en_US-lessac-medium"
        piper_dir = setup_piper_voice(p_voice)

    if args.verify:
        if not whisper_path:
            candidates = [
                DEFAULT_MODELS_DIR / "whisper" / "tiny.en",
                DEFAULT_MODELS_DIR / "whisper" / "base.en",
                DEFAULT_PROJECT_ROOT / "services" / "models" / "whisper" / "tiny.en",
            ]
            for cand in candidates:
                if cand.exists():
                    whisper_path = cand
                    break

        if not piper_dir:
            candidates = [
                DEFAULT_MODELS_DIR / "piper",
                DEFAULT_PROJECT_ROOT / "services" / "models" / "piper",
            ]
            for cand in candidates:
                if cand.exists() and list(cand.glob("*.onnx")):
                    piper_dir = cand
                    break

        if not whisper_path or not piper_dir:
            logger.error(
                "Cannot run --verify: missing local models (whisper=%s, piper=%s). Run with --whisper and --piper first.",
                whisper_path,
                piper_dir,
            )
            sys.exit(1)

        success = verify_voice_pipeline(whisper_path, piper_dir)
        sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()
