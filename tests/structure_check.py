import os
import sys
import re

TESTS_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(TESTS_DIR)

REQUIRED_DIRS = [
    "api", "unit", "integration", "e2e", 
    "regression", "performance", "chaos", "orchestration"
]

def check_required_directories():
    print("[1/3] Checking for required top-level directories...")
    missing = []
    for d in REQUIRED_DIRS:
        if not os.path.isdir(os.path.join(TESTS_DIR, d)):
            missing.append(d)
    if missing:
        print(f"❌ ERROR: Missing required directories in tests/: {missing}")
        return False
    print("✅ All required directories present.")
    return True

def check_duplicate_test_files():
    print("[2/3] Checking for duplicate test basenames...")
    seen_files = {}
    duplicates = []
    
    # Also check per-service unit test folders
    search_dirs = [
        TESTS_DIR,
        os.path.join(PROJECT_ROOT, "soc-backend", "tests"),
        os.path.join(PROJECT_ROOT, "core-ingest", "tests"),
        os.path.join(PROJECT_ROOT, "soc-frontend", "tests"),
    ]
    
    for search_dir in search_dirs:
        if not os.path.exists(search_dir):
            continue
        for root, _, files in os.walk(search_dir):
            for file in files:
                if (file.startswith("test_") and file.endswith(".py")) or \
                   (file.endswith("_test.go")) or \
                   (file.endswith(".spec.ts") or file.endswith(".test.tsx")):
                    
                    file_path = os.path.join(root, file)
                    try:
                        with open(file_path, "r", encoding="utf-8") as f:
                            first_line = f.read(100)
                            if "DEPRECATED" in first_line:
                                continue
                    except Exception:
                        pass
                    
                    if file in seen_files:
                        duplicates.append((file, seen_files[file], file_path))
                    else:
                        seen_files[file] = file_path
                        
    if duplicates:
        print("❌ ERROR: Duplicate test files detected across different directories!")
        for dup in duplicates:
            print(f"  - {dup[0]} exists at:\n      1. {dup[1]}\n      2. {dup[2]}")
        return False
    print("✅ No duplicate test files detected.")
    return True

def check_catalog_links():
    print("[3/3] Checking TEST-CATALOG.md for broken file links...")
    catalog_path = os.path.join(TESTS_DIR, "TEST-CATALOG.md")
    if not os.path.exists(catalog_path):
        print("❌ ERROR: TEST-CATALOG.md is missing!")
        return False
        
    with open(catalog_path, "r", encoding="utf-8") as f:
        content = f.read()
        
    # Find all inline code blocks containing test paths: `path/to/test.py`
    matches = re.findall(r'`([^`]+\.(?:py|go|ts|tsx))`', content)
    broken_links = []
    
    for match in matches:
        # Resolve path relative to project root
        full_path = os.path.join(PROJECT_ROOT, match.replace("/", os.sep))
        if not os.path.exists(full_path):
            broken_links.append(match)
            
    if broken_links:
        print("❌ ERROR: TEST-CATALOG.md references non-existent test files!")
        for link in broken_links:
            print(f"  - {link}")
        return False
        
    print("✅ All TEST-CATALOG.md links are valid.")
    return True

if __name__ == "__main__":
    print("================================================================")
    print("🛡️ RUNNING STRUCTURAL ENFORCEMENT GATE")
    print("================================================================")
    
    passed_dirs = check_required_directories()
    passed_dups = check_duplicate_test_files()
    passed_cat = check_catalog_links()
    
    if not (passed_dirs and passed_dups and passed_cat):
        print("================================================================")
        print("⛔ ENFORCEMENT FAILED: Architectural drift detected. Tests aborted.")
        print("================================================================")
        sys.exit(1)
        
    print("================================================================")
    print("✅ ENFORCEMENT PASSED: Test structure is sound.")
    print("================================================================")
    sys.exit(0)
