class PolicyEngine:
    """
    Policy Engine mapping to FR7 (Audit & Governance) and NF3 (Security).
    Enforces RBAC and Risk Level constraints before any action is executed.
    """
    
    @staticmethod
    def evaluate_action(action: str, risk: str, user_role: str) -> dict:
        print(f"[POLICY ENGINE] Evaluating action '{action}' (Risk: {risk}) for Role: {user_role}")
        
        if risk == "READ_ONLY":
            return {"allowed": True, "reason": "Read-only actions are permitted for all roles."}
            
        elif risk == "LOW_IMPACT_WRITE":
            if user_role in ["Tier1", "Tier2", "Tier3", "Principal"]:
                return {"allowed": True, "reason": "Role authorized for low-impact writes."}
                
        elif risk == "HIGH_IMPACT_WRITE":
            if user_role in ["Tier2", "Tier3", "Principal"]:
                return {"allowed": True, "reason": "Role authorized for high-impact writes."}
                
        elif risk == "DESTRUCTIVE":
            if user_role in ["Tier3", "Principal"]:
                return {"allowed": True, "reason": "Role authorized for destructive actions."}
            else:
                return {"allowed": False, "reason": "Destructive actions require Tier3 or Principal role."}
                
        return {"allowed": False, "reason": "Unknown risk level."}
