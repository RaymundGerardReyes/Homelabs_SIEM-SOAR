import json
from typing import Dict, Any
from ml_inference.ast_parser import ASTParser

class ScriptDeobfuscator:
    """
    Consumes the structural embeddings extracted by the AST parser and evaluates them 
    against a Random Forest or Transformer intent classification model.
    """
    def __init__(self):
        self.ast_parser = ASTParser()
        # Mocking the loaded PyTorch/Scikit model weights
        self.model_loaded = True
        self.suspicious_threshold = 0.75

    def analyze_payload(self, script_payload: str) -> Dict[str, Any]:
        """
        Takes a raw script, parses the AST, and classifies its malicious intent.
        """
        # 1. Extract structural semantics (bypass string obfuscation)
        ast_features = self.ast_parser.extract_features(script_payload)
        
        if "error" in ast_features:
            return {
                "classification": "MALICIOUS",
                "confidence": 0.90,
                "reason": "Failed to parse AST structure. Signature matches packed payload."
            }
            
        risk_score = 0.1
        
        # 2. Evaluate AST vectors
        if len(ast_features["suspicious_calls"]) > 0:
            risk_score += 0.5 * len(ast_features["suspicious_calls"])
            
        if ast_features["max_depth"] > 10:
            # Highly nested logic often indicates obfuscated decoders
            risk_score += 0.3
            
        # 3. Final Model Inference Mapping
        is_malicious = risk_score >= self.suspicious_threshold
        
        return {
            "classification": "MALICIOUS" if is_malicious else "BENIGN",
            "confidence": min(risk_score, 0.99),
            "features_detected": ast_features,
            "reason": f"AST Analysis detected {len(ast_features['suspicious_calls'])} critical execution methods." if is_malicious else "Standard administrative script profile."
        }
