import ast
from typing import Dict, Any, List

class ASTParser:
    """
    Parses complex scripts (like PowerShell or Python) into Abstract Syntax Trees.
    By parsing the script structurally, we defeat string-based obfuscation 
    (like Base64 encoding, randomized variables, or string concatenation).
    """
    def __init__(self):
        # In a real environment, we would use tree-sitter for PowerShell.
        # Here we use Python's native AST as the foundation for the pipeline.
        self.supported_languages = ["python", "powershell"]

    def extract_features(self, script_content: str, lang: str = "python") -> Dict[str, Any]:
        features = {
            "num_functions": 0,
            "imported_modules": [],
            "suspicious_calls": [],
            "max_depth": 0,
            "obfuscation_entropy": 0.0
        }
        
        try:
            tree = ast.parse(script_content)
            
            def walk_depth(node, current_depth):
                features["max_depth"] = max(features["max_depth"], current_depth)
                for child in ast.iter_child_nodes(node):
                    walk_depth(child, current_depth + 1)
            
            walk_depth(tree, 0)
            
            for node in ast.walk(tree):
                if isinstance(node, ast.FunctionDef):
                    features["num_functions"] += 1
                elif isinstance(node, ast.Import):
                    for alias in node.names:
                        features["imported_modules"].append(alias.name)
                elif isinstance(node, ast.ImportFrom):
                    features["imported_modules"].append(node.module)
                elif isinstance(node, ast.Call):
                    if isinstance(node.func, ast.Name):
                        if node.func.id in ['eval', 'exec', 'system', 'popen', 'subprocess', 'getattr']:
                            features["suspicious_calls"].append(node.func.id)
            
            # Simple entropy check to flag highly randomized string allocations
            features["obfuscation_entropy"] = len(set(script_content)) / (len(script_content) + 1)
            
            return features
            
        except SyntaxError:
            # If the script fails to parse, it might be heavily packed or not pure Python
            features["error"] = "Syntax parsing failed. Possible heavily packed payload."
            return features
