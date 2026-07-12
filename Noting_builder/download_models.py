import os
import sys
import shutil

print("------------------------------------------------------")
print("[SETUP] SHAKTI TRANSLATOR - OFFLINE MODEL SETUP")
print("------------------------------------------------------")

# Ensure output directory exists
current_dir = os.path.dirname(os.path.abspath(__file__))
models_dir = os.path.join(current_dir, "models")
os.makedirs(models_dir, exist_ok=True)

try:
    import ctranslate2
    from transformers import AutoTokenizer
except ImportError as e:
    print(f"[ERROR] Required library missing: {e}")
    print("Please ensure ctranslate2, transformers, and sacremoses are installed.")
    sys.exit(1)

model_pairs = [
    ("Helsinki-NLP/opus-mt-en-hi", "en-hi"),
    ("Helsinki-NLP/opus-mt-hi-en", "hi-en")
]

for src_model, lang_dir in model_pairs:
    model_path = os.path.join(models_dir, f"opus-mt-{lang_dir}-ct2")
    tokenizer_path = os.path.join(models_dir, f"opus-mt-{lang_dir}-tokenizer")
    
    # Check if both model and tokenizer directories exist and are not empty
    if os.path.exists(model_path) and os.listdir(model_path) and os.path.exists(tokenizer_path) and os.listdir(tokenizer_path):
        print(f"[SKIP] Model and tokenizer for '{lang_dir}' already exist. Skipping.")
        continue
    
    print(f"[DOWNLOAD] Downloading and converting {src_model}...")
    try:
        # Create separate clean folders
        os.makedirs(model_path, exist_ok=True)
        os.makedirs(tokenizer_path, exist_ok=True)
        
        # Save tokenizer separately
        tokenizer = AutoTokenizer.from_pretrained(src_model)
        tokenizer.save_pretrained(tokenizer_path)
        print(f"[SUCCESS] Saved tokenizer to {tokenizer_path}")
        
        # Convert model using CTranslate2 and save to its own folder
        converter = ctranslate2.converters.TransformersConverter(src_model)
        converter.convert(model_path, quantization="int8", force=True)
        print(f"[SUCCESS] Converted {src_model} to CTranslate2 model at {model_path}")
    except Exception as e:
        print(f"[ERROR] Error converting {src_model}: {e}")
        # Clean up failed directories
        if os.path.exists(model_path):
            shutil.rmtree(model_path)
        if os.path.exists(tokenizer_path):
            shutil.rmtree(tokenizer_path)
        sys.exit(1)

print("\n[COMPLETE] ALL TRANSLATION MODELS READY FOR OFFLINE DEPLOYMENT!")
print("------------------------------------------------------")
